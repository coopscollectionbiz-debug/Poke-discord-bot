// ==========================================================
// tests/challengeBalance.test.js
// Measures how hard each Challenge is (docs/superpowers/specs/
// 2026-11-08-challenges-design.md, Difficulty) and enforces the order
// Giovanni < Elite Four run < Blue < Red. Prints the numbers the spec's
// Open checks quote: gate Levels, win-rate curves, how often a surge
// turns a loss into a win, and leveling pace with 5 challenges a day.
//
// A gate Level is the lowest uniform Team Level at which stand-in Teams
// win at least half the time. A stand-in Team is 6 random distinct fully
// evolved (no evolvesTo), non-legendary-band species at one Level.
// ==========================================================

import { readFileSync } from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { simulateChallenge } from "../utils/challenge/runChallenge.js";
import { CHALLENGES, CHALLENGE_KEYS } from "../utils/challenge/roster.js";
import { catchBand, expForLevel, levelForExp } from "../utils/training.js";
import { simulateBattle } from "../utils/battle/sim.js";
import { teamPower, rollSurge } from "../utils/battle/power.js";
import { teamExp } from "../utils/battle/rewards.js";
import { createRng } from "../utils/battle/rng.js";
import { SURGE } from "../utils/battle/tuning.js";

const started = Date.now();
const battleData = JSON.parse(readFileSync(new URL("../battleData.json", import.meta.url)));
const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url)));
const SEED = 20261109;
const N = 200;

const pool = Object.keys(battleData.species).map(Number)
  .filter((id) => pokemonData[id] && !(pokemonData[id].evolvesTo ?? []).length && catchBand(id) !== "legendary");

// Sample i uses the same 6 species and sim seeds at every Level, so win
// rate rises (almost) monotonically with Level and binary search works.
function standIn(level, i) {
  const rng = createRng(SEED + i);
  const picked = new Set();
  while (picked.size < 6) picked.add(pool[rng.int(pool.length)]);
  return [...picked].map((speciesId) => ({ speciesId, variant: "normal", level }));
}
const simSeed = (i) => SEED + 8 * i; // a run uses seed .. seed + 7

const winRate = (key, level, n = N) => {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    if (simulateChallenge({ team: standIn(level, i), opponents: CHALLENGES[key].opponents, seed: simSeed(i) }).cleared) wins++;
  }
  return wins / n;
};

