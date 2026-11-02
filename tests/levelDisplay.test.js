// ==========================================================
// tests/levelDisplay.test.js
// What /inspectpokemon shows about Levels, stats, and moves.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { battleInfo } from "../commands/inspectpokemon.js";
import { expForLevel } from "../utils/training.js";

section("/inspectpokemon battle info");
const owner = { pokemon: { 1: { normal: 2, shiny: 1 } }, training: { "1:normal": { exp: expForLevel(23) } } };
const text = battleInfo(owner, 1);
assertTrue(text.includes("**Your Lv 23**"), "shows your Level for the normal variant");
assertTrue(text.includes("**Your ✨ shiny Lv 2**"), "shows the shiny variant's own Level (floor when untrained)");
assertTrue(/HP \d+ · Atk \d+ · Def \d+ · SpA \d+ · SpD \d+ · Spe \d+/.test(text), "shows stats at that Level");
assertTrue(text.includes("Moves: ") && text.includes("Vine Whip"), "shows the auto-picked moves by name");
assertEqual(battleInfo({}, 1), "Base stats: HP 45 · Atk 49 · Def 49 · SpA 65 · SpD 65 · Spe 45", "not owned → base stats only");

finish();
