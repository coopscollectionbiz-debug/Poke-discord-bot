// ==========================================================
// tests/battlePlans.test.js
// The six Battle plans (catalog/battlePlans.js): what each move does for a
// plan (moveRoles), whether a Team brings what its plan needs
// (planReadiness), and the ability a plan picks (utils/battle/ai/abilities.js).
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { BATTLE_PLANS, DEFAULT_PLAN, planById, moveRoles, planReadiness } from "../catalog/battlePlans.js";
import { pickAbility } from "../utils/battle/ai/abilities.js";

const team = (...members) => members.map(([speciesId, moves]) => ({ speciesId, moves }));

section("Catalog");
assertEqual(BATTLE_PLANS.map((p) => p.id), ["allout", "setup", "status", "hazards", "weather", "speed"], "six plans, in menu order");
assertEqual([DEFAULT_PLAN, planById("speed").name, planById("nope")], ["allout", "Speed control", null], "All-out attack is the default; unknown ids have no plan");

section("Move roles");
assertEqual(moveRoles("swordsdance"), ["setup"], "Swords Dance sets up");
assertEqual(moveRoles("thunderwave"), ["status"], "Thunder Wave inflicts status");
assertEqual(moveRoles("stealthrock"), ["hazard"], "Stealth Rock is a hazard");
assertEqual(moveRoles("reflect"), ["screen"], "Reflect is a screen");
assertEqual(moveRoles("raindance"), ["weather"], "Rain Dance sets weather");
assertEqual([moveRoles("trickroom"), moveRoles("tailwind")], [["speed"], ["speed"]], "Trick Room and Tailwind control speed");
assertEqual(moveRoles("recover"), ["recovery"], "Recover heals");
assertEqual(moveRoles("thunderbolt"), ["attack"], "Thunderbolt is an attack");

section("Readiness");
{
  const plain = team([25, ["thunderbolt", "quickattack"]], [143, ["bodyslam"]]);
  assertEqual(planReadiness(plain, "allout").ready, true, "All-out attack is always ready");
  const speed = planReadiness(plain, "speed");
  assertEqual([speed.ready, speed.helpers, speed.missing], [false, [], ["trickroom", "tailwind"]], "Speed control without Trick Room or Tailwind isn't ready, and says what's missing");
  assertEqual(planReadiness(team([437, ["trickroom", "gyroball"]], [143, ["bodyslam"]]), "speed").ready, true, "a Bronzong with Trick Room makes it ready");
  const status = planReadiness(team([25, ["thunderwave", "thunderbolt"]], [94, ["willowisp", "hex"]], [143, ["bodyslam"]]), "status");
  assertEqual([status.ready, status.helpers.map((h) => [h.speciesId, h.moves])], [true, [[25, ["thunderwave"]], [94, ["willowisp"]]]], "it names who brings which status move");
  assertEqual(planReadiness(team([186, ["surf"]], [230, ["surf"]]), "weather").ready, false, "Weather needs a Pokémon that sets one (Politoed's Drizzle is hidden, so it doesn't count)");
  assertEqual(planReadiness(team([186, ["raindance", "surf"]], [230, ["surf"]]), "weather").ready, true, "Rain Dance makes Weather ready");
}

section("Readiness counts a move only when the AI would play it for the plan");
{
  const ready = (members, plan) => planReadiness(team(...members), plan);
  // Set up & sweep: the same raises the AI plays (utils/battle/ai/choose.js). Before a
  // fight there's no foe yet, so a Speed raise counts for a Pokémon slower than most.
  assertEqual(ready([[386, ["agility", "psychic"]]], "setup").ready, false, "a fast Deoxys's Agility doesn't count: most foes are slower");
  assertEqual(ready([[76, ["agility", "rockslide"]]], "setup").helpers.map((h) => h.moves), [["agility"]], "a slow Golem's does");
  assertEqual(ready([[244, ["calmmind", "sacredfire"]]], "setup").ready, false, "Calm Mind on an Entei with only physical attacks doesn't");
  assertEqual(ready([[65, ["calmmind", "psychic"]]], "setup").ready, true, "on an Alakazam with a special attack, it does");
  assertEqual(ready([[149, ["dragondance", "dragonclaw"]]], "setup").ready, true, "and Dragon Dance's Attack counts on a Dragonite, whatever its Speed");
  // Weather: only the Team's weather, the one the AI plays to.
  const sun = ready([[186, ["sunnyday", "surf"]], [230, ["surf"]]], "weather");
  assertEqual([sun.ready, sun.missing], [false, ["raindance"]], "Sunny Day doesn't help a Water Team: it needs Rain Dance");
  assertEqual(ready([[279, ["surf"]], [230, ["surf"]]], "weather").helpers, [{ speciesId: 279, name: undefined, moves: [], ability: "Drizzle" }], "Pelipper's Drizzle sets its rain");
  const none = ready([[143, ["raindance", "bodyslam"]], [128, ["bodyslam"]]], "weather");
  assertEqual([none.ready, none.noWeather], [false, true], "a Team no weather helps can't play Weather, Rain Dance or not");
}

section("Abilities");
assertEqual(pickAbility(230, "weather"), "Swift Swim", "Kingdra on Weather fights with Swift Swim");
assertTrue(pickAbility(186, "weather") !== "Drizzle", "hidden abilities are never picked (Politoed's Drizzle)");
assertEqual(pickAbility(292, "allout"), "Wonder Guard", "Shedinja has only Wonder Guard");
assertTrue(["Overgrow"].includes(pickAbility(1, "allout")), "a species with one regular ability fights with it");

finish();
