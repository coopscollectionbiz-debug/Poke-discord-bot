// ==========================================================
// tests/teamsMovePicks.test.js
// The Moves editor's picks (public/teams/movePicks.js), DOM-free: it starts
// from what the Pokémon fights with, automatic moves included even when its
// learnset no longer teaches them, "Use automatic moves" fills the editor
// like the other buttons and saves null, and recommended rows carry a badge.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { startPicks, shownMoves, tickedMoves, lostMoves, toggleMove, pickFrom, AUTOMATIC, savedMoves, canSave, moveRow } from "../public/teams/movePicks.js";

const mv = (id, name) => ({ id, name });
// An Entei recorded at the full-sim switch: two of its automatic moves
// (Fire Spin, Stomp) aren't in its new learnset.
const entei = {
  moves: [mv("firespin", "Fire Spin"), mv("stomp", "Stomp"), mv("flamethrower", "Flamethrower"), mv("firefang", "Fire Fang")],
  movesets: { display: null, battle: [mv("sacredfire", "Sacred Fire"), mv("crunch", "Crunch")] },
  learnable: ["flamethrower", "firefang", "sacredfire", "crunch", "extremespeed", "calmmind"].map((id) => mv(id, id)),
};
const ids = (moves) => moves.map((m) => m.id);

section("Where the editor starts");
{
  const auto = startPicks(entei, "display");
  assertEqual(auto.auto, true, "no Moveset on this Team: automatic moves");
  assertEqual(ids(shownMoves(auto, entei)), ["firespin", "stomp", "flamethrower", "firefang"], "all four automatic moves show, the two it can't pick again included");
  assertEqual(tickedMoves(auto, entei), ["flamethrower", "firefang"], "the ones it can still pick are ticked");
  assertEqual(ids(lostMoves(auto, entei, "display")), ["firespin", "stomp"], "and the others are named as moves it can't pick again");
  const picked = startPicks(entei, "battle");
  assertEqual([picked.auto, picked.picked], [false, ["sacredfire", "crunch"]], "a Moveset on this Team: its picks");
  assertEqual(ids(shownMoves(picked, entei)), ["sacredfire", "crunch"], "shown as they are");
}

section("Ticking a box");
{
  const auto = startPicks(entei, "display");
  assertEqual(toggleMove(auto, entei, "crunch", true), { auto: false, picked: ["flamethrower", "firefang", "crunch"] }, "from automatic moves, a tick starts a pick from the ones it can pick");
  assertEqual(toggleMove(auto, entei, "firefang", false), { auto: false, picked: ["flamethrower"] }, "and so does an untick");
  assertEqual(ids(lostMoves(toggleMove(auto, entei, "crunch", true), entei, "display")), ["firespin", "stomp"], "the moves it'd lose stay named until it's saved");
  const full = pickFrom(entei, ["flamethrower", "firefang", "sacredfire", "crunch"]);
  assertEqual(toggleMove(full, entei, "extremespeed", true).picked, ["flamethrower", "firefang", "sacredfire", "crunch"], "never more than four");
  assertEqual(pickFrom(entei, ["firespin", "crunch"]).picked, ["crunch"], "a fill keeps only moves it can pick");
}

section("Use automatic moves, then Save");
{
  const picked = startPicks(entei, "battle");
  assertEqual(ids(shownMoves(AUTOMATIC, entei)), ["firespin", "stomp", "flamethrower", "firefang"], "Use automatic moves shows the moves it would fight with");
  assertEqual(savedMoves(AUTOMATIC), null, "Save then clears the pick");
  assertEqual(savedMoves(picked), ["sacredfire", "crunch"], "Save on a pick sends it");
  assertEqual([canSave(AUTOMATIC), canSave(picked), canSave({ auto: false, picked: [] })], [true, true, false], "Save needs automatic moves or at least one pick");
}

section("A move row");
{
  const m = mv("dragondance", "Dragon Dance");
  const rec = moveRow(m, { on: false, full: false, recommended: true, meta: "" });
  assertTrue(rec.includes("is-rec") && rec.includes(">Recommended<"), "a recommended move carries the Recommended badge");
  assertTrue(!moveRow(m, { on: false, full: false, recommended: false, meta: "" }).includes("Recommended"), "others don't");
  const off = moveRow(m, { on: false, full: true, recommended: false, meta: "" });
  assertTrue(off.includes("is-full") && off.includes(" disabled"), "with four picked, an unticked move can't be ticked");
  assertTrue(moveRow(m, { on: true, full: true, recommended: false, meta: "" }).includes(" checked"), "a ticked one stays ticked");
}

finish();
