// ==========================================================
// tests/fullSimCutenessBalance.slow.js — tests/cutenessBalance.test.js on the full
// sim (Showdown's engine, Battle-plan AI, Gen 9 Power ratings): the same
// targets with every battle awaited, since runBattle returns a Promise there.
// Generated from that file; keep the two in step.
//
// The cute surge's open checks (docs/superpowers/specs/2026-11-11-cuteness-design.md):
// how often a Team averaging 10, and a Team of the cutest Pokémon, beats a
// Team of mythics, at the same Level, across a Level gap, and as a Team of
// one; how a typical cute Team does; how many random
// Teams are cute at all; and the EXP from a cute win. Every battle goes
// through runBattle with synthetic players. Prints every row.
// ==========================================================

process.env.FULL_SIM_ENABLED = "1"; // set before any battle module reads it
import fs from "fs";
import { assertTrue, section, finish } from "./harness.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { getSpecies } from "../utils/battle/data.js";
import { teamCuteness, cuteFactor } from "../utils/battle/cuteness.js";
import { CUTE } from "../utils/battle/tuning.js";
import { createNewUser } from "../utils/userSchema.js";
import { createRng } from "../utils/battle/rng.js";

const quiet = console.log;
console.log = (...a) => { if (!String(a[0]).includes("loaded from memory")) quiet(...a); };

const N = 2000; // battles per row
const NOW = new Date("2026-11-11T12:00:00Z");
const SCORES = JSON.parse(fs.readFileSync(new URL("../data/battle/cuteness.json", import.meta.url), "utf8")).species;
const DEX = JSON.parse(fs.readFileSync(new URL("../public/pokemonData.json", import.meta.url), "utf8"));
const species = (Array.isArray(DEX) ? DEX : Object.values(DEX)).filter((p) => getSpecies(Number(p.id))?.baseStats);
const pool = (test) => species.filter(test).map((p) => Number(p.id));
const PERFECT = pool((p) => SCORES[p.id] === 10); // owner, 2026-11-11: a Team averaging 10 wins 42%
const CUTEST = pool((p) => SCORES[p.id] >= 9);
const TYPICAL = pool((p) => SCORES[p.id] >= 6 && SCORES[p.id] <= 7);
const MYTHICS = pool((p) => p.tier === "mythic");
const ORDINARY = pool((p) => p.generation <= 5 && !["legendary", "mythic"].includes(p.tier));

const rng = createRng(20261111);
const pick = (from, n) => {
  const left = [...from];
  return Array.from({ length: n }, () => left.splice(Math.floor(rng.next() * left.length), 1)[0]);
};
function player(id, ids, level) {
  const u = createNewUser(id, id);
  for (const sid of ids) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = ids.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}
const pct = (x) => `${Math.round(100 * x)}%`;

// One row: N casual battles of a fresh cute Team (A, the Challenger) against
// six fresh mythics (B). Returns the cute surge rate, the win rate once one
// fires, and the overall win rate.
async function row(label, cuteTeam, aLevel, bLevel) {
  let cute = 0, cuteWins = 0, wins = 0;
  for (let i = 0; i < N; i++) {
    const trainerData = { A: player("A", cuteTeam(), aLevel), B: player("B", pick(MYTHICS, 6), bLevel) };
    const out = await runBattle({ trainerData, challengerId: "A", defenderId: "B", mode: "open", seed: 1000 + i * 7, now: NOW });
    const won = out.winnerId === "A";
    if (out.surge?.cute) { cute++; if (won) cuteWins++; }
    if (won) wins++;
  }
  const r = { cuteRate: cute / N, cuteWin: cute ? cuteWins / cute : 1, win: wins / N };
  console.log(`  ${label}: cute surge ${pct(r.cuteRate)}, wins once it fires ${pct(r.cuteWin)}, wins overall ${pct(r.win)}`);
  return r;
}

