// ==========================================================
// tests/fullSimEncounterBalance.slow.js — tests/encounterBalance.test.js on the
// full sim (Showdown's engine, Gen 9 data), fought as fightEncounter fights
// them: each Trainer class's plan, skill and plan moves. Generated from
// that file; keep the two in step.
//
// Measures Trainer encounters (docs/superpowers/specs/2026-11-10-trainer-
// encounters-design.md, Open checks) and prints the numbers the spec's
// Measured section quotes: win rate per tier for Team sizes 1 to 6 at
// several average Levels, a Lv 100 Pokémon carrying five Lv 5s, the CC an
// encounter creates on average, and leveling pace with 8 a day.
//
// A stand-in Team is k random distinct fully evolved, non-legendary species
// at one Level, as in tests/challengeBalance.test.js. Fights run like
// fightEncounter: no surge, no stat boost, the Trainer's party as rolled.
// The only assertion is the order Under >= Even >= Over (5 points of slack
// for sampling noise); everything else is a measurement.
// ==========================================================

process.env.FULL_SIM_ENABLED = "1"; // set before any battle module reads it
import { classPlan } from "../catalog/opponentPlans.js";
import { planMoves } from "../services/battlePlans.js";
import { readFileSync } from "fs";
import { assertTrue, section, finish } from "./harness.js";
import { rollTrainer } from "../utils/encounter/generate.js";
import { simulateBattle, loadFullSim } from "../utils/battle/sim.js";
import { teamExp } from "../utils/battle/rewards.js";
import { catchBand, expForLevel, levelForExp, speciesName } from "../utils/training.js";
import { createRng } from "../utils/battle/rng.js";
import { ENCOUNTER } from "../utils/battle/tuning.js";

await loadFullSim(); // the full sim loads on first use (utils/battle/sim.js)

const started = Date.now();
const battleData = JSON.parse(readFileSync(new URL("../battleData.json", import.meta.url)));
const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url)));
const SEED = 20261110;
// Fights per tier per case. At 100, a one-Pokémon Team's 5-10% win rates
// moved by more than the 5 points of slack when the stand-in pool changed.
const N = 400;

const pool = Object.keys(battleData.species).map(Number)
  .filter((id) => pokemonData[id] && !(pokemonData[id].evolvesTo ?? []).length && catchBand(id) !== "legendary");
const mon = (speciesId, level) => ({ speciesId, variant: "normal", name: speciesName(speciesId), level });

function standIn(level, size, i) {
  const rng = createRng(SEED + i);
  const picked = new Set();
  while (picked.size < size) picked.add(pool[rng.int(pool.length)]);
  return [...picked].map((id) => mon(id, level));
}

// Rolls Trainers for `team` until each tier has N, fights them, and returns
// per tier: win rate, mean Prize money, and the count fought.
function measure(teamFor) {
  const out = Object.fromEntries(ENCOUNTER.tiers.map((t) => [t.key, { wins: 0, fights: 0, prize: 0 }]));
  for (let i = 0; ENCOUNTER.tiers.some((t) => out[t.key].fights < N); i++) {
    const team = teamFor(i);
    const trainer = rollTrainer({ team, seed: SEED + i });
    const bucket = out[trainer.tier];
    if (bucket.fights >= N) continue;
    const cpu = classPlan(trainer.classKey);
    const foes = trainer.party.map((m) => ({ ...mon(m.speciesId, m.level), moves: planMoves(m.speciesId, m.level, cpu.plan) }));
    const result = simulateBattle({ sides: [{ members: team }, { members: foes, ...cpu }], seed: SEED + i + 1, surge: null, engine: "full" });
    bucket.fights++;
    bucket.prize += trainer.prize;
    if (result.winner === 0) bucket.wins++;
  }
  return Object.fromEntries(Object.entries(out).map(([k, b]) => [k, { rate: b.wins / b.fights, prize: b.prize / b.fights }]));
}
const pct = (r) => `${Math.round(r * 100)}%`.padStart(4);
const ordered = (m) => m.under.rate + 0.05 >= m.even.rate && m.even.rate + 0.05 >= m.over.rate;

section("Win rate by tier");
const LEVELS = [10, 30, 60, 90];
const results = {};
console.log("  avg Lv  Team   Under  Even  Over");
for (const level of LEVELS) {
  for (let size = 1; size <= 6; size++) {
    const m = measure((i) => standIn(level, size, i));
    results[`${level}/${size}`] = m;
    console.log(`  ${String(level).padStart(6)}  ${String(size).padStart(4)}   ${pct(m.under.rate)}  ${pct(m.even.rate)}  ${pct(m.over.rate)}`);
  }
}
assertTrue(Object.values(results).every(ordered), "Under >= Even >= Over everywhere");

section("A Lv 100 Pokémon carrying five Lv 5s");
{
  const carry = (i) => [...standIn(100, 1, i), ...standIn(5, 6, i + 100000).slice(0, 5)];
  const m = measure(carry);
  console.log(`  (avg Lv ${Math.round((100 + 25) / 6)})  Under ${pct(m.under.rate)}  Even ${pct(m.even.rate)}  Over ${pct(m.over.rate)};` +
    ` mean Prize money Under ${Math.round(m.under.prize)}, Over ${Math.round(m.over.prize)}`);
  assertTrue(ordered(m), "Under >= Even >= Over");
}

section("CC an encounter creates");
// Expected CC per accepted encounter: a win pays the Prize money, a loss pays
// the same (the player always holds enough here). Times 8 for a day.
for (const level of LEVELS) {
  const m = results[`${level}/6`];
  const perEncounter = ENCOUNTER.tiers.reduce((t, tier) => t + tier.share * m[tier.key].prize * (2 * m[tier.key].rate - 1), 0);
  const prizes = ENCOUNTER.tiers.map((tier) => `${tier.key} ${Math.round(m[tier.key].prize)}`).join(", ");
  console.log(`  avg Lv ${level}, Team of 6: ${Math.round(perEncounter)} CC per encounter, ${Math.round(8 * perEncounter)} a day at 8 (mean Prize money: ${prizes})`);
}

section("Leveling pace");
{
  // tests/challengeBalance.test.js's model for 10 Battles a day: half wins
  // (6 knockouts), half losses (3), against the species closest to the
  // average base stat total. Encounters are the worst case: every one
  // accepted and won, every Trainer Pokémon knocked out.
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
  const encounterExp = Array.from({ length: 101 }, (_, level) => {
    if (level === 0) return 0;
    let t = 0;
    for (let i = 0; i < 50; i++) {
      const trainer = rollTrainer({ team: [{ level }], seed: SEED + i });
      t += teamExp({ members: [{ level }], knockedOut: trainer.party, won: true })[0];
    }
    return t / 50;
  });
  const days = (from, encountersPerDay) => {
    let exp = expForLevel(from), level = from, d = 0;
    while (level < 100) {
      d++;
      for (let b = 0; b < 10; b++) { exp += battleExp(level); level = Math.min(100, levelForExp(exp)); }
      for (let e = 0; e < encountersPerDay; e++) { exp += encounterExp[level]; level = Math.min(100, levelForExp(exp)); }
    }
    return d;
  };
  for (const from of [5, 50]) {
    const [plain, with8] = [days(from, 0), days(from, 8)];
    console.log(`  Lv ${from} → 100: ${plain} days at 10 Battles a day; ${with8} days with 8 encounters a day too`);
    assertTrue(with8 <= plain, "encounters never slow leveling down");
  }
}

console.log(`\n  runtime ${((Date.now() - started) / 1000).toFixed(1)}s`);

finish();
