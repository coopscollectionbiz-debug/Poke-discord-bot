// ==========================================================
// tests/achievementsBench.test.js — Release C synthetic load benchmark
// 3,000 synthetic players with a realistic spread (new → completionist).
// Measures: first-boot retroactive pass, warm boot (already evaluated),
// per-event progress cost, view cost, snapshot size growth, and a write.
// Bounds are deliberately loose (CI noise); the printed numbers are the data.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { performance } from "perf_hooks";
import { assertTrue, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "achbench-"));
process.env.TRAINERDATA_DIR = dir;

const P = await import("../progression/achievements.js");
const store = await import("../persistence/localStore.js");

const PLAYERS = 3000;
const NOW = Date.UTC(2026, 10, 9, 12);
const MAX_ID = 1025;

// Deterministic PRNG so runs are comparable.
let seed = 0x5eed1234;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function synthPlayer(i) {
  // Spread: 30% new (0-10 species), 40% casual (10-150), 22% regular (150-500), 8% heavy (500-1025).
  const r = rnd();
  const n = r < 0.3 ? ri(0, 10) : r < 0.7 ? ri(10, 150) : r < 0.92 ? ri(150, 500) : ri(500, MAX_ID);
  const pokemon = {};
  for (let k = 0; k < n; k++) {
    const id = ri(1, MAX_ID);
    const e = (pokemon[id] ??= { normal: 0, shiny: 0 });
    e.normal += ri(1, 3);
    if (rnd() < 0.02) e.shiny += 1;
  }
  const trainers = Array.from({ length: Math.min(300, Math.floor(n / 4)) }, (_, k) => `trainer-${k}.png`);
  const training = {};
  for (const id of Object.keys(pokemon).slice(0, 5)) training[`${id}:normal`] = { exp: ri(0, 200000) };
  return {
    id: String(100000000000000000n + BigInt(i)),
    name: `Synthetic${i}`,
    cc: ri(0, 50000),
    tp: ri(0, n * 60),
    pokemon,
    trainers,
    training,
    items: { evolution_stone: ri(0, 5) },
    battle: { wins: ri(0, Math.floor(n / 2)), losses: ri(0, 50), rating: ri(900, 1700) },
  };
}

const data = {};
for (let i = 0; i < PLAYERS; i++) {
  const u = synthPlayer(i);
  data[u.id] = u;
}
const ids = Object.keys(data);
const sizeBefore = Buffer.byteLength(JSON.stringify(data));
const ms = (t0) => performance.now() - t0;
const fmt = (x) => x.toFixed(2);
const results = {};

section("First boot: normalize + retroactive pass");
{
  const t0 = performance.now();
  let unlocks = 0;
  let players = 0;
  for (const id of ids) {
    P.normalizeProgression(data[id]);
    const n = P.retroEvaluate(data[id], NOW).length;
    unlocks += n;
    if (n) players++;
  }
  results.firstBootMs = ms(t0);
  results.retroUnlocks = unlocks;
  results.retroPlayers = players;
  console.log(`   first boot: ${fmt(results.firstBootMs)} ms for ${PLAYERS} players (${unlocks} unlocks across ${players} players, ${fmt(results.firstBootMs / PLAYERS)} ms/player)`);
  assertTrue(results.firstBootMs < 30_000, "first-boot retro pass stays well under 30 s");
  assertTrue(unlocks > 0, "unlocks were recognised");
}

section("Warm boot: already evaluated");
{
  const t0 = performance.now();
  let n = 0;
  for (const id of ids) {
    P.normalizeProgression(data[id]);
    n += P.retroEvaluate(data[id], NOW).length;
  }
  results.warmBootMs = ms(t0);
  console.log(`   warm boot: ${fmt(results.warmBootMs)} ms (${n} unlocks)`);
  assertTrue(n === 0, "warm boot re-unlocks nothing");
  assertTrue(results.warmBootMs < 5_000, "warm boot under 5 s");
}

section("Per-event progress cost");
{
  // Same mix as the revision-1 measurement (comparable), then a mix that
  // includes the revision-2 events (daily, weekly, battle result, trainers).
  const kinds = [[{ type: "pokemon" }, { type: "shiny", n: 0 }, { type: "purchase" }], [{ type: "evolved", species: 2 }], [{ type: "battle", won: true }], [{ type: "donated", n: 3 }], [{ type: "tp" }]];
  const kinds2 = [...kinds, [{ type: "daily", day: 20000 }], [{ type: "weekly" }], [{ type: "battle", won: false }], [{ type: "trainers" }]];
  const N = 20_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) P.trackProgress(data[ids[i % ids.length]], kinds[i % kinds.length], NOW);
  results.eventUs = (ms(t0) * 1000) / N;
  const t2 = performance.now();
  for (let i = 0; i < N; i++) P.trackProgress(data[ids[i % ids.length]], kinds2[i % kinds2.length], NOW);
  results.eventUsRev2Mix = (ms(t2) * 1000) / N;
  console.log(`   trackProgress (rev-2 event mix incl. daily/weekly/streak/trainers): ${fmt(results.eventUsRev2Mix)} µs/event`);
  // Worst case: the largest collection, capture event (full collection pass).
  const big = ids.reduce((a, b) => (Object.keys(data[a].pokemon).length >= Object.keys(data[b].pokemon).length ? a : b));
  const t1 = performance.now();
  for (let i = 0; i < 1000; i++) P.trackProgress(data[big], kinds[0], NOW);
  results.worstEventUs = ms(t1);
  console.log(`   trackProgress: avg ${fmt(results.eventUs)} µs/event (${N} mixed events), worst (${Object.keys(data[big].pokemon).length}-species capture) ${fmt(results.worstEventUs)} µs`);
  assertTrue(results.worstEventUs < 20_000, "worst-case event under 20 ms");
}

section("View cost");
{
  const t0 = performance.now();
  for (const id of ids) P.achievementView(data[id]);
  results.viewUs = (ms(t0) * 1000) / ids.length;
  console.log(`   achievementView: ${fmt(results.viewUs)} µs/player`);
  assertTrue(results.viewUs < 50_000, "view under 50 ms per player");
}

section("Snapshot size and write");
{
  const text = JSON.stringify(data);
  const sizeAfter = Buffer.byteLength(text);
  results.sizeBefore = sizeBefore;
  results.sizeAfter = sizeAfter;
  const growth = sizeAfter - sizeBefore;
  console.log(`   snapshot: ${(sizeBefore / 1e6).toFixed(2)} MB → ${(sizeAfter / 1e6).toFixed(2)} MB (+${(growth / 1e3).toFixed(1)} KB, +${((100 * growth) / sizeBefore).toFixed(2)}%, ${(growth / PLAYERS).toFixed(0)} B/player)`);
  assertTrue(growth / sizeBefore < 0.25, "achievement fields add under 25% to the snapshot");
  store.__resetLocalStoreForTests();
  store.setEpoch(1);
  const t0 = performance.now();
  await store.writeSnapshot(data);
  results.writeMs = ms(t0);
  const [cur] = await store.readLocalCandidates();
  console.log(`   durable snapshot write: ${fmt(results.writeMs)} ms`);
  assertTrue(JSON.stringify(cur.data[ids[0]].ach ?? {}) === JSON.stringify(data[ids[0]].ach ?? {}), "written snapshot round-trips achievement state");
}

console.log(`BENCH_RESULTS ${JSON.stringify(results)}`);
await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
