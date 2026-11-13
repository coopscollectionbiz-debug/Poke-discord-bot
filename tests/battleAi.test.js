// ==========================================================
// tests/battleAi.test.js
// The Battle-plan AI (utils/battle/ai): the damage estimate, one scenario
// per plan, and the three skill levels (Rookie, Solid, Expert).
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createBattle } from "../utils/battle/showdown/engine.js";
import { memberSet, applyCarryOver } from "../utils/battle/showdown/sets.js";
import { simulateFull } from "../utils/battle/showdown/simulate.js";
import { makeChooser } from "../utils/battle/ai/choose.js";
import { estimateDamage } from "../utils/battle/ai/estimate.js";
import { pickAbility } from "../utils/battle/ai/abilities.js";
import { createRng } from "../utils/battle/rng.js";

const mon = (speciesId, level, moves, extra = {}) => ({ speciesId, variant: "normal", level, moves, ...extra });
const battleOf = (a, b, { plan = "allout", seed = 1 } = {}) => {
  const sides = [a, b];
  return createBattle({
    sets: sides.map((ms) => ms.map((m, slot) => memberSet(m, { slot, ability: pickAbility(m.speciesId, plan) }))),
    seed,
    beforeStart: (battle) => sides.forEach((ms, i) => applyCarryOver(battle, i, ms)),
  });
};
const chosen = (b, chooser, side = 0) => {
  const req = b.sides[side].activeRequest;
  const k = Number(chooser(req, b, side).split(" ")[1]) - 1;
  return req.active[0].moves[k].id;
};
// Plays one turn: side 0 uses `chooser`, side 1 its first move.
const playTurn = (b, chooser) => {
  const choice = chooser(b.sides[0].activeRequest, b, 0);
  b.sides[0].choose(choice);
  b.sides[1].choose("move 1");
  b.commitChoices();
};
const solid = (plan) => makeChooser({ plan, skill: "solid", seed: 99, slip: 0 });

section("Damage estimate");
{
  const b = battleOf([mon(25, 50, ["thunderbolt", "irontail"])], [mon(130, 50, ["splash"])]);
  const [pika, gyara] = b.sides.map((s) => s.active[0]);
  const seed = JSON.stringify(b.prng.getSeed());
  const bolt = estimateDamage(b, pika, gyara, "thunderbolt");
  for (let i = 0; i < 100; i++) estimateDamage(b, pika, gyara, "irontail");
  assertEqual(JSON.stringify(b.prng.getSeed()), seed, "estimating damage draws nothing from the battle's random numbers");
  assertTrue(bolt > 3 * estimateDamage(b, pika, gyara, "irontail"), "a 4× super-effective hit estimates far above a resisted one");
  assertEqual(estimateDamage(b, pika, gyara, "thunderwave"), 0, "a status move does no damage");
}

