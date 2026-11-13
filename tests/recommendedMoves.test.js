// ==========================================================
// tests/recommendedMoves.test.js
// Recommended moves (services/battlePlans.js recommendMoves, recommended),
// what the Moves editor's "Use recommended moves" fills in: one move for
// the Team's Battle plan when the Pokémon has one the plan would use, then
// its strongest attacks: its own types, the attacking stat it's better at
// (and the one the plan's move raises), accuracy and hits, new types first.
// An attack that recharges or charges counts half; one that faints its user
// or usually fails is left out. Nothing here saves a Moveset.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { recommendMoves, recommended, setPlan } from "../services/battlePlans.js";
import { chosenMoves, validateMoveset } from "../services/movesets.js";
import { getSpecies, getMove } from "../utils/battle/data.js";
import { moveRoles, BATTLE_PLANS } from "../catalog/battlePlans.js";
import { createNewUser } from "../utils/userSchema.js";

const ON = { FULL_SIM_ENABLED: "1" };
const pick = (speciesId, moveIds, plan, mates = []) => recommendMoves(speciesId, moveIds, plan, { mates, env: ON });
const withFullSim = (fn) => {
  const saved = process.env.FULL_SIM_ENABLED;
  process.env.FULL_SIM_ENABLED = "1";
  try { return fn(); } finally { if (saved === undefined) delete process.env.FULL_SIM_ENABLED; else process.env.FULL_SIM_ENABLED = saved; }
};
function player(id, speciesIds, level) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    u.training ??= {};
    u.training[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.battleTeam = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}

section("Set up & sweep on a Lv 47 Rayquaza (the case that asked for this)");
withFullSim(() => {
  const u = player("A", [384], 47);
  setPlan(u, "display", "setup");
  const r = recommended(u, "display", 384, "normal");
  assertEqual([r.helper, r.moves[0]], ["dragondance", "dragondance"], "Dragon Dance for Set up & sweep, listed first");
  assertEqual(r.moves.length, 4, "then three attacks");
  assertTrue(r.moves.includes("dragonascent") && !r.moves.includes("airslash"), "its strongest Flying attack, not a second, weaker one");
  assertTrue(validateMoveset(u, 384, "normal", r.moves).ok, "every pick can be saved");
  assertEqual(chosenMoves(u, "display", 384, "normal"), null, "nothing is saved until the player saves");
  assertEqual(recommended(u, "battle", 384, "normal").helper, null, "the Ranked team follows its own plan (All-out attack)");
});

section("The stat a setup move raises");
{
  const both = ["swordsdance", "nastyplot", "shadowball", "shadowclaw"];
  assertEqual(pick(94, both, "setup").helper, "nastyplot", "Gengar, better at Special Attack, raises that");
  assertEqual(pick(68, both, "setup").helper, "swordsdance", "Machamp, better at Attack, raises that");
  // Entei is better at Attack: Calm Mind would spend its safe turns raising the wrong stat.
  assertEqual(pick(244, ["calmmind", "sacredfire", "crunch"], "setup").helper, null, "a setup move that raises only the weaker attacking stat isn't one");
  // A Speed raise only for a Pokémon slower than the average one, as the AI
  // plays it only against a faster foe (utils/battle/ai/choose.js).
  assertEqual(pick(76, ["calmmind", "agility", "rockslide"], "setup").helper, "agility", "one that raises Speed is, on a slow Golem");
  assertEqual(pick(244, ["calmmind", "agility", "sacredfire"], "setup").helper, null, "but not on a fast Entei");
  assertEqual(pick(386, ["agility", "psychic", "superpower"], "setup").helper, null, "nor a Deoxys, faster than almost anything it meets");
  // Mew is as good at both, so the plan's move decides which attacks hit harder.
  const mew = (helper) => pick(151, [helper, "crunch", "darkpulse", "flamethrower", "thunderpunch"], "setup").moves;
  assertTrue(mew("swordsdance").includes("crunch") && !mew("swordsdance").includes("darkpulse"), "after Swords Dance, the physical Dark attack");
  assertTrue(mew("nastyplot").includes("darkpulse") && !mew("nastyplot").includes("thunderpunch"), "after Nasty Plot, the special one, and the weakest physical attack drops");
}

section("New types first, but not a weak one");
{
  const zard = ["flamethrower", "fireblast", "airslash", "dragonpulse", "slash"];
  const allout = pick(6, zard, "allout");
  assertEqual(allout.helper, null, "All-out attack has no plan move");
  assertTrue(allout.moves.includes("flamethrower") && !allout.moves.includes("slash"), "a weak Normal attack doesn't push out a second strong Fire one");
  const setup = pick(6, ["nastyplot", ...zard], "setup").moves;
  assertTrue(setup.includes("dragonpulse") && !setup.includes("flamethrower"), "with three slots, Dragon Pulse's new type beats a second Fire attack");
}

