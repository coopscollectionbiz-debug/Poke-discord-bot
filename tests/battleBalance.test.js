// ==========================================================
// tests/battleBalance.test.js
// Monte Carlo check of the spec's upset targets: how often the Underdog
// wins at each Power rating gap, with the real surge + sim. Also prints
// battle lengths (sets TURN_CAP: ≥ 3× p99).
// ==========================================================

import fs from "fs";
import { assertBetween, assertTrue, section, finish } from "./harness.js";
import { simulateBattle } from "../utils/battle/sim.js";
import { teamPower, rollSurge } from "../utils/battle/power.js";
import { createRng } from "../utils/battle/rng.js";
import { rollCatchLevel } from "../utils/training.js";
import { TURN_CAP } from "../utils/battle/tuning.js";

const ids = Object.keys(JSON.parse(fs.readFileSync(new URL("../battleData.json", import.meta.url), "utf8")).species).map(Number);
const rng = createRng(20261102);

const randomTeam = () =>
  Array.from({ length: 3 + rng.int(4) }, () => {
    const speciesId = ids[rng.int(ids.length)];
    return { speciesId, variant: "normal", level: rollCatchLevel(speciesId, rng.next) };
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
    const r = simulateBattle({ sides: sides.map((members) => ({ members })), seed: seed + 1, surge });
    turns.push(r.turns);
    if (r.winner === weakSide) wins++;
    n++;
  }
  return wins / count;
}

section("Underdog win rate by Power rating ratio");
const started = Date.now();
const even = underdogWinRate(1, 1.1, 2000);
const double = underdogWinRate(1.8, 2.2, 2000);
const fivefold = underdogWinRate(5, 8, 20000);
assertBetween(even, 0.35, 0.65, "≈1× gap");
assertBetween(double, 0.03, 0.10, "2× gap");
assertBetween(fivefold, 0.003, 0.03, "≥5× gap");
assertTrue(fivefold > 0, "≥5× upsets still happen");

section("Battle length");
turns.sort((a, b) => a - b);
const pct = (p) => turns[Math.floor((turns.length - 1) * p)];
const capShare = turns.filter((t) => t >= TURN_CAP).length / turns.length;
console.log(`  turns: mean ${(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1)}, p90 ${pct(0.9)}, p99 ${pct(0.99)}, max ${turns.at(-1)}; turn-cap share ${(capShare * 100).toFixed(2)}%`);
assertTrue(TURN_CAP >= 3 * pct(0.99), `TURN_CAP (${TURN_CAP}) ≥ 3 × p99`);
console.log(`  runtime ${((Date.now() - started) / 1000).toFixed(1)}s`);

finish();
