// ==========================================================
// tests/battleData.test.js
// Checks the generated battleData.json against the game's own
// pokemonData.json: Gen 5 stats/moves for #1–649, modern data for
// #650–1025, modern 18-type chart.
// ==========================================================

import fs from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const data = read("battleData.json");
const pokemonData = read("pokemonData.json");

// pokemonData.json stores PokeAPI type ids.
const TYPE_ID_TO_NAME = {
  1: "Normal", 2: "Fighting", 3: "Flying", 4: "Poison", 5: "Ground", 6: "Rock",
  7: "Bug", 8: "Ghost", 9: "Steel", 10: "Fire", 11: "Water", 12: "Grass",
  13: "Electric", 14: "Psychic", 15: "Ice", 16: "Dragon", 17: "Dark", 18: "Fairy",
};
const EXCLUDED_MOVES = ["dreameater", "snore", "focuspunch", "fakeout", "lastresort",
  "synchronoise", "futuresight", "doomdesire", "skydrop", "struggle"];

section("Species");
assertEqual(Object.keys(data.species).length, 1025, "1025 species");
const ids = Object.keys(pokemonData);
assertTrue(ids.every((id) => data.species[id]), "every pokemonData id has battle data");
const typeMismatches = ids.filter((id) =>
  JSON.stringify(data.species[id]?.types) !==
  JSON.stringify(pokemonData[id].types.map((t) => TYPE_ID_TO_NAME[t])));
assertEqual(typeMismatches, [], "types match pokemonData");
assertEqual(data.species["25"].baseStats, { hp: 35, atk: 55, def: 30, spa: 50, spd: 40, spe: 90 }, "Pikachu has Gen 5 base stats");
assertEqual(data.species["35"].types, ["Fairy"], "Clefairy is Fairy (modern typing)");
assertEqual(data.species["35"].baseStats, { hp: 70, atk: 45, def: 48, spa: 60, spd: 65, spe: 35 }, "Clefairy keeps its Gen 5 base stats");

section("Moves");
assertEqual(data.moves.flamethrower?.power, 95, "Flamethrower is 95 power in Gen 5");
assertEqual(data.moves.thunderbolt?.power, 95, "Thunderbolt is 95 power in Gen 5");
for (const id of [...EXCLUDED_MOVES, "fissure", "explosion", "hyperbeam", "solarbeam", "nightshade", "flail"]) {
  assertTrue(!data.moves[id], `${id} is not battle-usable`);
}
const allLevelMoves = Object.values(data.species).flatMap((s) => s.levelMoves.map(([, m]) => m));
assertTrue(allLevelMoves.every((m) => data.moves[m]), "every levelMoves entry is in the move table");
assertTrue(Object.values(data.moves).every((m) => m.category !== "Status" && m.power > 1), "no status or 0/1-power moves");
assertEqual(data.species["63"].levelMoves, [], "Abra has no battle-usable level-up moves");
assertTrue(data.species["129"].levelMoves.some(([l, m]) => l === 15 && m === "tackle"), "Magikarp learns Tackle at 15");
const bulbaLevels = data.species["1"].levelMoves.map(([l]) => l);
assertEqual(bulbaLevels, [...bulbaLevels].sort((a, b) => a - b), "levelMoves are ascending");

section("Move effects");
assertEqual(data.moves.gigadrain?.drain, [1, 2], "Giga Drain heals half the damage");
assertEqual(data.moves.bravebird?.recoil, [33, 100], "Brave Bird has 33% recoil");
assertEqual(data.moves.headsmash?.recoil, [1, 2], "Head Smash has 50% recoil");
assertEqual(data.moves.highjumpkick?.crash, true, "High Jump Kick crashes on a miss");
assertEqual(data.moves.bulletseed?.multihit, [2, 5], "Bullet Seed hits 2 to 5 times");
assertEqual(data.moves.doublekick?.multihit, 2, "Double Kick hits twice");
assertEqual([data.moves.triplekick?.multihit, data.moves.triplekick?.multiaccuracy, data.moves.triplekick?.risingPower], [3, true, true],
  "Triple Kick kicks 3 times, checks accuracy each kick, and gets stronger");
assertEqual(data.moves.quickattack?.priority, 1, "Quick Attack has +1 priority");
assertEqual(data.moves.extremespeed?.priority, 2, "Extreme Speed has +2 priority");
assertEqual(data.moves.vitalthrow?.priority, -1, "Vital Throw has -1 priority");
assertEqual(Object.keys(data.moves.flamethrower), ["name", "type", "category", "power", "accuracy", "critRatio"],
  "a move without effects stores no effect fields");

section("Type chart");
assertEqual(data.typeChart.Ghost?.Steel, undefined, "Ghost vs Steel is neutral (Gen 6+ chart)");
assertEqual(data.typeChart.Normal?.Ghost, 0, "Normal can't hit Ghost");
assertEqual(data.typeChart.Fairy, { Fighting: 2, Poison: 0.5, Steel: 0.5, Fire: 0.5, Dragon: 2, Dark: 2 }, "Fairy attacking chart");
const types = Object.values(TYPE_ID_TO_NAME);
assertTrue(types.every((t) => data.moves[data.fallbackByType[t]]?.type === t), "every type has a fallback move of that type");

finish();
