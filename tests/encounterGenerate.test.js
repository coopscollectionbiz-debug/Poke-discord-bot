// ==========================================================
// tests/encounterGenerate.test.js
// Rolling an encounter Trainer from the player's Team (docs/superpowers/
// specs/2026-11-10-trainer-encounters-design.md, The Trainer): tier shares
// and Level bands around the Team's average, 3 to 6 Pokémon weakest to
// strongest, Ace Trainers only in Over, the 3% surprise, forms that fit
// their Level, the class theme, Prize money, and lines. Synthetic Teams only.
// ==========================================================

import { readFileSync } from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { rollTrainer, teamAverage, candidates, surprisePool, prizeMoney, legendaryLine } from "../utils/encounter/generate.js";
import { TRAINER_CLASSES, ACE_KEYS, NAMES, classSprite } from "../utils/encounter/roster.js";
import { LINES, OVER_INTRO } from "../utils/encounter/lines.js";
import { floorLevel } from "../utils/training.js";
import { isAcquirable } from "../utils/speciesCatalog.js";
import { TYPE_ID_TO_NAME } from "../utils/battle/data.js";

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url)));
const battleData = JSON.parse(readFileSync(new URL("../battleData.json", import.meta.url)));
const usable = (id) => isAcquirable(id) && Boolean(battleData.species[id]);
const hasFittingEvolution = (id, level) => (pokemonData[id]?.evolvesTo ?? []).some((e) => usable(e) && floorLevel(e) <= level);
const onTheme = (classKey, id) => {
  const theme = TRAINER_CLASSES[classKey].types;
  return !theme.length || pokemonData[id].types.some((t) => theme.includes(TYPE_ID_TO_NAME[t]));
};

const team = (level, n = 6) => Array.from({ length: n }, () => ({ level }));
const rolls = Array.from({ length: 20000 }, (_, i) => rollTrainer({ team: team(30), seed: i }));
const share = (list, f) => list.filter(f).length / list.length;
const regular = (r) => r.party.filter((_, i) => !(r.surprise && i === r.party.length - 1));
const tier = (key) => rolls.filter((r) => r.tier === key);

section("Tiers around the Team's average");
assertEqual(teamAverage([{ level: 10 }, { level: 11 }]), 11, "the rounded mean");
assertEqual(teamAverage([{ level: 100 }, ...team(5, 5)]), 21, "one strong Pokémon lifts the mean, not the max");
assertTrue(Math.abs(share(rolls, (r) => r.tier === "under") - 0.7) < 0.015, "70% Under");
assertTrue(Math.abs(share(rolls, (r) => r.tier === "even") - 0.2) < 0.015, "20% Even");
assertTrue(Math.abs(share(rolls, (r) => r.tier === "over") - 0.1) < 0.015, "10% Over");
assertTrue(tier("under").every((r) => regular(r).every((m) => m.level >= 15 && m.level <= 28)), "Under: avg -15 to -2");
assertTrue(tier("even").every((r) => r.party.every((m) => m.level >= 28 && m.level <= 32)), "Even: avg -2 to +2");
assertTrue(tier("over").every((r) => r.party.every((m) => m.level >= 35 && m.level <= 45)), "Over: avg +5 to +15");
const levels = new Set(tier("under").flatMap((r) => regular(r).map((m) => m.level)));
assertTrue([15, 28].every((lv) => levels.has(lv)), "each Pokémon rolls its own Level across the whole band");
assertTrue([5, 100].every((lv) => Array.from({ length: 500 }, (_, i) => rollTrainer({ team: team(lv), seed: i }))
  .every((r) => r.party.every((m) => m.level >= 5 && m.level <= 100))), "never below Lv 5 or above Lv 100");

section("The party");
assertTrue(rolls.every((r) => r.party.length >= 3 && r.party.length <= 6), "3 to 6 Pokémon");
assertTrue([3, 4, 5, 6].every((n) => share(rolls, (r) => r.party.length === n) > 0.2), "each size is common");
assertEqual([1, 2].map((n) => rollTrainer({ team: team(30, n), seed: 1 }).party.length >= 3), [true, true], "whatever the player's Team size");
assertTrue(rolls.every((r) => r.party.every((m, i) => i === 0 || m.level >= r.party[i - 1].level)), "weakest to strongest");
assertTrue(rolls.every((r) => regular(r).every((m, i, ms) => {
  const earlier = ms.slice(0, i).map((x) => x.speciesId);
  return !earlier.includes(m.speciesId) || candidates(r.classKey, m.level).every((id) => earlier.includes(id));
})), "no species twice unless the class has nothing else at that Level");

