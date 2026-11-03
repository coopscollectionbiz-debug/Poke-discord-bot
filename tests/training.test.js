// ==========================================================
// tests/training.test.js
// Levels, EXP, Catch level rolls, duplicates, and evolve carry-over.
// ==========================================================

import { assertEqual, assertTrue, assertBetween, section, finish } from "./harness.js";
import {
  trainingKey, expForLevel, levelForExp, catchBand, floorLevel, rollCatchLevel,
  getTraining, addExp, grantCatch, carryLevel, levelsForUser,
} from "../utils/training.js";
import { validateUserSchema } from "../utils/userSchema.js";

const atLevel = (user, id, variant, level) => {
  user.training ??= {};
  user.training[trainingKey(id, variant)] = { exp: expForLevel(level) };
};

section("EXP curve (Medium Fast)");
assertEqual([expForLevel(1), expForLevel(10), expForLevel(100)], [0, 1000, 1000000], "expForLevel");
assertEqual([levelForExp(999), levelForExp(1000), levelForExp(5e6), levelForExp(0)], [9, 10, 100, 1], "levelForExp");
assertTrue(Array.from({ length: 100 }, (_, i) => i + 1).every((l) => levelForExp(expForLevel(l)) === l), "levelForExp inverts expForLevel at every Level");

section("Catch bands");
assertEqual([catchBand(1), catchBand(2), catchBand(3)], [1, 2, 3], "Bulbasaur line is Stage 1/2/3");
assertEqual([catchBand(150), catchBand(489)], ["legendary", "legendary"], "Mewtwo and Phione use the legendary range");
assertEqual([floorLevel(4), floorLevel(6), floorLevel(150)], [2, 32, 40], "floor is the bottom of the range");

section("Catch level rolls (Stage 1)");
const rolls = Array.from({ length: 20000 }, () => rollCatchLevel(4));
assertTrue(rolls.every((l) => l >= 2 && l <= 35), "all rolls within 2–35");
assertTrue(rolls.reduce((a, b) => a + b, 0) / rolls.length < 8.5, "rolls lean low (mean < 8.5)");
assertBetween(rolls.filter((l) => l > 15).length / rolls.length, 0.01, 0.06, "tail share above 15");

section("grantCatch");
const user = {};
const first = grantCatch(user, 4, "normal");
assertEqual([user.pokemon[4].normal, first.isNew], [1, true], "first catch counts and is new");
assertEqual(user.training["4:normal"].exp, expForLevel(first.level), "first catch sets EXP to its Catch level");
atLevel(user, 4, "normal", 10);
const dup = grantCatch(user, 4, "normal");
assertEqual([user.pokemon[4].normal, dup.isNew, dup.expGained, user.training["4:normal"].exp], [2, false, 165, 1165], "duplicate adds half the next Level's EXP");
atLevel(user, 4, "normal", 100);
assertEqual(grantCatch(user, 4, "normal").expGained, 0, "duplicate at Lv 100 gives nothing");
const kept = { pokemon: { 6: { normal: 0, shiny: 0 } } };
atLevel(kept, 6, "normal", 40);
grantCatch(kept, 6, "normal");
assertTrue(getTraining(kept, 6, "normal").level >= 40, "a surviving record isn't overwritten by a re-catch");
assertEqual(getTraining({}, 6, "shiny"), { exp: expForLevel(32), level: 32 }, "no record → bottom of the catch range");
// Deliberate: owners from before Levels get the same roll a new player gets.
const veteran = { pokemon: { 65: { normal: 5, shiny: 0 } } };
const sat = getTraining(veteran, 65, "normal").level;
const reroll = grantCatch(veteran, 65, "normal", () => 0.999);
assertTrue(reroll.isNew && reroll.level >= sat, "owned before Levels → the next catch rolls a Catch level, never below where it sat");

section("addExp");
const capped = {};
atLevel(capped, 25, "normal", 99);
assertEqual(addExp(capped, 25, "normal", 10_000_000), { fromLevel: 99, toLevel: 100 }, "addExp reports the level change");
assertEqual(capped.training["25:normal"].exp, 1000000, "addExp clamps at level 100");

section("carryLevel (evolve / shiny craft)");
const evo = {};
atLevel(evo, 1, "normal", 30);
carryLevel(evo, { id: 1, variant: "normal" }, { id: 2, variant: "normal" });
assertEqual(getTraining(evo, 2, "normal").level, 30, "Bulbasaur Lv 30 → Ivysaur Lv 30");
atLevel(evo, 4, "normal", 2);
carryLevel(evo, { id: 4, variant: "normal" }, { id: 6, variant: "normal" });
assertEqual(getTraining(evo, 6, "normal").level, floorLevel(6), "Charmander Lv 2 → never-owned Charizard gets the Stage 3 floor");

section("levelsForUser");
const owner = { pokemon: { 1: { normal: 1, shiny: 0 }, 6: { normal: 0, shiny: 1 } } };
atLevel(owner, 1, "normal", 12);
assertEqual(levelsForUser(owner), { "1:normal": 12, "6:shiny": 32 }, "Levels for owned variants only");

section("Persistence");
const saved = { id: "1", name: "Ash", training: { "6:normal": { exp: 27000 } }, battle: { rating: 1016 }, pendingWager: { stake: 5 } };
const reloaded = validateUserSchema(JSON.parse(JSON.stringify(saved)), "1", "Ash");
assertEqual([reloaded.training, reloaded.battle, reloaded.pendingWager], [saved.training, saved.battle, saved.pendingWager], "save/load keeps training, battle, pendingWager");

finish();
