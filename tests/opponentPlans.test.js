// ==========================================================
// tests/opponentPlans.test.js
// Computer-run opponents under the full sim (catalog/opponentPlans.js):
// every Challenge opponent and Trainer class has a signature plan and an
// AI skill, and their plan picks their moves (planMoves), since nobody is
// there to take suggestions.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { CHALLENGE_PLANS, CLASS_PLANS, opponentPlan, classPlan } from "../catalog/opponentPlans.js";
import { planMoves } from "../services/battlePlans.js";
import { moveRoles } from "../catalog/battlePlans.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { TRAINER_CLASSES } from "../utils/encounter/roster.js";
import { simulateChallenge } from "../utils/challenge/runChallenge.js";
import { simulateBattle, loadFullSim } from "../utils/battle/sim.js";
import { CHALLENGE, FULL_SIM } from "../utils/battle/tuning.js";

await loadFullSim(); // the full sim loads on first use (utils/battle/sim.js)

section("Signature plans");
{
  const keys = Object.values(CHALLENGES).flatMap((c) => c.opponents.map((o) => o.key));
  assertEqual(keys.filter((k) => !CHALLENGE_PLANS[k]), [], "every Challenge opponent has a plan");
  assertEqual(opponentPlan("koga").plan, "status", "Koga plays Status & stall");
  assertEqual(keys.filter((k) => opponentPlan(k).skill !== "expert"), [], "every Gym Leader, the Elite Four, Blue and Red are Experts");
  assertEqual(Object.keys(TRAINER_CLASSES).filter((k) => !CLASS_PLANS[k]), [], "every Trainer class has a plan");
  assertEqual([classPlan("youngster").skill, classPlan("hiker").plan, classPlan("hiker").skill], ["rookie", "hazards", "solid"], "Youngsters are Rookies, Hikers lay hazards at Solid skill");
  assertEqual(Object.keys(CLASS_PLANS).filter((k) => classPlan(k).skill === "expert"), ["dragontamer", "acetrainer", "acetrainerf"], "Ace Trainers and Dragon Tamers are Experts");
  assertEqual(opponentPlan("nobody"), { plan: "allout", skill: "solid" }, "an unknown opponent plays All-out attack");
}

section("Their plan picks their moves");
{
  const FULL = { FULL_SIM_ENABLED: "1" }; // computer plan moves exist only under the full sim
  const moves = planMoves(109, 40, "status", FULL); // Koffing
  assertTrue(moves.length >= 1 && moves.length <= 4, "up to four moves");
  assertTrue(moves.some((id) => moveRoles(id).includes("status")), "a status move it has learned, for Status & stall");
  assertTrue(moves.some((id) => moveRoles(id).includes("attack")), "and at least one attack");
  assertTrue(planMoves(109, 40, "allout", FULL).every((id) => moveRoles(id).includes("attack")), "All-out attack brings attacks only");
}

section("A Gym fight on the full sim");
{
  let seen = null;
  const team = [{ speciesId: 150, variant: "normal", name: "Mewtwo", level: 60 }];
  simulateChallenge({
    team, opponents: CHALLENGES.koga.opponents, seed: 1, engine: "full",
    simulate: (input) => { seen = input; return simulateBattle({ ...input, engine: "full" }); },
  });
  assertEqual([seen.sides[1].plan, seen.sides[1].skill], ["status", "expert"], "Koga's side plays his plan at his skill");
  assertEqual(seen.sides[1].members.map((m) => m.statMult), seen.sides[1].members.map(() => FULL_SIM.challengeStatBoost.koga), "with the full sim's own hidden stat boost for Koga");
  assertTrue(seen.sides[1].members.every((m) => Array.isArray(m.moves) && m.moves.length), "and his Pokémon bring their plan's moves");
  let legacy = null;
  simulateChallenge({ team, opponents: CHALLENGES.koga.opponents, seed: 1, engine: "legacy", simulate: (input) => { legacy = input; return simulateBattle({ ...input, engine: "legacy" }); } });
  assertTrue(legacy.sides[1].members.every((m) => m.moves === undefined), "on today's engine, his Pokémon keep their automatic moves");
  assertTrue(legacy.sides[1].members.every((m) => m.statMult === CHALLENGE.statBoost), "and today's stat boost");
  const opponents = Object.values(CHALLENGES).flatMap((c) => c.opponents.map((o) => o.key));
  assertEqual(opponents.filter((k) => !(FULL_SIM.challengeStatBoost[k] > 0)), [], "every Challenge opponent has a full-sim stat boost");
}

finish();
