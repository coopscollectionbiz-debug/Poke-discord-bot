#!/usr/bin/env node
// ==========================================================
// tools/build-pokedex-backfill.mjs
// Pokédex backfill (docs/adr/0001): the union, per player, of every species
// (and every shiny) present in any historical player-data snapshot.
//
//   node tools/build-pokedex-backfill.mjs --out <file> [snapshot.json ...]
//        [--git <repo> --git-path trainerData.json]   every committed version
//
// A snapshot is a trainerData object ({ userId: user }) or a saved snapshot
// wrapper with that object under "data". Pre-evolutions are never inferred:
// only species actually present count.
//
// Output: { builtAt, sources, users: { userId: { speciesId: 1|2|3 } } }
// It holds player ids: write it to the data volume or a restricted folder,
// never into the repository. The bot merges it at boot when
// POKEDEX_BACKFILL_FILE points at it (union only; safe to re-run).
// ==========================================================

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const out = opt("--out");
const gitRepo = opt("--git");
const gitPath = opt("--git-path") ?? "trainerData.json";
const files = args;
if (!out || (!files.length && !gitRepo)) {
  console.error("usage: build-pokedex-backfill.mjs --out <file> [snapshot.json ...] [--git <repo> --git-path trainerData.json]");
  process.exit(2);
}
if (path.resolve(out).startsWith(path.resolve(process.cwd()) + path.sep)) {
  console.error("⛔ --out is inside the repository. The backfill holds player ids; write it outside the repo.");
  process.exit(2);
}

const users = {};
const sources = [];
let snapshots = 0;

function addSnapshot(text, label) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { console.warn(`  skip ${label}: not JSON`); return; }
  const data = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  if (!data || typeof data !== "object") return;
  let n = 0;
  for (const [uid, u] of Object.entries(data)) {
    if (!u || typeof u !== "object" || !/^\d{5,25}$/.test(uid)) continue;
    const masks = (users[uid] ??= {});
    const add = (id, bits) => { const k = Number(id); if (Number.isInteger(k) && k > 0 && bits) masks[k] = (masks[k] ?? 0) | bits; };
    for (const [id, e] of Object.entries(u.pokemon ?? {})) {
      if (!/^\d+$/.test(id)) continue; // form keys never count as species
      add(id, ((Number(e?.normal) || 0) > 0 ? 1 : 0) | ((Number(e?.shiny) || 0) > 0 ? 2 : 0));
    }
    for (const [id, m] of Object.entries(u.pokedex ?? {})) add(id, Number(m) & 3);
    n++;
  }
  snapshots++;
  sources.push({ label, players: n });
  console.log(`  ${label}: ${n} players`);
}

for (const f of files) addSnapshot(fs.readFileSync(f, "utf8"), path.basename(f));

if (gitRepo) {
  const revs = execFileSync("git", ["-C", gitRepo, "log", "--all", "--format=%H", "--", gitPath], { encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\n").filter(Boolean);
  console.log(`git: ${revs.length} versions of ${gitPath}`);
  for (const rev of revs) {
    let text;
    try { text = execFileSync("git", ["-C", gitRepo, "show", `${rev}:${gitPath}`], { encoding: "utf8", maxBuffer: 1 << 28 }); } catch { continue; }
    addSnapshot(text, `git:${rev.slice(0, 8)}`);
  }
}

const species = Object.values(users).reduce((s, m) => s + Object.keys(m).length, 0);
fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), sources, users }));
console.log(`✅ ${snapshots} snapshot(s), ${Object.keys(users).length} players, ${species} player-species entries → ${out}`);