section("Drawbacks, hits and fixed damage");
{
  assertEqual(pick(143, ["gigaimpact", "bodyslam", "crunch"], "allout").moves[0], "bodyslam", "Giga Impact's recharge turn counts against it");
  assertTrue(!pick(110, ["explosion", "sludgebomb", "tackle"], "allout").moves.includes("explosion"), "an attack that faints its user is left out");
  assertTrue(!pick(97, ["dreameater", "psychic"], "allout").moves.includes("dreameater"), "so is one that fails unless the foe is asleep");
  assertEqual(pick(100, ["selfdestruct", "thunderwave"], "status").moves, ["thunderwave", "selfdestruct"], "unless it's the only attack it knows");
  assertEqual(pick(74, ["rockthrow", "rockblast"], "allout").moves[0], "rockblast", "Rock Blast's hits add up (3 on average) past Rock Throw");
  assertEqual(pick(68, ["tackle", "seismictoss"], "allout").moves[0], "seismictoss", "Seismic Toss counts as a middling hit, as the AI scores it");
  assertEqual(pick(129, ["splash"], "allout").moves, ["splash"], "a Pokémon with no attack keeps what it knows");
}

section("Status & stall");
assertEqual(pick(25, ["thunderwave", "thunderbolt", "toxic"], "status").helper, "toxic", "the status move it learned last");

section("Team-wide plans: no doubling up");
{
  const rocks = ["stealthrock", "spikes", "earthquake", "stoneedge"];
  assertEqual(pick(76, rocks, "hazards", [{ speciesId: 227, moves: ["spikes", "bravebird"] }]).helper, "stealthrock", "a hazard a teammate already sets isn't doubled");
  const covered = pick(76, rocks, "hazards", [{ speciesId: 227, moves: ["spikes"] }, { speciesId: 248, moves: ["stealthrock"] }]);
  assertEqual([covered.helper, covered.moves.every((id) => moveRoles(id).includes("attack"))], [null, true], "when teammates set both, it brings attacks");

  // The weather the AI plays to: the one most of the Team's types and abilities like.
  const skies = ["raindance", "sunnyday", "surf", "flamethrower"];
  assertEqual(pick(9, skies, "weather", [{ speciesId: 130, moves: [] }]).helper, "raindance", "a Water Team sets rain");
  assertEqual(pick(6, skies, "weather", [{ speciesId: 59, moves: [] }]).helper, "sunnyday", "a Fire Team sets sun");
  assertEqual(pick(143, skies, "weather", [{ speciesId: 128, moves: [] }]).helper, null, "a Team no weather helps gets none");
  assertEqual(pick(9, skies, "weather", [{ speciesId: 279, moves: [] }]).helper, null, "nor when a teammate's Drizzle already brings rain");

  const both = ["trickroom", "tailwind", "bodyslam"];
  assertEqual(pick(143, both, "speed", [{ speciesId: 76, moves: [] }]).helper, "trickroom", "a Team slower than the average Pokémon sets Trick Room");
  assertEqual(pick(135, both, "speed", [{ speciesId: 101, moves: [] }]).helper, "tailwind", "a faster one sets Tailwind");
  assertEqual(pick(143, ["tailwind", "bodyslam"], "speed", [{ speciesId: 76, moves: [] }]).helper, "tailwind", "the only one it knows, either way");
  assertEqual(pick(143, both, "speed", [{ speciesId: 76, moves: ["trickroom"] }]).helper, null, "and not one a teammate already brings");
}

section("Every species, plan and Level");
{
  const isAttack = (id) => getMove(id, ON).category !== "Status";
  const helps = (id, plan) => moveRoles(id).some((role) => plan.roles.includes(role));
  // A setup move that raises the attacking stat the Pokémon is better at (either,
  // when even), or Speed when it's slower than the average Pokémon.
  let speeds = 0, n = 0;
  for (let id = 1; getSpecies(id, ON); id++, n++) speeds += getSpecies(id, ON).baseStats.spe;
  const raisesUseful = (speciesId, m) => {
    const { atk, spa, spe } = getSpecies(speciesId, ON).baseStats;
    return [...(spe < speeds / n ? ["spe"] : []), ...(atk >= spa ? ["atk"] : []), ...(spa >= atk ? ["spa"] : [])].some((s) => getMove(m, ON).boosts?.[s] > 0);
  };
  const bad = [];
  let runs = 0;
  for (let id = 1; id <= 1025; id++) {
    for (const lv of [5, 30, 60, 100]) {
      const ids = [...new Set(getSpecies(id, ON).levelMoves.filter(([at]) => at <= lv).map(([, m]) => m))].filter((m) => getMove(m, ON));
      if (!ids.length) continue;
      for (const plan of BATTLE_PLANS) {
        const r = pick(id, ids, plan.id);
        runs++;
        const ok = r.moves.length >= 1 && r.moves.length <= 4 && new Set(r.moves).size === r.moves.length && r.moves.every((m) => ids.includes(m))
          && (r.helper == null || (r.moves[0] === r.helper && helps(r.helper, plan) && (plan.id !== "setup" || raisesUseful(id, r.helper))))
          && (!ids.some(isAttack) || r.moves.some(isAttack))
          && (!["setup", "status"].includes(plan.id) || r.helper != null || !ids.some((m) => helps(m, plan) && (plan.id !== "setup" || raisesUseful(id, m))));
        if (!ok) bad.push(`#${id} Lv ${lv} ${plan.id}: ${r.moves.join(",")}`);
      }
    }
  }
  assertEqual(bad.slice(0, 5), [], `${runs} picks: 1–4 distinct moves it has learned, the plan's move first, an attack whenever it knows one, a status move whenever it knows one, and a setup move whenever it knows one that raises its better attacking stat, or Speed when it's slow, and no other setup move`);
}

finish();
