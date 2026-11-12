// ==========================================================
// tests/cuteness.test.js
// Cuteness and the cute surge (docs/superpowers/specs/2026-11-11-cuteness-design.md):
// the scores, a Team's Cuteness, today's surge unchanged for Teams that
// aren't cute, the cute surge's chance and strength, EXP at the surged
// Levels, the heading, casual battles only, and the scores staying out of
// anything players can read. Synthetic players only.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { memberCuteness, teamCuteness, cuteFactor } from "../utils/battle/cuteness.js";
import { teamPower, surgeChance, rollSurge, cuteSurgeBoost } from "../utils/battle/power.js";
import { SURGE, CUTE } from "../utils/battle/tuning.js";
import { createRng } from "../utils/battle/rng.js";
import { teamExp } from "../utils/battle/rewards.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { playBattle, createQueue } from "../utils/battle/playback.js";
import { allMegas } from "../utils/megas.js";
import { createNewUser } from "../utils/userSchema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // works on Windows too (URL.pathname gives "/E:/…")
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "data/battle/cuteness.json"), "utf8"));
const NOW = new Date("2026-11-11T12:00:00Z");
const CUTE_IDS = [25, 39, 133, 35, 175, 300]; // Pikachu, Jigglypuff, Eevee, Clefairy, Togepi, Skitty
const MYTHIC_IDS = [151, 251, 385, 490, 492, 494];
const team = (ids, level) => ids.map((speciesId) => ({ speciesId, variant: "normal", level, name: String(speciesId) }));

section("Scores");
{
  const whole = (v) => Number.isInteger(v) && v >= 0 && v <= 10;
  const ids = Object.keys(DATA.species).map(Number).sort((a, b) => a - b);
  assertEqual(ids, Array.from({ length: 1025 }, (_, i) => i + 1), "every species from 1 to 1,025 has a score");
  assertTrue(Object.values(DATA.species).every(whole), "each a whole number from 0 to 10");
  assertEqual(Object.keys(DATA.megas).sort(), allMegas().map((f) => f.id).sort(), "every Mega form has its own score, and nothing else is listed");
  assertTrue(Object.values(DATA.megas).every(whole), "each a whole number from 0 to 10");
  // Owner, 2026-11-11: two clusters, strict. Not cute at 0 to 2, cute
  // mostly at 6 to 7, and only a handful of 10s.
  const scores = Object.values(DATA.species);
  const share = (test) => scores.filter(test).length / scores.length;
  assertTrue(share((v) => v >= 3 && v <= 5) <= 0.1, `two clusters, with few between them (${Math.round(100 * share((v) => v >= 3 && v <= 5))}% score 3 to 5)`);
  assertTrue(share((v) => v <= 2) >= 0.4 && share((v) => v >= 6) >= 0.2, "most not cute, a real cute cluster");
  assertTrue(share((v) => v >= 6 && v <= 7) > share((v) => v >= 8), "the cute cluster sits mostly at 6 to 7");
  assertTrue(scores.filter((v) => v === 10).length <= 10, `only a handful of 10s (${scores.filter((v) => v === 10).length})`);
}

section("A Team's Cuteness");
{
  assertEqual(memberCuteness({ speciesId: 25 }), DATA.species["25"], "a Pokémon's score");
  assertEqual(memberCuteness({ speciesId: 6, megaForm: "mega-charizard-x" }), DATA.megas["mega-charizard-x"], "a slot fighting as a Mega uses the Mega form's score");
  const ids = [25, 150, 133];
  assertEqual(teamCuteness(team(ids, 30)), ids.reduce((t, id) => t + DATA.species[id], 0) / 3, "a Team's Cuteness is its members' average");
  assertEqual(teamCuteness(team([25], 30)), DATA.species["25"], "so one Pokémon is the whole Team's Cuteness");
  assertEqual(teamCuteness([]), 0, "an empty Team has none");
  assertEqual([cuteFactor(0), cuteFactor(5), cuteFactor(10), cuteFactor(12)], [0, 0, 1, 1], "the boost starts above 5 and is full at 10");
  // Owner, 2026-11-11: a Team averaging 10 wins 42% and a typical cute Team (about 6.3) 20%, which a straight line can't do.
  assertTrue(cuteFactor(5.5) > 0.1 && cuteFactor(6) > 0.2 && cuteFactor(7.5) > 0.5, "it climbs fastest just above 5, ahead of a straight line");
  assertTrue([5.5, 6, 7, 8, 9, 10].every((c, i, a) => i === 0 || cuteFactor(c) > cuteFactor(a[i - 1])), "and keeps climbing all the way to 10");
}

