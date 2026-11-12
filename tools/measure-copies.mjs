#!/usr/bin/env node
// ==========================================================
// tools/measure-copies.mjs
// Open check from docs/adr/0001: how big does player data get when every
// copy becomes its own record? Runs the real migration (services/box.js
// normalizeBox) on an in-memory copy of a snapshot and prints aggregates
// only (no player ids).
//
//   node tools/measure-copies.mjs <trainerData.json | snapshot.json> [--backfill <file>]
//   (--backfill: the output of tools/build-pokedex-backfill.mjs, merged as at boot)
// ==========================================================

import fs from "fs";
import { normalizeBox, mergeDex } from "../services/box.js";
import { normalizeCustomPokemon } from "../services/ownership.js";
import { retroEvaluate } from "../progression/achievements.js";

const file = process.argv[2];
const bi = process.argv.indexOf("--backfill");
const backfill = bi > 0 ? JSON.parse(fs.readFileSync(process.argv[bi + 1], "utf8")).users ?? {} : null;
let backfilled = 0;
if (!file) { console.error("usage: measure-copies.mjs <snapshot.json>"); process.exit(2); }
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;

const before = Buffer.byteLength(JSON.stringify(data));
const perPlayer = [];
let seeded = 0;
const retro = new Map(); // achievement id → players newly unlocked at first boot
let retroPlayers = 0;
for (const u of Object.values(data)) {
  if (!u || typeof u !== "object") continue;
  normalizeCustomPokemon(u);
  normalizeBox(u, { rand: Math.random });
  if (backfill) for (const [pid, uu] of Object.entries(data)) if (uu === u && backfill[pid]) backfilled += mergeDex(u, backfill[pid]);
  const newly = retroEvaluate(u);
  if (newly.length) retroPlayers++;
  for (const a of newly) retro.set(a, (retro.get(a) ?? 0) + 1);
  perPlayer.push(Object.keys(u.box ?? {}).length);
  seeded += Object.keys(u.pokedex ?? {}).length;
}
const after = Buffer.byteLength(JSON.stringify(data));
perPlayer.sort((a, b) => a - b);
const q = (p) => perPlayer[Math.min(perPlayer.length - 1, Math.floor(p * perPlayer.length))] ?? 0;
const total = perPlayer.reduce((s, n) => s + n, 0);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(JSON.stringify({
  players: perPlayer.length,
  copies: { total, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: perPlayer.at(-1) ?? 0 },
  pokedexEntriesSeeded: seeded,
  ...(backfill ? { backfillEntriesAdded: backfilled } : {}),
  snapshotBytes: { before: kb(before), after: kb(after), growth: `${((after / before - 1) * 100).toFixed(0)}%` },
  // Without a backfill file: from current ownership only. Includes every
  // retro unlock a snapshot this old is due, not only the Pokédex ones.
  retroUnlocks: { players: retroPlayers, total: [...retro.values()].reduce((a, b) => a + b, 0), pokedexNamed: Object.fromEntries([...retro].filter(([id]) => /_full$|col_species_(649|1025)|shiny_species/.test(id)).sort()) },
}, null, 2));
