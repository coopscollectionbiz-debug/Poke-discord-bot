// ==========================================================
// tools/qualify-migration.mjs — cross-version check of the achievement
// revision 2 → 3 migration (Release C → Gen 6–9), using the REAL code of
// both versions on synthetic players. Read-only; never touches player data.
//
//   node tools/qualify-migration.mjs --old <path to a Release C checkout (0d4bbea9)> [--players 3000]
//
// Steps: (1) synthesise players and bring them to revision 2 with Release C's
// own normalizeUserSchema + retroEvaluate (what production holds today);
// (2) boot them through this branch (validateUserSchema + retroEvaluate, as
// bot_final.js does); (3) roll back: boot the migrated records through
// Release C again. Reports every difference outside the expected fields.
// ==========================================================

import path from "path";
import { pathToFileURL } from "url";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OLD = arg("--old");
const N = Number(arg("--players", 3000));
if (!OLD) { console.error("usage: node tools/qualify-migration.mjs --old <Release C checkout>"); process.exit(2); }
process.env.TRAINERDATA_DIR ??= path.join(process.env.TEMP || "/tmp", "qualify-migration");
delete process.env.POKEMON_GENERATIONS;

const imp = (root, rel) => import(pathToFileURL(path.join(root, rel)).href);
const NEW = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const oldSchema = await imp(OLD, "utils/userSchema.js");
const oldProg = await imp(OLD, "progression/achievements.js");
const oldCat = await imp(OLD, "catalog/achievements.js");
const newSchema = await imp(NEW, "utils/userSchema.js");
const newProg = await imp(NEW, "progression/achievements.js");
const newCat = await imp(NEW, "catalog/achievements.js");

// Deterministic PRNG.
let seed = 20261109;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (n) => Math.floor(rnd() * n);
const DAY = 20400;

function synth(i) {
  const pokemon = {};
  const owned = rnd() < 0.05 ? 649 : pick(rnd() < 0.5 ? 60 : 400);
  for (let k = 0; k < owned; k++) {
    const id = 1 + (owned === 649 ? k : pick(649));
    pokemon[id] = { normal: pick(4) + (rnd() < 0.8 ? 1 : 0), shiny: rnd() < 0.08 ? 1 : 0 };
  }
  const training = {};
  for (const id of Object.keys(pokemon).slice(0, 12)) training[`${id}:normal`] = { exp: pick(400000) };
  const u = {
    id: `U${i}`, username: `player${i}`, tp: pick(300000), cc: pick(500000), pokemon, training,
    trainers: Array.from({ length: pick(40) }, (_, k) => `trainer_${k}.png`),
    items: { evolution_stone: pick(20), shiny_dust: pick(200) },
    displayedPokemon: Object.keys(pokemon).slice(0, 6).map((id) => ({ id: Number(id), variant: "normal" })),
    battle: { wins: pick(600), losses: pick(600), rating: 900 + pick(800) },
    stats: { shinyObtained: pick(30), evolutions: pick(300), donated: pick(2000), purchases: pick(50), dailyClaims: pick(200), bestWinStreak: pick(12) },
    evoSpecies: Array.from(new Set(Array.from({ length: pick(40) }, () => 1 + pick(649)))).sort((a, b) => a - b),
  };
  if (rnd() < 0.1) u.achClaimed = { col_first: DAY - 3 };
  return u;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const EXPECTED = new Set(["ach", "ap", "progression"]);
function diffOutside(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !EXPECTED.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
const NOW = Date.UTC(2026, 10, 10);
const problems = [];
const newlyById = new Map();
let removedUnlocks = 0, changedDays = 0, apMismatch = 0, idempotent = true, rollbackLoss = 0, rollbackOther = 0;

for (let i = 0; i < N; i++) {
  // (1) production today: Release C at revision 2
  const prod = synth(i);
  oldSchema.validateUserSchema(prod, prod.id, prod.username);
  oldProg.normalizeProgression(prod);
  oldProg.retroEvaluate(prod, NOW - 86_400_000);
  if (prod.progression?.rev !== oldCat.CATALOG_REVISION) problems.push(`U${i}: Release C did not stamp rev ${oldCat.CATALOG_REVISION}`);
  const before = clone(prod);

  // (2) boot on this branch
  const mig = clone(prod);
  newSchema.validateUserSchema(mig, mig.id, mig.username);
  newProg.normalizeProgression(mig);
  const newly = newProg.retroEvaluate(mig, NOW);
  for (const id of newly) newlyById.set(id, (newlyById.get(id) || 0) + 1);
  for (const [id, d] of Object.entries(before.ach || {})) {
    if (!(id in (mig.ach || {}))) removedUnlocks++;
    else if (mig.ach[id] !== d) changedDays++;
  }
  const outside = diffOutside(before, mig);
  if (outside.length) problems.push(`U${i}: fields changed by migration: ${outside.join(", ")}`);
  if (JSON.stringify(before.achClaimed) !== JSON.stringify(mig.achClaimed)) problems.push(`U${i}: claims changed`);
  const apNow = Object.keys(mig.ach || {}).reduce((s, id) => s + (newCat.getAchievement(id)?.ap ?? 0), 0);
  if (mig.ap !== apNow) apMismatch++;
  if (mig.progression?.rev !== 3) problems.push(`U${i}: not stamped rev 3`);
  const again = clone(mig);
  newSchema.validateUserSchema(again, again.id, again.username);
  newProg.normalizeProgression(again);
  if (newProg.retroEvaluate(again, NOW + 86_400_000).length || JSON.stringify(again) !== JSON.stringify(mig)) idempotent = false;

  // (3) rollback: the migrated record booted by Release C again
  const rb = clone(mig);
  oldSchema.validateUserSchema(rb, rb.id, rb.username);
  oldProg.normalizeProgression(rb);
  oldProg.retroEvaluate(rb, NOW + 2 * 86_400_000);
  for (const id of Object.keys(mig.ach || {})) if (!(id in (rb.ach || {}))) rollbackLoss++;
  const rbOutside = [...new Set([...Object.keys(rb), ...Object.keys(mig)])].filter((k) => !["ap", "progression", "progressionLegacy"].includes(k) && JSON.stringify(rb[k]) !== JSON.stringify(mig[k]));
  if (rbOutside.length) { rollbackOther++; if (rollbackOther <= 3) problems.push(`U${i}: rollback changed ${rbOutside.join(", ")}`); }
}

const report = {
  players: N,
  releaseCRevision: oldCat.CATALOG_REVISION,
  newRevision: newCat.CATALOG_REVISION,
  newUnlocksByAchievement: Object.fromEntries([...newlyById].sort()),
  existingUnlocksRemoved: removedUnlocks,
  existingUnlockDaysChanged: changedDays,
  apNotEqualToSumOfUnlocks: apMismatch,
  secondBootIsNoOp: idempotent,
  rollback: { unlocksLostWhenReleaseCBootsMigratedRecords: rollbackLoss, recordsWithOtherFieldChanges: rollbackOther },
  problems: problems.slice(0, 20),
  problemCount: problems.length,
};
console.log(JSON.stringify(report, null, 1));
process.exit(problems.length || removedUnlocks || changedDays || apMismatch || !idempotent || rollbackLoss ? 1 : 0);