section("Today's surge is unchanged for Teams averaging 5 or less");
{
  // The surge as it was before Cuteness: the seed's first draw against today's chance.
  const today = ([a, b], seed) => {
    const { underdog, chance } = surgeChance(a, b);
    if (underdog === null || createRng(seed).next() >= chance) return null;
    return { side: underdog, levelMult: Math.max(1, Math.max(a, b) / Math.min(a, b) / SURGE.residual) };
  };
  let same = true;
  for (const powers of [[100, 100], [100, 140], [100, 300], [600, 100]]) {
    for (let seed = 1; seed <= 2000; seed++) {
      const want = JSON.stringify(today(powers, seed));
      if (JSON.stringify(rollSurge(powers, seed)) !== want || JSON.stringify(rollSurge(powers, seed, [5, 5])) !== want) same = false;
    }
  }
  assertTrue(same, "seed for seed, the same surges as before at Cuteness 0 and 5");
  let strongerCute = true;
  for (let seed = 1; seed <= 2000; seed++) if (JSON.stringify(rollSurge([100, 300], seed, [0, 10])) !== JSON.stringify(today([100, 300], seed))) strongerCute = false;
  assertTrue(strongerCute, "the stronger Team's Cuteness never counts");
  // A cute Underdog's ordinary surge (the cute roll missed) is today's surge,
  // object for object: tests/megaBattleRegression.test.js records them.
  let ordinary = true, seen = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const s = rollSurge([100, 300], seed, [10, 0]);
    if (s && !s.cute) { seen++; if (JSON.stringify(s) !== JSON.stringify(today([100, 300], seed))) ordinary = false; }
  }
  assertTrue(seen > 0 && ordinary, `a cute Underdog's ordinary surge is exactly today's (${seen} seen)`);
}

section("The cute surge");
{
  const powers = [teamPower(team(CUTE_IDS, 30)), teamPower(team(MYTHIC_IDS, 30))];
  const rolls = (cuteness) => Array.from({ length: 4000 }, (_, i) => rollSurge(powers, i + 1, [cuteness, 0]));
  const cuteRate = (cuteness) => rolls(cuteness).filter((s) => s?.cute).length / 4000;
  assertTrue(Math.abs(cuteRate(10) - CUTE.chance) < 0.025, `at Cuteness 10 it fires at CUTE.chance (${Math.round(100 * cuteRate(10))}%)`);
  assertTrue(Math.abs(cuteRate(7.5) - CUTE.chance * cuteFactor(7.5)) < 0.025, `at 7.5, CUTE.chance times the curve (${Math.round(100 * cuteRate(7.5))}%)`);
  assertEqual(rolls(10).find((s) => s?.cute).side, 0, "for the Underdog");
  assertEqual(rollSurge([100, 110], 1, [10, 0]), null, "no Underdog (a gap under SURGE.minRatio), no cute surge");

  const boost = cuteSurgeBoost(team(CUTE_IDS, 30), CUTE.margin * powers[1]);
  const lifted = team(CUTE_IDS, 30).map((m) => ({ ...m, level: Math.min(100, Math.round(30 * boost.levelMult)) }));
  assertTrue(Math.abs(teamPower(lifted) * boost.statMult / (CUTE.margin * powers[1]) - 1) < 0.02, "it lifts the cute Team to CUTE.margin times the other Team's Power");
  const capped = cuteSurgeBoost(team(CUTE_IDS, 90), CUTE.margin * teamPower(team(MYTHIC_IDS, 100)));
  assertTrue(capped.statMult > 1, "past Lv 100 a stat boost makes up the rest");
  const lone = cuteSurgeBoost(team([25], 5), CUTE.margin * teamPower(team(MYTHIC_IDS, 100)));
  const loneLifted = Math.min(100, Math.round(5 * lone.levelMult));
  assertTrue(Math.abs(teamPower(team([25], loneLifted)) * lone.statMult / (CUTE.margin * teamPower(team(MYTHIC_IDS, 100))) - 1) < 0.02, "with no cap, even for one Lv 5 Pikachu against six Lv 100 mythics");
}

// Two synthetic players: A's Display team and B's.
function player(id, ids, level) {
  const u = createNewUser(id, id);
  for (const sid of ids) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = ids.map((sid) => ({ id: sid, variant: "normal" }));
  u.battleTeam = ids.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}
