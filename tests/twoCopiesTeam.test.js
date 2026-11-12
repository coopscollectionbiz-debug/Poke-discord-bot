// ==========================================================
// tests/twoCopiesTeam.test.js: Casual and Ranked hold each Pokémon once;
// only the Showcase takes repeats (owner decision 2026-11-12). Each slot
// still names one specific copy (docs/adr/0001): its Level, moves and
// held item are that copy's.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { addCopy, normalizeBox } from "../services/box.js";
import { prepareTeamSelection } from "../services/megaTeam.js";
import { prepareBattleTeamSelection } from "../services/battleTeam.js";
import { prepareShowcaseSelection } from "../services/showcaseTeam.js";
import { applyEquip, battleItems, describeLoadout, reconcileTeamEquipment } from "../services/heldItems.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { expForLevel } from "../utils/training.js";

const ON = { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_BATTLES_ENABLED: "1" };
const u = { id: "1", pokemon: {}, items: { leftovers: 1 } };
const a = addCopy(u, 6, "normal", { exp: expForLevel(60) }).uid;
const b = addCopy(u, 6, "normal", { exp: expForLevel(20) }).uid;

section("one per Pokémon on Casual and Ranked");
{
  const two = prepareTeamSelection(u, [{ id: 6, variant: "normal", uid: a }, { id: 6, variant: "normal", uid: b }]);
  assertTrue(two.ok && two.team.length === 1 && two.team[0].uid === a, "two Charizards collapse to the first slot's copy");
  assertEqual(prepareBattleTeamSelection(u, [{ id: 6, variant: "normal", uid: a }, { id: 6, variant: "normal", uid: b }]).team.length, 1, "Ranked team too");
  const sc = prepareShowcaseSelection(u, [{ id: 6, variant: "normal", uid: a }, { id: 6, variant: "normal", uid: b }]);
  assertTrue(sc.ok && sc.team.length === 2, "the Showcase takes both");
}

section("the slot's copy is the one that fights");
{
  u.displayedPokemon = [{ id: 6, variant: "normal", uid: b }];
  normalizeBox(u);
  assertEqual(buildTeam(u).map((m) => m.level), [20], "the Lv 20 copy fights when it's the one in the slot");
  u.displayedPokemon = [{ id: 6, variant: "normal", uid: a }, { id: 6, variant: "normal", uid: b }];
  assertEqual(buildTeam(u).map((m) => m.level), [60], "a stored repeat battles once (the first slot)");
}

section("held items belong to the copy in the slot");
{
  u.displayedPokemon = [{ id: 6, variant: "normal", uid: a }];
  assertTrue(applyEquip(u, { teamId: "display", line: `u:${a}`, itemId: "leftovers" }).ok, "Leftovers on the Charizard in the slot");
  assertEqual(battleItems(u, "display", { env: ON }).get(`u:${a}`), "leftovers", "it battles with it");
  assertEqual(describeLoadout(u, "display").map((m) => m.line), [`u:${a}`], "the loadout names the copy");
  u.equipment.teams.display = { "6:normal": "leftovers" };
  reconcileTeamEquipment(u, "display");
  assertEqual(u.equipment.teams.display, { [`u:${a}`]: "leftovers" }, "an older per-line item moves onto the slot's copy");
}

finish();
