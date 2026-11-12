// ==========================================================
// tests/copyMovesets.test.js: every copy has its own moves (docs/adr/0001).
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { addCopy } from "../services/box.js";
import { learnableMoves, chosenMoves, validateMoveset, setMoveset } from "../services/movesets.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { expForLevel } from "../utils/training.js";
import { getSpecies } from "../utils/battle/data.js";

// Charmander: a low copy and a high copy.
const u = { pokemon: {} };
const low = addCopy(u, 4, "normal", { exp: expForLevel(5) }).uid;
const high = addCopy(u, 4, "normal", { exp: expForLevel(40) }).uid;
const levelMoves = getSpecies(4).levelMoves;
const lateMove = levelMoves.find(([at]) => at > 5 && at <= 40)?.[1];

section("learnable moves follow the copy's own Level");
{
  const lo = learnableMoves(u, 4, "normal", { uid: low }).map((m) => m.id);
  const hi = learnableMoves(u, 4, "normal", { uid: high }).map((m) => m.id);
  assertTrue(!!lateMove && hi.includes(lateMove) && !lo.includes(lateMove), "a move learned after Lv 5 is open to the Lv 40 copy only");
  assertEqual(validateMoveset(u, 4, "normal", [lateMove], { uid: low }).code, "not_learned", "the Lv 5 copy can't equip it");
  assertTrue(validateMoveset(u, 4, "normal", [lateMove], { uid: high }).ok, "the Lv 40 copy can");
}

section("each copy keeps its own moveset");
{
  const loMoves = learnableMoves(u, 4, "normal", { uid: low }).slice(0, 1).map((m) => m.id);
  setMoveset(u, "display", 4, "normal", loMoves, { uid: low });
  setMoveset(u, "display", 4, "normal", [lateMove], { uid: high });
  assertEqual(chosenMoves(u, "display", 4, "normal", { uid: low }), loMoves, "the low copy's choice");
  assertEqual(chosenMoves(u, "display", 4, "normal", { uid: high }), [lateMove], "the high copy's own choice");
  assertTrue(!!u.movesets.display[`u:${high}`] && !u.movesets.display["4:normal"], "stored per copy, not per line");
}

section("battles use the slot's copy");
{
  u.displayedPokemon = [{ id: 4, variant: "normal", uid: high }];
  const [m] = buildTeam(u);
  assertEqual([m.level, m.moves], [40, [lateMove]], "Level and moves of the copy in the slot");
  u.displayedPokemon = [{ id: 4, variant: "normal", uid: low }];
  assertEqual(buildTeam(u)[0].level, 5, "the other copy fights at its own Level");
}

finish();
