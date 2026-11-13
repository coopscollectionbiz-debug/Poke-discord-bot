// ==========================================================
// tests/fullSimEngine.test.js
// The Showdown engine core (utils/battle/showdown/engine.js): seeded
// determinism, our engine overrides (stat multiplier, damage roll, crit
// odds and crit damage), the turn cap, slot-order switching, and the
// fallback for a choice the engine refuses.
// ==========================================================

import { assertEqual, assertTrue, assertBetween, section, finish } from "./harness.js";
import { Dex } from "@pkmn/sim";
import { createBattle, drive, slotOf, publicLog } from "../utils/battle/showdown/engine.js";
import { computeStats } from "../utils/battle/stats.js";

const set = (species, moves, slot, o = {}) => ({
  name: `s${slot}`, species, moves, item: o.item ?? "", ability: o.ability ?? "", nature: "Hardy", gender: "",
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 },
  level: o.level ?? 50, ...(o.statMult && { statMult: o.statMult }),
});
const first = () => "move 1";
const byId = (ids) => (req) => {
  if (req.forceSwitch) return null; // the driver answers switch requests
  const moves = req.active[0].moves;
  const k = moves.findIndex((m) => ids.includes(m.id) && !m.disabled);
  return `move ${k >= 0 ? k + 1 : 1}`;
};
const logOf = (b) => publicLog(b).join("\n");

section("Determinism");
{
  const teams = () => [
    [set("Pikachu", ["thunderbolt", "quickattack", "irontail", "thunderwave"], 0), set("Snorlax", ["bodyslam", "rest"], 1)],
    [set("Gengar", ["shadowball", "sludgebomb", "willowisp", "hypnosis"], 0), set("Machamp", ["closecombat", "knockoff"], 1)],
  ];
  const run = (seed) => { const b = createBattle({ sets: teams(), seed }); drive(b, [first, first]); return logOf(b); };
  assertTrue(run(7) === run(7), "the same seed gives the same battle log");
  assertTrue(run(7) !== run(8), "a different seed gives a different battle");
}

section("Stat multiplier");
{
  const b = createBattle({ sets: [[set("Charizard", ["flamethrower"], 0, { statMult: 1.1 })], [set("Charizard", ["flamethrower"], 0)]], seed: 1 });
  const want = computeStats(Dex.species.get("Charizard").baseStats, 50);
  const [boosted, plain] = b.sides.map((s) => s.pokemon[0]);
  const stats = (p) => [p.maxhp, p.storedStats.atk, p.storedStats.def, p.storedStats.spa, p.storedStats.spd, p.storedStats.spe];
  assertEqual(stats(plain), [want.hp, want.atk, want.def, want.spa, want.spd, want.spe], "no multiplier: our stat formula (IV 15, EV 0, neutral nature)");
  assertEqual(stats(boosted), [want.hp, want.atk, want.def, want.spa, want.spd, want.spe].map((v) => Math.round(v * 1.1)), "×1.1 on every stat, HP included, rounded");
}

section("Randomness");
{
  const b = createBattle({ sets: [[set("Snorlax", ["tackle"], 0)], [set("Snorlax", ["tackle"], 0)]], seed: 3 });
  const rolls = Array.from({ length: 2000 }, () => b.randomizer(100));
  assertEqual([Math.min(...rolls), Math.max(...rolls)], [80, 100], "damage roll runs 80–100%");
  let crits = 0, hits = 0;
  for (let seed = 1; seed <= 60 && hits < 3000; seed++) {
    const fight = createBattle({ sets: [[set("Blissey", ["tackle"], 0, { level: 100 })], [set("Blissey", ["tackle"], 0, { level: 100 })]], seed });
    drive(fight, [first, first], { turnCap: 60 });
    const lines = publicLog(fight);
    hits += lines.filter((l) => l.startsWith("|-damage|") && !l.includes("[from]")).length;
    crits += lines.filter((l) => l.startsWith("|-crit|")).length;
  }
  assertBetween(crits / hits, 0.065, 0.1, "crits land about 1 time in 12");
  const fight = createBattle({ sets: [[set("Snorlax", ["tackle"], 0)], [set("Snorlax", ["tackle"], 0)]], seed: 5 });
  fight.randomizer = (x) => x; // no roll, so only the crit changes the number
  const [src, tgt] = fight.sides.map((s) => s.pokemon[0]);
  const hit = (willCrit) => { const m = fight.dex.getActiveMove("tackle"); m.willCrit = willCrit; return fight.actions.getDamage(src, tgt, m); };
  assertBetween(hit(true) / hit(false), 1.85, 2.15, "a critical hit does ×2 damage");
}

section("Turn cap");
{
  const b = createBattle({ sets: [[set("Shuckle", ["splash"], 0)], [set("Shuckle", ["splash"], 0)]], seed: 1 });
  const { cappedAt } = drive(b, [first, first], { turnCap: 5 });
  assertEqual([cappedAt, b.ended], [5, false], "a fight nobody can end stops at the turn cap");
}

section("Slot order");
{
  // Slot 0 U-turns out; slot 1 (lowest healthy on the bench) comes in and is
  // knocked out; slot 0 is healthy again and comes back before slot 2.
  const b = createBattle({
    sets: [
      [set("Scizor", ["uturn"], 0), set("Magikarp", ["splash"], 1, { level: 5 }), set("Snorlax", ["bodyslam"], 2)],
      [set("Snorlax", ["bodyslam"], 0, { level: 60 })],
    ],
    seed: 2,
  });
  drive(b, [byId(["uturn", "splash", "bodyslam"]), first], { turnCap: 4 });
  const switchIns = publicLog(b).filter((l) => l.startsWith("|switch|p1a: ")).map((l) => Number(/p1a: s(\d+)/.exec(l)[1]));
  assertEqual(switchIns.slice(0, 3), [0, 1, 0], "after a U-turn and a faint, the lowest healthy slot comes in");
  assertEqual(slotOf(b.sides[0].pokemon.find((p) => p.name === "s2")), 2, "slotOf reads the slot from the nickname");
}

section("A refused choice");
{
  const b = createBattle({ sets: [[set("Pikachu", ["thundershock"], 0)], [set("Pikachu", ["thundershock"], 0)]], seed: 1 });
  let threw = false;
  try { drive(b, [() => "move 4", first]); } catch { threw = true; }
  assertTrue(!threw && b.ended, "a choice the engine refuses falls back to its default and the fight finishes");
}

finish();