section("Plans");
{
  const b = battleOf([mon(25, 50, ["quickattack", "irontail", "thunderwave", "thunderbolt"])], [mon(130, 50, ["splash"])]);
  assertEqual(chosen(b, solid("allout")), "thunderbolt", "All-out attack: the hit that does the most");
}
{
  const b = battleOf([mon(437, 50, ["gyroball", "trickroom", "earthquake"])], [mon(135, 50, ["thunderbolt"])], { plan: "speed" });
  assertEqual(chosen(b, solid("speed")), "trickroom", "Speed control: a slower Bronzong sets Trick Room");
  playTurn(b, solid("speed"));
  assertTrue(chosen(b, solid("speed")) !== "trickroom", "with Trick Room up, it attacks instead of undoing it");
}
{
  const weak = battleOf([mon(212, 50, ["bulletpunch", "swordsdance", "uturn"])], [mon(213, 50, ["splash"])], { plan: "setup" });
  assertEqual(chosen(weak, solid("setup")), "swordsdance", "Set up & sweep: Scizor boosts against a foe that can't hurt it");
  const strong = battleOf([mon(212, 50, ["bulletpunch", "swordsdance", "uturn"])], [mon(59, 70, ["flamethrower"])], { plan: "setup" });
  assertTrue(chosen(strong, solid("setup")) !== "swordsdance", "it attacks instead when the foe could knock it out");
}
{
  const fresh = battleOf([mon(25, 50, ["thunderbolt", "thunderwave"])], [mon(143, 50, ["bodyslam"])], { plan: "status" });
  assertEqual(chosen(fresh, solid("status")), "thunderwave", "Status & stall: paralyze a healthy foe");
  const paralyzed = battleOf([mon(25, 50, ["thunderbolt", "thunderwave"])], [mon(143, 50, ["bodyslam"], { status: "par" })], { plan: "status" });
  assertEqual(chosen(paralyzed, solid("status")), "thunderbolt", "never on a foe that already has a status");
}
{
  const foes = [mon(143, 50, ["bodyslam"]), mon(25, 50, ["thunderbolt"]), mon(6, 50, ["flamethrower"])];
  const b = battleOf([mon(227, 50, ["bravebird", "stealthrock"])], foes, { plan: "hazards" });
  assertEqual(chosen(b, solid("hazards")), "stealthrock", "Hazards & screens: Stealth Rock first against a full Team");
  playTurn(b, solid("hazards"));
  assertTrue(chosen(b, solid("hazards")) !== "stealthrock", "never twice");
}
{
  const b = battleOf([mon(230, 50, ["surf", "dragonpulse", "raindance"])], [mon(143, 50, ["bodyslam"])], { plan: "weather" });
  assertEqual(chosen(b, solid("weather")), "raindance", "Weather: a Swift Swim Kingdra sets rain");
}

section("Skill levels");
{
  let differ = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const b = battleOf([mon(25, 50, ["thunderbolt", "quickattack", "irontail", "thunderwave"])], [mon(143, 50, ["bodyslam"])]);
    const rookie = chosen(b, makeChooser({ plan: "allout", skill: "rookie", seed }));
    if (rookie !== chosen(b, solid("allout"))) differ++;
  }
  // 35% slips, a quarter of which land on the best move anyway: about 26%.
  assertTrue(differ >= 36, `a Rookie strays from the best move often (${differ} of 200)`);
}
{
  const POOL = [
    [6, ["flamethrower", "airslash", "dragonpulse", "focusblast"]], [9, ["surf", "icebeam", "flashcannon", "darkpulse"]],
    [3, ["energyball", "sludgebomb", "earthpower", "leafstorm"]], [25, ["thunderbolt", "grassknot", "surf", "quickattack"]],
    [143, ["bodyslam", "earthquake", "crunch", "heavyslam"]], [94, ["shadowball", "sludgebomb", "focusblast", "thunderbolt"]],
    [68, ["closecombat", "knockoff", "stoneedge", "bulletpunch"]], [149, ["dragonclaw", "earthquake", "firepunch", "extremespeed"]],
    [130, ["waterfall", "earthquake", "icefang", "crunch"]], [248, ["stoneedge", "crunch", "earthquake", "icepunch"]],
    [445, ["earthquake", "dragonclaw", "stoneedge", "firefang"]], [282, ["psychic", "moonblast", "shadowball", "thunderbolt"]],
  ];
  const rng = createRng(2026);
  const pickTeam = () => Array.from({ length: 3 }, () => POOL[rng.int(POOL.length)]).map(([id, moves]) => mon(id, 50, moves));
  let expertWins = 0, fights = 0;
  for (let n = 0; n < 150; n++) {
    const teams = [pickTeam(), pickTeam()];
    for (const expertSide of [0, 1]) {
      const ai = [0, 1].map((i) => makeChooser({ plan: "allout", skill: i === expertSide ? "expert" : "solid", seed: n * 2 + i }));
      const r = simulateFull({ sides: teams.map((members) => ({ members })), seed: 1000 + n, ai });
      fights++;
      if (r.winner === expertSide) expertWins++;
    }
  }
  assertTrue(expertWins / fights > 0.5, `Expert beats Solid more often than not (${expertWins} of ${fights})`);
}

finish();
