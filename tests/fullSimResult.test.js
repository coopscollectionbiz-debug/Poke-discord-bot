// ==========================================================
// tests/fullSimResult.test.js
// simulateFull (utils/battle/showdown/simulate.js): a Showdown battle from
// our Team members, and its result in today's shape plus the v2 fields.
// ==========================================================

import { assertEqual, assertTrue, assertBetween, section, finish } from "./harness.js";
import { simulateFull } from "../utils/battle/showdown/simulate.js";
import { memberSet } from "../utils/battle/showdown/sets.js";
import { megaBattleProfile } from "../utils/megas.js";

const mon = (speciesId, level, moves, extra = {}) => ({ speciesId, variant: "normal", name: `#${speciesId}`, level, moves, ...extra });
const fight = (a, b, seed = 1, opts = {}) => simulateFull({ sides: [{ members: a }, { members: b }], seed, surge: null, ...opts });
const turnOne = (moveIndex) => (req, b) => (b.turn === 1 ? `move ${moveIndex}` : "move 2");

section("Result shape");
{
  const r = fight([mon(25, 50, ["thunderbolt", "quickattack"]), mon(143, 50, ["bodyslam"])], [mon(94, 50, ["shadowball"]), mon(68, 50, ["closecombat"])], 4);
  assertEqual(["winner", "turns", "endedBy", "snapshots", "knockouts", "log"].every((k) => k in r), true, "every field today's result has");
  assertEqual([r.v, Array.isArray(r.steps), Array.isArray(r.raw), r.endStatus.length], [2, true, true, 2], "plus v 2, steps, the raw log and the end status");
  assertTrue(r.winner === 0 || r.winner === 1, "the winner is side 0 or 1");
  assertEqual(r.snapshots.length, r.turns + 1, "one HP snapshot before the battle and one per turn");
  assertEqual(r.log.length, r.turns, "one event list per turn");
  assertEqual(r.conditions.length, r.snapshots.length, "one condition record per snapshot (a fight won by knockout)");
  assertTrue(r.knockouts.every((k) => k.bySide === 1 - k.side), "every knockout counts for the other side");
  assertTrue(r.raw.every((l) => !l.startsWith("|t:|")), "the raw log has no timestamps");
  const hit = r.log.flat().find((e) => e.damage > 0);
  assertTrue(hit && typeof hit.move === "string" && hit.hpAfter < 1 && "targetSlot" in hit, "a hit carries its move, target and the HP left");
}

section("Knockout credit");
{
  // Shuckle poisons a Pidgey that can only Splash; the poison knocks it out.
  const r = fight([mon(213, 50, ["toxic", "protect"])], [mon(16, 10, ["splash"])], 2);
  const ko = r.knockouts[0];
  assertEqual([r.winner, ko.side, ko.bySide, ko.bySlot], [0, 1, 0, 0], "a poison knockout counts for the Pokémon on the field across from it");
  assertTrue(r.steps.flat().some((s) => s.kind === "status" && s.side === 1 && /psn|tox/.test(s.status)), "the poisoning is a status step");
  assertTrue(r.steps.flat().some((s) => s.kind === "hp" && s.side === 1 && s.from), "poison damage is an HP step with its cause");
}
{
  // A Staraptor on its last HP knocks itself out with Brave Bird's recoil.
  const r = fight([mon(398, 50, ["bravebird"], { hpFraction: 0.01 })], [mon(143, 50, ["splash"]), mon(143, 50, ["splash"])], 3);
  const self = r.knockouts.find((k) => k.side === 0);
  assertEqual([self?.bySide, self?.bySlot], [1, 0], "a recoil knockout counts for the foe it hit");
}

section("Hazards");
{
  // Garchomp sets Stealth Rock, then knocks out the lead; the next foe is hurt coming in.
  const r = fight([mon(445, 100, ["stealthrock", "earthquake"])], [mon(25, 20, ["thundershock"]), mon(4, 20, ["ember"])], 5, { ai: [turnOne(1), () => "move 1"] });
  assertTrue(r.steps.flat().some((s) => s.kind === "hp" && s.side === 1 && /Stealth Rock/.test(s.from ?? "")), "Stealth Rock damage is an HP step from Stealth Rock");
  assertTrue(r.steps.flat().some((s) => s.kind === "switch" && s.side === 1 && s.slot === 1), "the switch-in is a step");
}

section("Carried HP and status (Elite Four)");
{
  const r = fight([mon(143, 50, ["bodyslam"], { hpFraction: 0.5, status: "psn" }), mon(25, 50, ["thunderbolt"], { hpFraction: 0 })], [mon(16, 30, ["gust"])], 6);
  assertBetween(r.snapshots[0][0][0], 0.49, 0.51, "a member starts at the HP it carried");
  assertEqual(r.snapshots[0][0][1], 0, "a fainted member stays fainted");
  assertTrue(r.raw.some((l) => l.startsWith("|switch|p1a: s0|") && / psn$/.test(l)), "the carried poison is on the Pokémon from the start");
  assertTrue(!r.raw.some((l) => l.startsWith("|switch|p1a: s1|")), "a fainted member never comes in");
  const out = fight([mon(143, 50, ["bodyslam"], { hpFraction: 0 })], [mon(16, 30, ["gust"])], 6);
  assertEqual([out.winner, out.turns, out.endedBy], [1, 0, "knockout"], "a side with nobody left loses before the first turn");
  assertEqual(out.conditions, [{ status: [[""], [""]], active: [null, null] }], "…with one condition record: before the leads");
  assertEqual([r.conditions[0].status[0], r.conditions[0].active], [["psn", ""], [null, null]], "the carried poison is recorded before the leads come in, a fainted member has none");
}

section("Sets");
{
  assertEqual(memberSet(mon(6, 50, ["flamethrower"], { item: "lucky_egg" }), { slot: 0 }).item, "", "Lucky Egg has no battle effect, so the engine sees no item");
  assertEqual(memberSet(mon(6, 50, ["flamethrower"], { item: "leftovers" }), { slot: 0 }).item, "Leftovers", "a held item goes in by its name");
  const profile = megaBattleProfile("mega-charizard-x");
  const set = memberSet(mon(6, 50, ["flareblitz"], { battleProfile: profile }), { slot: 2 });
  assertEqual([set.species, set.ability, set.name], ["Charizard-Mega-X", profile.ability, "s2"], "a Mega slot fights as its Mega forme with its own ability");
  const r = fight([mon(6, 50, ["dragonclaw"], { battleProfile: profile })], [mon(143, 50, ["splash"])], 7);
  assertTrue(r.winner === 0 || r.winner === 1, "a Mega fights without throwing");
  assertEqual(memberSet(mon(6, 50, ["flamethrower"], { hpFraction: 0 }), { slot: 0 }), null, "a fainted member has no set");
  const surged = memberSet(mon(25, 40, ["thunderbolt"]), { slot: 0, levelMult: 1.5, statMult: 1.2 });
  assertEqual([surged.level, surged.statMult], [60, 1.2], "a surge raises the Level and multiplies the stats");
  assertEqual(memberSet(mon(25, 50, ["thunderbolt"], { statMult: 1.1 }), { slot: 0, statMult: 1.2 }).statMult, 1.1 * 1.2, "a Challenge boost and a surge multiply");
}

finish();
