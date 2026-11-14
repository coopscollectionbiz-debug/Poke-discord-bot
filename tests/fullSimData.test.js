// ==========================================================
// tests/fullSimData.test.js
// The full-sim data file (data/battle/full-sim-data.json, built by
// tools/generate-full-sim-data.mjs) and the FULL_SIM_ENABLED switch that
// picks it: Gen 9 numbers, status moves and latest-game learnsets when on;
// battleData.json, unchanged, when off.
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { Dex } from "@pkmn/sim";
import { isFullSimEnabled } from "../config/fullSim.js";
import { getSpecies, getMove } from "../utils/battle/data.js";
import { autoMoveset } from "../utils/battle/moveset.js";

const ON = { FULL_SIM_ENABLED: "1" };
const OFF = {};
const full = JSON.parse(fs.readFileSync(new URL("../data/battle/full-sim-data.json", import.meta.url), "utf8"));

section("The switch");
assertEqual([isFullSimEnabled(ON), isFullSimEnabled({ FULL_SIM_ENABLED: "on" }), isFullSimEnabled(OFF), isFullSimEnabled({ FULL_SIM_ENABLED: "0" })], [true, true, false, false], "FULL_SIM_ENABLED reads like TM_ENABLED");

section("Legacy data is untouched");
{
  const hash = crypto.createHash("sha256").update(fs.readFileSync(new URL("../battleData.json", import.meta.url))).digest("hex");
  // master c40d6fb7's battleData.json: turning the switch off must change nothing.
  assertEqual(hash, "c30cb85fd1d02a14aea1d7ca77f07095955efce0e705f663f8b3938d760ce089", "battleData.json is byte-for-byte master's");
  assertEqual(getSpecies(25, OFF).baseStats.def, 30, "switch off: Pikachu has its Gen 5 Defense");
  assertEqual(getMove("thunderwave", OFF), undefined, "switch off: no status moves");
}

section("Full-sim data");
{
  assertEqual(Object.keys(full.species).length, 1025, "every species #1–1025");
  assertEqual(getSpecies(25, ON).baseStats.def, 40, "switch on: Pikachu has its Gen 9 Defense");
  assertEqual(getMove("thunderwave", ON)?.category, "Status", "switch on: status moves are in");
  assertEqual([full.species[1].learnsetGen, full.species[16].learnsetGen < 9], [9, true], "learnsets come from each species' latest game (Bulbasaur: Gen 9; Pidgey, absent from Gen 9: earlier)");
  assertTrue(full.species[1].levelMoves.some(([, id]) => getMove(id, ON).category === "Status"), "level-up learnsets include status moves");
  const missing = [...new Set(Object.values(full.species).flatMap((s) => s.levelMoves.map(([, id]) => id)))].filter((id) => !full.moves[id] || !Dex.moves.get(id).exists);
  assertEqual(missing, [], "every learnset move is in the file and in the engine");
  assertTrue(Object.values(full.species).every((s) => s.abilities.length >= 1 && s.abilities.length <= 2), "each species lists its regular abilities only (one or two)");
  assertEqual(full.species[292].abilities, ["Wonder Guard"], "Shedinja's only ability");
}

section("What the bot's main thread reads instead of the engine");
{
  // catalog/battlePlans.js and utils/battle/ai/abilities.js read these, so the
  // main thread never loads @pkmn/sim (tests/fullSimLazyLoad.test.js).
  const status = Object.entries(full.moves).filter(([, m]) => m.category === "Status");
  assertTrue(status.every(([, m]) => Array.isArray(m.roles)), `all ${status.length} status moves carry their plan roles`);
  assertEqual([full.moves.trickroom.roles, full.moves.stealthrock.roles, full.moves.swordsdance.roles], [["speed"], ["hazard"], ["setup"]], "Trick Room is speed control, Stealth Rock a hazard, Swords Dance setup");
  // Recommended moves (services/battlePlans.js recommendMoves) read these.
  assertEqual([full.moves.dragondance.boosts, full.moves.swordsdance.boosts, full.moves.calmmind.boosts], [{ atk: 1, spe: 1 }, { atk: 2 }, { spa: 1, spd: 1 }], "a move that raises its user's stats says which");
  assertEqual(["hyperbeam", "solarbeam", "fly", "explosion", "dreameater", "focuspunch", "lastresort", "metalburst", "fling"].map((id) => full.moves[id].drawback),
    ["recharge", "charge", "charge", "selfKO", "conditional", "conditional", "conditional", "conditional", "conditional"], "an attack that must recharge, charges first, faints its user, or fails without a condition (a hit taken, a held item) says so");
  assertEqual(["flamethrower", "bravebird", "closecombat", "outrage", "suckerpunch", "tackle"].map((id) => full.moves[id].drawback), Array(6).fill(undefined),
    "ordinary attacks have no drawback, recoil and stat drops included");
  const named = [...new Set(Object.values(full.species).flatMap((s) => s.abilities))];
  assertTrue(named.every((n) => Dex.abilities.get(n).rating === full.abilityRatings[Dex.abilities.get(n).id]), `all ${named.length} regular abilities carry Showdown's rating`);
}

section("Default moves under the full sim");
{
  const saved = process.env.FULL_SIM_ENABLED;
  process.env.FULL_SIM_ENABLED = "1";
  const moves = autoMoveset(1, 30);
  if (saved === undefined) delete process.env.FULL_SIM_ENABLED; else process.env.FULL_SIM_ENABLED = saved;
  assertTrue(moves.length > 0 && moves.every((id) => full.moves[id].category !== "Status"), "a Pokémon with no picked Moveset brings attacks only (its last ones learned)");
}

finish();