const pair = (aIds, aLevel, bIds, bLevel) => ({ A: player("A", aIds, aLevel), B: player("B", bIds, bLevel) });
const battle = (td, mode, seed, c = "A", d = "B") => runBattle({ trainerData: td, challengerId: c, defenderId: d, mode, stake: mode === "wager" ? 1 : 0, seed, now: NOW });
const cuteSeed = (aLevel, bLevel, c = "A", d = "B") => {
  for (let seed = 1; seed < 5000; seed++) if (battle(pair(CUTE_IDS, aLevel, MYTHIC_IDS, bLevel), "open", seed, c, d).surge?.cute) return seed;
  return null;
};

section("Casual battles only");
{
  const seed = cuteSeed(30, 30);
  assertTrue(seed !== null, "a cute Underdog gets cute surges in casual battles");
  const out = battle(pair(CUTE_IDS, 30, MYTHIC_IDS, 30), "open", seed);
  assertTrue(out.surge.cute && out.winnerId === "A", "and a cute surge wins");
  const surges = (mode) => Array.from({ length: 300 }, (_, i) => battle(pair(CUTE_IDS, 30, MYTHIC_IDS, 30), mode, i + 1).surge).filter(Boolean).length;
  assertEqual([surges("ranked"), surges("wager")], [0, 0], "ranked and wager battles never surge, cute or not");
  const asDefender = cuteSeed(30, 30, "B", "A");
  assertTrue(asDefender !== null && battle(pair(CUTE_IDS, 30, MYTHIC_IDS, 30), "open", asDefender, "B", "A").surge.side === 1, "the cute Team can be the Defender");
}

section("EXP after a cute surge counts the surged Levels");
{
  const seed = cuteSeed(20, 90);
  const out = battle(pair(CUTE_IDS, 20, MYTHIC_IDS, 90), "open", seed);
  const lifted = Math.min(100, Math.round(20 * out.surge.levelMult));
  const knocked = out.result.knockouts.filter((k) => k.bySide === 0).map((k) => out.sides[1].members[k.slot]);
  const want = teamExp({ members: out.sides[0].members.map((m) => ({ ...m, level: lifted })), knockedOut: knocked, won: true });
  assertEqual(out.exp.A.map((e) => e.gained), want, `each Pokémon earns as its surged Level (Lv ${lifted})`);
  const atReal = teamExp({ members: out.sides[0].members, knockedOut: knocked, won: true });
  assertTrue(want[0] < atReal[0] / 3, `far less than at its real Level (${want[0]} vs ${atReal[0]} EXP)`);
}

section("The heading");
{
  const heading = async (outcome) => {
    const sent = [];
    const channel = { send: async (o) => { sent.push(o); return { edit: async () => {} }; } };
    await playBattle(channel, outcome, { A: "Ash", B: "Gary" }, { maxUpdates: 1, delayMs: 0, queue: createQueue(1) });
    return sent[0].content;
  };
  const cuteOut = battle(pair(CUTE_IDS, 30, MYTHIC_IDS, 30), "open", cuteSeed(30, 30));
  assertEqual((await heading(cuteOut)).split("\n")[1], "💖 The crowd can't resist <@A>'s team! Underdog surge!", "a cute Team's surge: the cute line");
  let ordinaryCute = null;
  for (let seed = 1; !ordinaryCute && seed < 5000; seed++) {
    const o = battle(pair(CUTE_IDS, 30, MYTHIC_IDS, 30), "open", seed);
    if (o.surge && !o.surge.cute) ordinaryCute = o;
  }
  assertEqual((await heading(ordinaryCute)).split("\n")[1], "💖 The crowd can't resist <@A>'s team! Underdog surge!", "a cute Team's ordinary surge gets the cute line too");
  const plain = [6, 9, 3];
  let plainOut = null;
  for (let seed = 1; !plainOut && seed < 5000; seed++) {
    const o = battle(pair(plain, 20, MYTHIC_IDS, 60), "open", seed);
    if (o.surge) plainOut = o;
  }
  assertEqual((await heading(plainOut)).split("\n")[1], "🔥 The crowd is behind <@A>! Underdog surge!", "any other surge: today's line");
}

section("Players never see a score");
{
  assertTrue(!fs.existsSync(path.join(ROOT, "public/cuteness.json")) && !fs.existsSync(path.join(ROOT, "public/data/battle/cuteness.json")), "the scores aren't in public/, the only folder the web server serves");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(m?js|html|json)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const readers = ["bot_final.js", ...["public", "routes", "commands", "services"].flatMap((d) => walk(path.join(ROOT, d)).map((f) => path.relative(ROOT, f)))]
    .filter((f) => /cuteness/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assertEqual(readers, [], "no page, route, command or service reads them");
}

finish();
