// ==========================================================
// tools/challenge-gates.mjs — a Challenge's gate Level (the lowest Level at
// which a Team of six random stand-ins wins half its tries), measured the
// way tests/challengeBalance.test.js measures it: the same stand-in pool,
// seeds and Revive picks. Used to tune utils/battle/tuning.js
// FULL_SIM.challengeStatBoost.
//
//   node tools/challenge-gates.mjs <key> [--engine full|legacy] [--boost 1.05] [--n 200]
//       prints the gate Level (--boost overrides the opponents' stat boost)
//   node tools/challenge-gates.mjs <key> --target 73 [--n 200]
//       full sim: finds the stat boost at which a Team at Lv 73 wins half
//       its tries, then prints the gate Level with that boost
// ==========================================================

import { readFileSync } from "fs";
import { simulateChallenge } from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { simulateBattle, loadFullSim } from "../utils/battle/sim.js";
import { teamPower } from "../utils/battle/power.js";
import { createRng } from "../utils/battle/rng.js";
import { catchBand } from "../utils/training.js";

const args = process.argv.slice(2);
const key = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!CHALLENGES[key]) throw new Error(`usage: node tools/challenge-gates.mjs <${Object.keys(CHALLENGES).join("|")}> [options]`);
const target = opt("target", null) == null ? null : Number(opt("target"));
const engine = target != null ? "full" : opt("engine", "full");
const N = Number(opt("n", 200));
if (engine === "full") {
  process.env.FULL_SIM_ENABLED = "1";
  await loadFullSim();
}

// The stand-in method of tests/challengeBalance.test.js.
const battleData = JSON.parse(readFileSync(new URL("../battleData.json", import.meta.url)));
const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url)));
const SEED = 20261109;
const pool = Object.keys(battleData.species).map(Number)
  .filter((id) => pokemonData[id] && !(pokemonData[id].evolvesTo ?? []).length && catchBand(id) !== "legendary");
function standIn(level, i) {
  const rng = createRng(SEED + i);
  const picked = new Set();
  while (picked.size < 6) picked.add(pool[rng.int(pool.length)]);
  return [...picked].map((speciesId) => ({ speciesId, variant: "normal", level }));
}
const simSeed = (i) => SEED + 8 * i;
const pickStrongest = ({ team, hp }) => hp.reduce((best, h, slot) =>
  (h === 0 && (best === null || teamPower([team[slot]]) > teamPower([team[best]])) ? slot : best), null);

// boost null: the roster's own boost for this engine.
const simulateWith = (boost) => (input) => simulateBattle({
  ...input,
  engine,
  sides: boost == null ? input.sides : [input.sides[0], { ...input.sides[1], members: input.sides[1].members.map((m) => ({ ...m, statMult: boost })) }],
});
const winRate = (level, boost) => {
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const run = simulateChallenge({ team: standIn(level, i), opponents: CHALLENGES[key].opponents, seed: simSeed(i), pick: pickStrongest, engine, simulate: simulateWith(boost) });
    if (run.cleared) wins++;
  }
  return wins / N;
};
function gate(boost) {
  if (winRate(100, boost) < 0.5) return 101;
  let lo = 1, hi = 100;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (winRate(mid, boost) >= 0.5) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const started = Date.now();
let boost = opt("boost", null) == null ? null : Number(opt("boost"));
if (target != null) {
  // The largest boost (to 0.005) at which a Team at the target Level still wins half its tries.
  let [lo, hi] = [0.7, 1.3];
  if (winRate(target, lo) < 0.5) throw new Error(`even a ${lo} boost keeps ${key} above Lv ${target}`);
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2;
    if (winRate(target, mid) >= 0.5) lo = mid; else hi = mid;
  }
  boost = Math.floor(lo * 100) / 100;
}
const g = gate(boost);
console.log(`${key}: ${engine} engine, boost ${boost ?? "roster"}, gate Lv ${g}${target != null ? ` (target Lv ${target})` : ""}, n ${N}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
