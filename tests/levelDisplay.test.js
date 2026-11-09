// ==========================================================
// tests/levelDisplay.test.js
// What /inspectpokemon shows about Levels, stats, and moves.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import inspectpokemon, { battleInfo, infoLines } from "../commands/inspectpokemon.js";
import { findPokemonByName } from "../utils/dataLoader.js";
import { expForLevel } from "../utils/training.js";

section("/inspectpokemon battle info");
const owner = { pokemon: { 1: { normal: 2, shiny: 1 } }, training: { "1:normal": { exp: expForLevel(23) } } };
const text = battleInfo(owner, 1);
assertTrue(text.includes("**Your Lv 23**"), "shows your Level for the normal variant");
assertTrue(text.includes("**Your ✨ shiny Lv 2**"), "shows the shiny variant's own Level (floor when untrained)");
assertTrue(/HP \d+ · Atk \d+ · Def \d+ · SpA \d+ · SpD \d+ · Spe \d+/.test(text), "shows stats at that Level");
assertTrue(text.includes("Moves: ") && text.includes("Vine Whip"), "shows the default moves by name");
// At Lv 27 Bulbasaur learned Double-Edge, and this player had it forget Razor Leaf instead of Tackle.
const chooser = { pokemon: { 1: { normal: 1, shiny: 0 } }, training: { "1:normal": { exp: expForLevel(27), moves: ["tackle", "vinewhip", "takedown", "doubleedge"], movesLevel: 27 } } };
assertTrue(battleInfo(chooser, 1).includes("Moves: Tackle, Vine Whip, Take Down, Double-Edge"), "shows the player's chosen moves");
assertEqual(battleInfo({}, 1), "Base stats: HP 45 · Atk 49 · Def 49 · SpA 65 · SpD 65 · Spe 45", "not owned → base stats only");

section("/inspectpokemon header");
// Real data, since pokemonData's field names (tier, types, region) are what broke this.
const togekiss = await findPokemonByName("togekiss");
const header = infoLines(togekiss);
assertTrue(header.includes(`**Rarity:** ${togekiss.tier.toUpperCase()}`), "shows the rarity tier");
assertTrue(header.includes("Fairy") && header.includes("Flying"), "shows the types (modern typing: Togekiss is Fairy/Flying)");
assertTrue(header.includes(`**Region:** ${togekiss.region}`), "shows the region");
assertTrue(!/unknown/i.test(header), "nothing reads Unknown");

section("/inspectpokemon is for every player");
// Players need it to see their own Levels, stats, and moves; it's read-only and ephemeral.
// An explicit null (not an omitted field) is what clears the old admin-only
// setting when commands are re-registered.
const body = JSON.stringify(inspectpokemon.data.toJSON()); // what registration sends
assertTrue(body.includes('"default_member_permissions":null'), "sends an explicit null default permission");

finish();