section("Classes and Ace Trainers");
assertTrue(rolls.filter((r) => ACE_KEYS.includes(r.classKey)).every((r) => r.tier === "over"), "Ace Trainers only in Over");
assertTrue(Math.abs(share(tier("over"), (r) => ACE_KEYS.includes(r.classKey)) - 0.5) < 0.06, "half of Over");
assertTrue(Object.keys(TRAINER_CLASSES).every((k) => rolls.some((r) => r.classKey === k)), "every class turns up");
assertTrue(rolls.every((r) => r.title === TRAINER_CLASSES[r.classKey].title && r.spriteFile === classSprite(r.classKey)), "title and sprite from the class");
assertTrue(rolls.every((r) => NAMES[TRAINER_CLASSES[r.classKey].gender].includes(r.name)), "a name for the class's gender");

section("The surprise");
const surprised = rolls.filter((r) => r.surprise);
assertTrue(surprised.every((r) => r.tier === "under"), "only on Under-tier Trainers");
assertTrue(Math.abs(surprised.length / tier("under").length - 0.03) < 0.008, "3% of them");
assertTrue(surprised.every((r) => r.party.at(-1).level >= 40 && r.party.at(-1).level <= 55), "avg +10 to +25, sent out last");
assertTrue(surprised.every((r) => surprisePool(r.party.at(-1).level).includes(r.party.at(-1).speciesId)), "from the surprise pool");
assertTrue(surprisePool(70).some(legendaryLine) && surprisePool(70).some((id) => !onTheme("bugcatcher", id)), "legendaries allowed, any type");

section("Species");
assertEqual([150, 791, 790, 149, 6, 25].map(legendaryLine), [true, true, true, false, false, false],
  "a legendary line starts from a legendary or mythic (Mewtwo, Solgaleo, Cosmoem), unlike Dragonite or Charizard");
assertTrue(rolls.every((r) => regular(r).every((m) => !legendaryLine(m.speciesId))), "regular Pokémon are never legendary or mythic");
assertTrue(rolls.every((r) => r.party.every((m) => usable(m.speciesId))), "released, and in the battle data");
assertTrue(rolls.every((r) => r.party.every((m) => floorLevel(m.speciesId) <= m.level && !hasFittingEvolution(m.speciesId, m.level))),
  "the furthest form that fits its Level");
assertTrue(rolls.every((r) => regular(r).every((m) => onTheme(r.classKey, m.speciesId))), "on the class's type theme");
const thin = Object.keys(TRAINER_CLASSES).flatMap((k) => Array.from({ length: 96 }, (_, i) => i + 5)
  .filter((lv) => candidates(k, lv).length < 3).map((lv) => `${k}@${lv}`));
assertEqual(thin, [], "every class has 3+ species at every Level from 5 to 100");
assertTrue(Array.from({ length: 96 }, (_, i) => i + 5).every((lv) => surprisePool(lv).length >= 3), "and so does the surprise");

section("Prize money");
assertTrue(rolls.every((r) => r.prize === TRAINER_CLASSES[r.classKey].base * r.party.at(-1).level), "base × the last Pokémon's Level");
assertEqual(prizeMoney("youngster", [{ level: 20 }, { level: 26 }]), 260, "a Youngster whose last Pokémon is Lv 26 pays 260");
assertEqual(prizeMoney("gentleman", [{ level: 100 }]), 4000, "the most any Trainer pays");

section("Lines");
assertTrue(rolls.every((r) => {
  const lines = LINES[TRAINER_CLASSES[r.classKey].lines];
  const hinted = r.tier === "over" && !ACE_KEYS.includes(r.classKey);
  return (hinted ? OVER_INTRO : lines.intro).includes(r.lines.intro) && lines.lost.includes(r.lines.lost) && lines.won.includes(r.lines.won);
}), "Over-tier Trainers (but Ace Trainers) hint with a shared line; everyone else uses their class's");
assertTrue(surprised.every((r) => LINES[TRAINER_CLASSES[r.classKey].lines].intro.includes(r.lines.intro)), "the surprise gets no hint");

section("Seeds");
assertEqual(rollTrainer({ team: team(30), seed: 7 }), rollTrainer({ team: team(30), seed: 7 }), "same seed, same Trainer");
assertTrue(new Set(rolls.slice(0, 50).map((r) => JSON.stringify(r))).size > 45, "different seeds, different Trainers");

finish();