section("A Team of six scored 10 against six mythics");
{
  for (const level of [10, 50, 90]) {
    const r = await row(`six at Lv ${level} vs six at Lv ${level}`, () => pick(PERFECT, 6), level, level);
    assertTrue(r.win >= 0.36 && r.win <= 0.48, `Lv ${level}: wins about 42% (${pct(r.win)})`);
  }
}

section("A Team of the cutest Pokémon (scored 9 or 10) against six mythics");
{
  for (const level of [10, 30, 50, 70, 90]) {
    const r = await row(`six at Lv ${level} vs six at Lv ${level}`, () => pick(CUTEST, 6), level, level);
    assertTrue(r.win >= 0.32 && r.win <= 0.45, `Lv ${level}: wins about 37% (${pct(r.win)})`);
    assertTrue(r.cuteWin >= 0.9, `Lv ${level}: a cute surge wins (${pct(r.cuteWin)})`);
  }
  const gap = await row("six at Lv 20 vs six at Lv 90", () => pick(CUTEST, 6), 20, 90);
  assertTrue(gap.cuteWin >= 0.9 && gap.win >= 0.32, `across a Level gap too (${pct(gap.win)})`);
  const lone = await row("one at Lv 30 vs six at Lv 30", () => pick(CUTEST, 1), 30, 30);
  assertTrue(lone.cuteWin >= 0.9 && lone.win >= 0.32, `and as a Team of one, with no cap (${pct(lone.win)})`);
}

section("A typical cute Team (scored 6 or 7)");
{
  const teams = Array.from({ length: 2000 }, () => pick(TYPICAL, 6).map((speciesId) => ({ speciesId })));
  const expected = teams.reduce((t, m) => t + CUTE.chance * cuteFactor(teamCuteness(m)), 0) / teams.length;
  const r = await row("six at Lv 50 vs six at Lv 50", () => pick(TYPICAL, 6), 50, 50);
  console.log(`  expected cute surge chance for such a Team: ${(100 * expected).toFixed(1)}%`);
  assertTrue(Math.abs(r.cuteRate - expected) < 0.05, `fires at its smaller chance (${pct(r.cuteRate)})`);
  assertTrue(r.win >= 0.15 && r.win <= 0.25, `wins about 20%, the owner's target (${pct(r.win)})`);
  assertTrue(r.cuteWin >= 0.9, `and still wins once it does (${pct(r.cuteWin)})`);
}

section("Ordinary Teams");
{
  // Random Teams of six from the species players can catch (Gens 1-5, no legendaries or mythics).
  const teams = Array.from({ length: 5000 }, () => pick(ORDINARY, 6).map((speciesId) => ({ speciesId })));
  const cute = teams.filter((t) => teamCuteness(t) > CUTE.threshold);
  const meanChance = teams.reduce((s, t) => s + CUTE.chance * cuteFactor(teamCuteness(t)), 0) / teams.length;
  console.log(`  ${pct(cute.length / teams.length)} of random Teams average over ${CUTE.threshold}; their average cute surge chance as an Underdog is ${(100 * meanChance).toFixed(1)}%`);
  assertTrue(cute.length / teams.length < 0.25, "most random Teams aren't cute");
}

section("EXP from a cute win");
{
  let shown = false;
  for (let i = 0; !shown && i < 2000; i++) {
    const trainerData = { A: player("A", pick(CUTEST, 6), 20), B: player("B", pick(MYTHICS, 6), 90) };
    const out = await runBattle({ trainerData, challengerId: "A", defenderId: "B", mode: "open", seed: 5000 + i, now: NOW });
    if (!out.surge?.cute || out.winnerId !== "A") continue;
    const ups = out.exp.A.map((e) => e.toLevel - e.fromLevel);
    console.log(`  six Lv 20s beat six Lv 90 mythics: +${out.exp.A[0].gained.toLocaleString("en-US")} EXP each, ${Math.min(...ups)} to ${Math.max(...ups)} Levels`);
    assertTrue(Math.max(...ups) <= 5, "a few Levels, not a farm");
    shown = true;
  }
  assertTrue(shown, "a cute win happened to measure");
}

finish();
