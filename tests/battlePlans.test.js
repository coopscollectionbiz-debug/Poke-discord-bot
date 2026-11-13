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
  assertEqual([speed.ready, speed.helpers, speed.missing], [false, 0, ["trickroom", "tailwind"]], "Speed control without Trick Room or Tailwind isn't ready, and says what's missing");
  assertEqual(planReadiness(team([437, ["trickroom", "gyroball"]], [143, ["bodyslam"]]), "speed").ready, true, "a Bronzong with Trick Room makes it ready");
  const status = planReadiness(team([25, ["thunderwave", "thunderbolt"]], [94, ["willowisp", "hex"]], [143, ["bodyslam"]]), "status");
  assertEqual([status.ready, status.helpers], [true, 2], "two Pokémon bring a status move");
  assertEqual(planReadiness(team([186, ["surf"]], [230, ["surf"]]), "weather").ready, false, "Weather needs a Pokémon that sets one (Politoed's Drizzle is hidden, so it doesn't count)");
  assertEqual(planReadiness(team([186, ["raindance", "surf"]], [230, ["surf"]]), "weather").ready, true, "Rain Dance makes Weather ready");
}

section("Abilities");
assertEqual(pickAbility(230, "weather"), "Swift Swim", "Kingdra on Weather fights with Swift Swim");
assertTrue(pickAbility(186, "weather") !== "Drizzle", "hidden abilities are never picked (Politoed's Drizzle)");
assertEqual(pickAbility(292, "allout"), "Wonder Guard", "Shedinja has only Wonder Guard");
assertTrue(["Overgrow"].includes(pickAbility(1, "allout")), "a species with one regular ability fights with it");

finish();