function gate(key) {
  if (winRate(key, 100) < 0.5) return 101;
  let lo = 1, hi = 100; // winRate(hi) >= 0.5
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (winRate(key, mid) >= 0.5) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

section("Stand-in pool");
assertTrue(pool.length > 200, `${pool.length} fully evolved, non-legendary species`);
assertTrue(!pool.includes(3) || catchBand(3) !== "legendary", "Venusaur (Tier legendary, Stage 3) stays in the pool");
assertTrue(!pool.includes(150) && !pool.includes(1), "Mewtwo (legendary band) and Bulbasaur (evolves) are out");

section("Gate Levels");
const gates = Object.fromEntries(CHALLENGE_KEYS.map((key) => [key, gate(key)]));
for (const key of CHALLENGE_KEYS) {
  const ace = Math.max(...CHALLENGES[key].opponents.flatMap((o) => o.team.map((m) => m.level)));
  console.log(`  ${CHALLENGES[key].label.padEnd(10)} gate Lv ${gates[key]} (ace Lv ${ace})`);
}
assertTrue(gates.giovanni < gates.elite4 && gates.elite4 < gates.blue && gates.blue < gates.red,
  `Giovanni ${gates.giovanni} < Elite Four ${gates.elite4} < Blue ${gates.blue} < Red ${gates.red}`);

section("Win rate by Level");
{
  const levels = [20, 30, 40, 50, 60, 70, 80, 90, 100];
  console.log(`  ${"".padEnd(10)} ${levels.map((l) => `Lv${l}`.padStart(5)).join(" ")}`);
  for (const key of CHALLENGE_KEYS) {
    const row = levels.map((l) => `${Math.round(winRate(key, l) * 100)}%`.padStart(5)).join(" ");
    console.log(`  ${CHALLENGES[key].label.padEnd(10)} ${row}`);
  }
  // How wide the climb is: Levels from a 10% to a 90% win rate.
  for (const key of ["brock", "giovanni", "elite4", "blue", "red"]) {
    let l10 = null, l90 = null;
    for (let l = 1; l <= 100 && l90 === null; l++) {
      const r = winRate(key, l, 100);
      if (l10 === null && r >= 0.1) l10 = l;
      if (r >= 0.9) l90 = l;
    }
    console.log(`  ${CHALLENGES[key].label}: 10% at Lv ${l10}, 90% at Lv ${l90 ?? ">100"}`);
  }
}

section("Underdog surge at gate - 5");
{
  // The same fight loop as simulateChallenge, with the surge chosen by `surgeOf`.
  function fightAll(team, opponents, seed, surgeOf) {
    let members = team;
    for (const [i, o] of opponents.entries()) {
      const foes = o.team.map((m) => ({ ...m, variant: "normal" }));
      const alive = members.filter((m) => m.hpFraction === undefined || m.hpFraction > 0);
      const surge = surgeOf([teamPower(alive), teamPower(foes)], seed + 2 * i);
      const r = simulateBattle({ sides: [{ members }, { members: foes }], seed: seed + 2 * i + 1, surge });
      if (r.winner !== 0) return false;
      members = team.map((m, s) => ({ ...m, hpFraction: r.snapshots.at(-1)[0][s] }));
    }
    return true;
  }
  const natural = (powers, seed) => { const s = rollSurge(powers, seed); return s?.side === 0 ? s : null; };
  const never = () => null;
  // The boost a surge gives when it fires (rollSurge's levelMult), forced on.
  const always = ([p, q]) => (p < q ? { side: 0, levelMult: Math.max(1, q / p / SURGE.residual) } : null);

  const same = CHALLENGE_KEYS.every((key) => [0, 1, 2].every((i) =>
    fightAll(standIn(45, i), CHALLENGES[key].opponents, simSeed(i), natural)
      === simulateChallenge({ team: standIn(45, i), opponents: CHALLENGES[key].opponents, seed: simSeed(i) }).cleared));
  assertTrue(same, "the local loop matches simulateChallenge");

  // Of the runs lost without a surge: how many the natural roll turns into
  // wins, and how many a surge would win if it always fired.
  for (const key of CHALLENGE_KEYS) {
    const level = Math.max(1, gates[key] - 5);
    let losses = 0, naturalWins = 0, forcedWins = 0, fired = 0;
    for (let i = 0; i < N; i++) {
      const team = standIn(level, i);
      const opponents = CHALLENGES[key].opponents;
      if (simulateChallenge({ team, opponents, seed: simSeed(i) }).fights.some((f) => f.surge)) fired++;
      if (fightAll(team, opponents, simSeed(i), never)) continue;
      losses++;
      if (fightAll(team, opponents, simSeed(i), natural)) naturalWins++;
      if (fightAll(team, opponents, simSeed(i), always)) forcedWins++;
    }
    const pct = (x, of) => `${of ? Math.round((100 * x) / of) : 0}%`;
    console.log(`  ${CHALLENGES[key].label.padEnd(10)} Lv ${level}: surges in ${pct(fired, N)} of runs; ` +
      `turns ${pct(naturalWins, losses)} of losses into wins (${pct(forcedWins, losses)} if it always fired)`);
  }
}

section("Leveling pace");
{
  // battleRewards.test.js's model for 10 Battles a day: half wins (6
  // knockouts), half losses (3), against the species closest to the
  // average base stat total at the player's Level.
  const ids = Object.keys(battleData.species);
  const bstOf = (id) => Object.values(battleData.species[id].baseStats).reduce((a, b) => a + b, 0);
  const avg = ids.reduce((t, id) => t + bstOf(id), 0) / ids.length;
  const typical = ids.reduce((best, id) => (Math.abs(bstOf(id) - avg) < Math.abs(bstOf(best) - avg) ? id : best));
  const battleExp = (level) => {
    const foes = (n) => Array.from({ length: n }, () => ({ speciesId: typical, level }));
    const [win] = teamExp({ members: [{ level }], knockedOut: foes(6), won: true });
    const [loss] = teamExp({ members: [{ level }], knockedOut: foes(3), won: false });
    return (win + loss) / 2;
  };
  // The worst case: a cleared Elite Four run, all 24 knockouts, win bonus on each fight.
  const runExp = (level) => CHALLENGES.elite4.opponents
    .reduce((t, o) => t + teamExp({ members: [{ level }], knockedOut: o.team, won: true })[0], 0);

  const days = (from, runsPerDay) => {
    let exp = expForLevel(from), level = from, d = 0;
    while (level < 100) {
      d++;
      for (let b = 0; b < 10; b++) { exp += battleExp(level); level = Math.min(100, levelForExp(exp)); }
      for (let r = 0; r < runsPerDay; r++) { exp += runExp(level); level = Math.min(100, levelForExp(exp)); }
    }
    return d;
  };
  const from = Math.min(gates.elite4, 99);
  const battlesOnly = days(from, 0);
  const withRuns = days(from, 5);
  console.log(`  Lv ${from} → 100: ${battlesOnly} days at 10 Battles a day; ${withRuns} days with 5 cleared Elite Four runs a day too`);
  assertTrue(withRuns <= battlesOnly, "challenges never slow leveling down");
}

const ms = Date.now() - started;
console.log(`\n  runtime ${(ms / 1000).toFixed(1)}s`);
assertEqual(typeof ms, "number", "measured");

finish();
