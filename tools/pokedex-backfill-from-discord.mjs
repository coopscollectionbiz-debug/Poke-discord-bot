#!/usr/bin/env node
// ==========================================================
// tools/pokedex-backfill-from-discord.mjs
// MANUAL OPTION. The bot runs the same scan itself after the first boot of
// the Pokédex release (services/dexBackfill.js); use this only to build a
// backfill file somewhere else (it needs the bot token).
//
// Pokédex backfill (docs/adr/0001) straight from the Discord storage
// channel's backup history. Walks every message in the channel (newest to
// oldest), streams each trainerData*.json attachment into memory, keeps only
// "which player ever had which species (and which shiny)", and discards the
// file. No raw backup is ever written to disk.
//
// Run it where the bot's secrets live (the VPS; /etc/pokebot.env is root-only):
//
//   sudo bash -c 'set -a; . /etc/pokebot.env; set +a;
//     node /tmp/pokedex-backfill-from-discord.mjs --count'
//   sudo bash -c 'set -a; . /etc/pokebot.env; set +a;
//     node /tmp/pokedex-backfill-from-discord.mjs --out /srv/pokebot/data/pokedex-backfill.json [--every 60]'
//   sudo chown pokebot: /srv/pokebot/data/pokedex-backfill.json
//
// The live bot only reads it once a release with the Pokédex is deployed
// and POKEDEX_BACKFILL_FILE points at it.
//
// Needs BOT_TOKEN (or DISCORD_TOKEN) and STORAGE_CHANNEL_ID. Read-only on
// Discord: it only lists messages and downloads attachments, slowly
// (one request at a time, honouring rate limits) so the live bot is not
// starved of its own rate limit.
//
//   --count        list how many backups exist and their date range; download nothing
//   --every <min>  use at most one backup per <min> minutes (default 0 = all)
//   --limit <n>    stop after n backups (testing)
//   --out <file>   output, same format as tools/build-pokedex-backfill.mjs:
//                  { builtAt, sources, users: { userId: { speciesId: 1|2|3 } } }
//                  written with mode 600. It holds player ids: keep it on the
//                  data volume, never in the repository.
// ==========================================================

import fs from "fs";
import { speciesMasksOf, parseBackupText } from "../services/dexBackfill.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TOKEN = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const CHANNEL = process.env.STORAGE_CHANNEL_ID;
const API = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const countOnly = flag("--count");
const every = Number(opt("--every", 0)) * 60_000;
const limit = Number(opt("--limit", 0)) || Infinity;
const out = opt("--out");

if (!TOKEN || !CHANNEL) { console.error("⛔ BOT_TOKEN/DISCORD_TOKEN and STORAGE_CHANNEL_ID must be set (load the bot's env file)."); process.exit(2); }
if (!countOnly && !out) { console.error("⛔ --out <file> is required (or use --count)."); process.exit(2); }
{
  const path = await import("path");
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  if (out && path.resolve(out).toLowerCase().startsWith(repo.toLowerCase() + path.sep)) {
    console.error("⛔ --out is inside the repository. The backfill holds player ids; write it outside the repo.");
    process.exit(2);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (res.status === 429) { const b = await res.json().catch(() => ({})); await sleep(Math.ceil((b.retry_after ?? 2) * 1000) + 250); continue; }
    if (!res.ok) throw new Error(`Discord ${res.status} on ${path.split("?")[0]}`);
    await sleep(400); // stay well under the bot's shared rate limit
    return res.json();
  }
  throw new Error("Discord kept rate-limiting; try again later.");
}

// 1. List every backup attachment (message id, time, url), newest first.
const backups = [];
let before = null;
for (;;) {
  const page = await api(`/channels/${CHANNEL}/messages?limit=100${before ? `&before=${before}` : ""}`);
  if (!Array.isArray(page) || page.length === 0) break;
  for (const m of page) {
    for (const a of m.attachments ?? []) {
      if (/trainerData.*\.json$/i.test(a.filename ?? "")) backups.push({ id: m.id, at: Date.parse(m.timestamp), url: a.url, size: a.size ?? 0 });
    }
  }
  before = page[page.length - 1].id;
  process.stderr.write(`\r  listed ${backups.length} backups…`);
}
process.stderr.write("\n");
if (!backups.length) { console.log("No trainerData backups found in the channel."); process.exit(0); }

// Sample: at most one per `every` window (always keeps the newest and oldest).
backups.sort((a, b) => b.at - a.at);
let picked = backups;
if (every > 0) {
  picked = [];
  let last = Infinity;
  for (const b of backups) if (last - b.at >= every) { picked.push(b); last = b.at; }
  if (picked.at(-1) !== backups.at(-1)) picked.push(backups.at(-1));
}
picked = picked.slice(0, limit);
const gb = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`;
const day = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
console.log(`Backups in channel: ${backups.length} (${day(backups.at(-1).at)} → ${day(backups[0].at)} UTC), ${gb(backups.reduce((s, b) => s + b.size, 0))}`);
console.log(`Will read: ${picked.length}${every ? ` (one per ${every / 60_000} min)` : ""}, ~${gb(picked.reduce((s, b) => s + b.size, 0))}`);
if (countOnly) process.exit(0);

// 2. Stream each one; keep only the union of species bits per player.
const users = {};
let read = 0, skipped = 0;
for (const b of picked) {
  let data;
  try {
    const res = await fetch(b.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = parseBackupText(await res.text());
  } catch (err) {
    skipped++;
    console.warn(`\n  skip ${day(b.at)}: ${err.message}`);
    continue;
  }
  // Same reader as the bot's own scan (services/dexBackfill.js).
  for (const [uid, masks] of Object.entries(speciesMasksOf(data))) {
    const into = (users[uid] ??= {});
    for (const [id, m] of Object.entries(masks)) into[id] = (into[id] ?? 0) | m;
  }
  data = null;
  read++;
  process.stderr.write(`\r  read ${read}/${picked.length} (${day(b.at)})…`);
  await sleep(250);
}
process.stderr.write("\n");

const entries = Object.values(users).reduce((s, m) => s + Object.keys(m).length, 0);
fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), sources: [{ label: "discord-storage-channel", backups: read, skipped, from: day(picked.at(-1).at), to: day(picked[0].at) }], users }), { mode: 0o600 });
console.log(`✅ ${read} backup(s) read, ${skipped} skipped; ${Object.keys(users).length} players, ${entries} player-species entries → ${out}`);
