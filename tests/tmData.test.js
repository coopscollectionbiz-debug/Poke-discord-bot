// ==========================================================
// tests/tmData.test.js — TM compatibility data (phase T2).
// Pins the owner-approved catalog (broad "R-B": 156 launch moves) and
// spot-checks compatibility against known game data.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { tmMove, tmMoveIds, canLearnByTm, tmMovesForSpecies, tmItemId, moveIdForTmItem, tmDataCounts } from "../utils/battle/tmData.js";
import { getMove, getSpecies } from "../utils/battle/data.js";

const raw = JSON.parse(fs.readFileSync(new URL("../data/battle/tm-data.json", import.meta.url), "utf8"));

section("catalog shape");
assertEqual(tmMoveIds({ status: "launch" }).length, 156, "156 launch moves (owner decision D-T4, R-B)");
assertEqual(tmMoveIds({ status: "hold" }).length, 16, "16 held moves (engine fixes pending, D-T13)");
assertEqual(tmDataCounts(), { launch: 156, hold: 16, species: 1025 }, "counts header matches");
assertTrue(tmMoveIds().every((id) => getMove(id)), "every catalog move exists in battleData.json");
assertTrue(tmMoveIds().every((id) => getMove(id).category !== "Status"), "no status moves");
for (const banned of ["solarbeam", "hyperbeam", "gigaimpact", "hiddenpower", "return", "frustration", "fling", "dreameater", "explosion", "swordsdance", "toxic", "protect", "weatherball", "hex", "storedpower", "secretpower", "payday", "firepledge"]) {
  assertEqual(tmMove(banned), null, `${banned} is not in the catalog`);
}
assertTrue(tmMoveIds().every((id) => raw.moves[id].species.every((n) => Number.isInteger(n) && n >= 1 && n <= 1025 && getSpecies(n))), "every learner is a real species #1–1025");
assertTrue(tmMoveIds().every((id) => { const s = raw.moves[id].species; return s.every((n, i) => i === 0 || n > s[i - 1]); }), "learner lists are sorted and unique");

section("Gen 5 numbers and rules");
assertEqual([tmMove("thunderbolt").tm, tmMove("surf").tm, tmMove("snarl").tm], ["TM24", "HM03", "TM95"], "TM24 Thunderbolt, HM03 Surf, TM95 Snarl");
assertEqual([tmMove("thunderbolt").rule, tmMove("playrough").rule, tmMove("thunderpunch").rule], ["gen5", "modern", "modern"], "Gen 5 TMs use the Gen 5 rule; others the modern rule");
assertEqual(tmMove("thunderpunch").tm, null, "Thunder Punch has no Gen 5 TM number");
assertEqual(tmMove("overheat").status, "hold", "Overheat is held");
assertTrue(/Sp\. Atk/.test(tmMove("overheat").holdReason), "a held move carries its reason");

section("compatibility spot checks");
assertTrue(canLearnByTm(6, "thunderpunch"), "Charizard learns Thunder Punch (owner's example)");
assertTrue(canLearnByTm(6, "flamethrower") && canLearnByTm(6, "dragonclaw"), "Charizard learns Flamethrower and Dragon Claw");
assertTrue(!canLearnByTm(6, "surf"), "Charizard cannot learn Surf");
assertTrue(canLearnByTm(25, "thunderbolt") && !canLearnByTm(25, "surf"), "Pikachu: Thunderbolt yes, Surf no (Gen 5 TM rule)");
assertTrue(canLearnByTm(700, "dazzlinggleam") && canLearnByTm(36, "dazzlinggleam"), "Sylveon and Clefable learn Dazzling Gleam (Fairy gap closed)");
assertEqual(tmMovesForSpecies(129), ["hydropump"], "Magikarp: only Hydro Pump (Sword/Shield TR)");
assertEqual(tmMovesForSpecies(132), [], "Ditto learns nothing");
assertEqual(tmMovesForSpecies(201), [], "Unown learns nothing");
assertTrue(canLearnByTm("6", "flamethrower"), "string species ids work");
assertTrue(!canLearnByTm(6, "__proto__") && !canLearnByTm(6, "constructor"), "prototype keys are never moves");
const noneLaunch = [];
for (let n = 1; n <= 1025; n++) if (!tmMovesForSpecies(n, { status: "launch" }).length) noneLaunch.push(n);
assertEqual(noneLaunch.length, 16, "16 species can learn no launch TM (matches the audit)");
const fairy = [];
for (let n = 1; n <= 1025; n++) if (getSpecies(n).types.includes("Fairy")) fairy.push(n);
assertTrue(fairy.every((n) => tmMovesForSpecies(n, { status: "launch" }).some((id) => getMove(id).type === "Fairy")), `all ${fairy.length} Fairy-type species have a Fairy TM`);

section("item ids");
assertEqual(tmItemId("thunderbolt"), "tm_thunderbolt", "item id format");
assertEqual([moveIdForTmItem("tm_thunderbolt"), moveIdForTmItem("tm_solarbeam"), moveIdForTmItem("evolution_stone"), moveIdForTmItem("tm___proto__")], ["thunderbolt", null, null, null], "item → move only for catalog moves");

finish();
