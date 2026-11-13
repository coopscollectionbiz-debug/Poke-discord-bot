// ==========================================================
// tests/fullSimBalance.test.js
// The spec's upset targets on the full sim (Showdown's engine, Battle-plan
// AI, Gen 9 Power ratings): how often the Underdog wins at each Power
// rating gap with the real surge, as tests/battleBalance.test.js checks on
// today's engine. Also battle length against TURN_CAP. Samples are sized
// for about 10 ms per fight (tools/bench-full-sim.mjs).
// ==========================================================

import fs from "fs";
import { assertBetween, assertTrue, section, finish } from "./harness.js";
import { simulateBattle, loadFullSim } from "../utils/battle/sim.js";
import { teamPower, rollSurge } from "../utils/battle/power.js";
import { rollCatchLevel } from "../utils/training.js";
import { createRng } from "../utils/battle/rng.js";
import { TURN_CAP } from "../utils/battle/tuning.js";

await loadFullSim(); // the full sim loads on first use (utils/battle/sim.js)

process.env.FULL_SIM_ENABLED = "1"; // Gen 9 stats for Power ratings and moves
const ids = Object.keys(JSON.parse(fs.readFileSync(new URL("../data/battle/full-sim-data.json", import.meta.url), "utf8")).species).map(Number);
const rng = createRng(20261112);

const randomTeam = () =>
  Array.from({ length: 3 + rng.int(4) }, () => {
    const speciesId = ids[rng.int(ids.length)];
    return { speciesId, variant: "normal", name: `#${speciesId}`, level: rollCatchLevel(speciesId, rng.next) };
  });

// Scale `team`'s Levels until strong/weak power ratio lands in [lo, hi].
function weakenTo(strong, team, lo, hi) {
  const target = teamPower(strong);
  let [fLo, fHi] = [0.01, 10];
  for (let i = 0; i < 40; i++) {
    const f = (fLo + fHi) / 2;
    const scaled = team.map((m) => ({ ...m, level: Math.min(100, Math.max(1, Math.round(m.level * f))) }));
    const ratio = target / teamPower(scaled);
    if (ratio >= lo && ratio <= hi) return scaled;
    if (ratio > hi) fLo = f; else fHi = f;
  }
  return null;
}

const turns = [];
function underdogWinRate(lo, hi, count) {
  let wins = 0;
  let n = 0;
  while (n < count) {
    const strong = randomTeam();
    const weak = weakenTo(strong, randomTeam(), lo, hi);
    if (!weak) continue;
    const weakSide = rng.int(2);
    const sides = weakSide === 0 ? [weak, strong] : [strong, weak];
    const seed = rng.int(2 ** 31);
    const surge = rollSurge(sides.map(teamPower), seed);
    const r = simulateBattle({ sides: sides.map((members) => ({ members })), seed: seed + 1, surge, engine: "full" });
    turns.push(r.turns);
    if (r.winner === weakSide) wins++;
    n++;
  }
  return wins / count;
}

section("Underdog win rate by Power rating gap (full sim)");
const started = Date.now();
const even = underdogWinRate(1, 1.1, 600);
const double = underdogWinRate(1.8, 2.2, 1000);
const fivefold = underdogWinRate(5, 8, 4000);
console.log(`  even ${(even * 100).toFixed(1)}% · 2× ${(double * 100).toFixed(1)}% · 5×+ ${(fivefold * 100).toFixed(2)}%`);
assertBetween(even, 0.35, 0.65, "≈1× gap");
assertBetween(double, 0.03, 0.10, "2× gap");
assertBetween(fivefold, 0.003, 0.03, "≥5× gap");
assertTrue(fivefold > 0, "≥5× upsets still happen");

section("Battle length (full sim)");
turns.sort((a, b) => a - b);
const pct = (p) => turns[Math.floor((turns.length - 1) * p)];
console.log(`  turns: mean ${(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1)}, p90 ${pct(0.9)}, p99 ${pct(0.99)}, max ${turns.at(-1)}`);
assertTrue(TURN_CAP >= 3 * pct(0.99), `TURN_CAP (${TURN_CAP}) ≥ 3 × p99`);
console.log(`  runtime ${((Date.now() - started) / 1000).toFixed(1)}s`);

finish();
