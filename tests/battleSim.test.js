// ==========================================================
// tests/battleSim.test.js
// Gen 5 stat formula, Movesets, and the seeded battle sim.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { getSpecies, getMove, effectiveness, fallbackMoveFor } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { autoMoveset, learnMove, movesTaught, knownMoves, withFallback } from "../utils/battle/moveset.js";
import { simulateBattle, buildMon, firstToMove, useMove } from "../utils/battle/sim.js";
import { TURN_CAP } from "../utils/battle/tuning.js";

const side = (...members) => ({ members: members.map(([speciesId, level]) => ({ speciesId, variant: "normal", level })) });
const battle = (a, b, seed) => simulateBattle({ sides: [side(...a), side(...b)], seed, surge: null });

section("Stats");
assertEqual(computeStats(getSpecies(25).baseStats, 50), { hp: 102, atk: 67, def: 42, spa: 62, spd: 52, spe: 102 }, "Pikachu Lv 50 stats (IV 15, EV 0)");

section("Default Movesets");
// The rule battles used before players could choose moves, kept here as the reference.
const lastFour = (id, level) => {
  const out = [];
  for (const [l, m] of getSpecies(id).levelMoves) {
    if (l > level) break;
    const i = out.indexOf(m);
    if (i >= 0) out.splice(i, 1);
    out.push(m);
  }
  return out.slice(-4);
};
assertEqual(autoMoveset(1, 30), lastFour(1, 30), "Bulbasaur Lv 30 knows its last 4 learned moves");
const speciesIds = Array.from({ length: 649 }, (_, i) => i + 1);
const levels = [1, 5, 10, 16, 25, 32, 40, 50, 64, 80, 100];
assertTrue(
  speciesIds.every((id) => levels.every((l) => JSON.stringify(knownMoves(id, l)) === JSON.stringify(lastFour(id, l)))),
  "with no choice, every species' Moveset is the old last-4 rule at every sampled Level",
);
assertEqual(autoMoveset(63, 50), [fallbackMoveFor(["Psychic"])], "Abra falls back to a Psychic move");
assertEqual(autoMoveset(129, 14), [fallbackMoveFor(["Water"])], "Magikarp under 15 falls back to a Water move");
assertTrue(autoMoveset(129, 15).includes("tackle"), "Magikarp knows Tackle at 15");
const flame = getSpecies(4).levelMoves.find(([, m]) => m === "flamethrower");
assertTrue(!!flame, "Charmander learns Flamethrower by level");
assertEqual(movesTaught(4, flame[0] - 1, flame[0]), ["flamethrower"], "movesTaught reports Flamethrower on the level it's learned");
assertEqual(movesTaught(4, flame[0], flame[0]), [], "no moves taught without a level change");
const hitmonchan16 = getSpecies(107).levelMoves.filter(([l]) => l === 16).map(([, m]) => m);
assertEqual(hitmonchan16.length, 2, "fixture: Hitmonchan's Learnset teaches two moves at Lv 16");
assertEqual(movesTaught(107, 15, 16), hitmonchan16, "both moves taught at one Level are reported, in order");

section("Learning a move (the default)");
assertEqual(learnMove(["a", "b"], "c"), ["a", "b", "c"], "room left: the move is added as the newest");
assertEqual(learnMove(["a", "b", "c", "d"], "e"), ["b", "c", "d", "e"], "full: the oldest is forgotten");
assertEqual(learnMove(["a", "b", "c", "d"], "b"), ["a", "c", "d", "b"], "a known move becomes the newest again, nothing forgotten");
assertEqual(withFallback(63, []), [fallbackMoveFor(["Psychic"])], "no damaging move: the stand-in");
assertEqual(withFallback(63, ["tackle"]), ["tackle"], "any real move replaces the stand-in");

section("Known moves with a choice");
// Charmander Lv 33 knows scratch, ember, firefang, flameburst. At 34 it learned slash, and the
// player had it forget flameburst instead of scratch.
const choice = { moves: ["scratch", "ember", "firefang", "slash"], movesLevel: 34 };
assertEqual(knownMoves(4, 34, choice), choice.moves, "at the Level it was chosen: exactly the choice");
assertEqual(knownMoves(4, 37, choice), ["ember", "firefang", "slash", "flamethrower"], "later moves are learned on top, forgetting the oldest");
assertEqual(knownMoves(4, 33, null), ["scratch", "ember", "firefang", "flameburst"], "no choice: the last 4 taught");

section("Determinism and variety");
assertEqual(battle([[25, 30]], [[25, 30]], 7), battle([[25, 30]], [[25, 30]], 7), "same seed → same battle");
const mirror = Array.from({ length: 50 }, (_, i) => battle([[25, 30]], [[25, 30]], i + 1));
assertTrue(new Set(mirror.map((r) => r.turns)).size >= 2, "different seeds give different turn counts");
assertTrue(mirror.some((r) => r.winner === 0) && mirror.some((r) => r.winner === 1), "both sides win a Pikachu mirror sometimes");

section("Snapshots");
const r = battle([[6, 40], [25, 30]], [[19, 20], [16, 18]], 3);
assertTrue(r.snapshots[0].flat().every((hp) => hp === 1), "turn 0 is full HP");
assertTrue(r.snapshots.at(-1)[1 - r.winner].every((hp) => hp === 0), "every loser member ends at 0");
assertEqual(r.snapshots.length, r.turns + 1, "one snapshot per turn plus the start");
assertTrue(r.knockouts.length >= 2, "knockouts are recorded");

section("Turn log (what playback narrates)");
assertEqual(r.log.length, r.turns, "one log entry per turn");
assertTrue(r.log.every((events) => events.length >= 1 && events.length <= 2), "each turn has one or two attacks");
// Replaying a turn's events from the start-of-turn HP must land on the
// end-of-turn snapshot. Drain and recoil change the attacker's HP too.
const replays = (b) => b.log.every((events, t) => {
  const hp = b.snapshots[t].map((row) => [...row]);
  for (const e of events) {
    hp[1 - e.side][e.targetSlot] = e.hpAfter;
    if ("userHpAfter" in e) hp[e.side][e.slot] = e.userHpAfter;
  }
  return JSON.stringify(hp) === JSON.stringify(b.snapshots[t + 1]);
});
// Who fainted, in order, according to the events.
const faintsInLog = (b) => b.log.flatMap((events, t) => events.flatMap((e) => [
  e.fainted && { turn: t + 1, side: 1 - e.side, slot: e.targetSlot },
  e.userFainted && { turn: t + 1, side: e.side, slot: e.slot },
].filter(Boolean)));
assertTrue(replays(r), "each turn's hits replay to the end-of-turn snapshot");
assertEqual(faintsInLog(r), r.knockouts.map(({ turn, side, slot }) => ({ turn, side, slot })), "fainting hits match the knockouts");
assertTrue(r.log.flat().every((e) => typeof e.move === "string" && e.move && typeof e.crit === "boolean" && typeof e.eff === "number"),
  "each hit names its move and records crit and effectiveness");
assertTrue(r.log.flat().every((e) => !e.missed || e.damage === 0), "a miss does no damage");

section("Stalemate");
assertTrue(autoMoveset(19, 5).every((m) => getMove(m).type === "Normal"), "Rattata Lv 5 only has Normal moves");
assertTrue(autoMoveset(92, 20).every((m) => effectiveness(getMove(m).type, ["Normal"]) === 0), "Gastly Lv 20 can't hit Normal types");
const stale = battle([[92, 20]], [[19, 5]], 1);
assertEqual([stale.endedBy, stale.turns], ["turnCap", TURN_CAP], "Ghost vs Normal ends at the turn cap");

section("Level dominance");
const wins = Array.from({ length: 200 }, (_, i) => battle([[6, 60]], [[19, 5]], i)).filter((x) => x.winner === 0).length;
assertEqual(wins, 200, "Charizard Lv 60 always beats Rattata Lv 5 without a surge");

section("Shedinja (Wonder Guard)");
assertTrue(autoMoveset(25, 50).every((m) => effectiveness(getMove(m).type, ["Bug", "Ghost"]) <= 1), "Pikachu Lv 50 has nothing super-effective on Shedinja");
const guarded = battle([[292, 50]], [[25, 50]], 5);
assertTrue(guarded.snapshots.every((s) => s[0][0] === 1), "Shedinja takes no damage from Pikachu");
const burned = battle([[292, 50]], [[4, 50]], 5);
assertTrue(burned.snapshots.every((s) => s[0][0] === 1 || s[0][0] === 0), "Shedinja has exactly 1 HP (full or fainted)");
assertEqual(burned.winner, 1, "Charmander's Fire move knocks Shedinja out");

// Feeds the sim fixed random draws, in order, and fails the test if it asks
// for more than it was given (an unexpected extra draw).
const draws = (...values) => {
  const next = () => {
    if (!values.length) throw new Error("the sim drew more random numbers than expected");
    return values.shift();
  };
  return { next, int: (n) => Math.floor(next() * n) };
};
const HIT = 0, NO_CRIT = 0.99, ROLL = 0.5;
const plainHit = [HIT, NO_CRIT, ROLL];
const mon = (speciesId, level = 50) => buildMon({ speciesId, level });
const lost = (m) => m.maxHp - m.hp;

section("Drain");
{
  const venusaur = mon(3);
  venusaur.hp = 10;
  const hit = useMove(getMove("gigadrain"), venusaur, mon(143), draws(...plainHit));
  assertTrue(hit.damage > 2, `Giga Drain hits Snorlax (${hit.damage} damage)`);
  assertEqual([venusaur.hp, hit.drain], [10 + Math.round(hit.damage / 2), Math.round(hit.damage / 2)], "it heals half the damage dealt, rounded");
}
{
  const venusaur = mon(3);
  useMove(getMove("gigadrain"), venusaur, mon(143), draws(...plainHit));
  assertEqual(venusaur.hp, venusaur.maxHp, "draining at full HP doesn't heal past it");
}
{
  const venusaur = mon(3, 100);
  const rattata = mon(19, 5);
  venusaur.hp = 50;
  rattata.hp = 3;
  const hit = useMove(getMove("gigadrain"), venusaur, rattata, draws(...plainHit));
  assertEqual([hit.damage, venusaur.hp], [3, 52], "damage and drain stop at the target's last 3 HP (half of 3 rounds to 2)");
}

section("Recoil");
{
  const staraptor = mon(398);
  const hit = useMove(getMove("bravebird"), staraptor, mon(143), draws(...plainHit));
  assertEqual([lost(staraptor), hit.recoil], [Math.round(hit.damage * 0.33), Math.round(hit.damage * 0.33)], "Brave Bird costs the user 33% of the damage dealt");
}
{
  const staraptor = mon(398);
  const rattata = mon(19, 5);
  rattata.hp = 1;
  useMove(getMove("bravebird"), staraptor, rattata, draws(...plainHit));
  assertEqual(lost(staraptor), 1, "recoil is at least 1 HP");
}
{
  const staraptor = mon(398);
  staraptor.hp = 1;
  const hit = useMove(getMove("bravebird"), staraptor, mon(143), draws(...plainHit));
  assertEqual([staraptor.hp, hit.recoil], [0, 1], "recoil can make the user faint");
}
{
  const bastiodon = mon(411);
  const hit = useMove(getMove("headsmash"), bastiodon, mon(143), draws(0.9));
  assertEqual([hit.missed, lost(bastiodon), "recoil" in hit], [true, 0, false], "a missed Head Smash costs nothing");
}

section("Crash");
{
  const hitmonlee = mon(106);
  const snorlax = mon(143);
  const hit = useMove(getMove("highjumpkick"), hitmonlee, snorlax, draws(0.95));
  assertEqual([hit.missed, hit.crash, lost(hitmonlee), lost(snorlax)], [true, Math.floor(hitmonlee.maxHp / 2), Math.floor(hitmonlee.maxHp / 2), 0],
    "a missed High Jump Kick costs the user half its max HP");
}
{
  const hitmonlee = mon(106);
  const hit = useMove(getMove("highjumpkick"), hitmonlee, mon(94), draws(HIT));
  assertEqual([hit.eff, hit.crash], [0, Math.floor(hitmonlee.maxHp / 2)], "kicking a Ghost type crashes too");
}
{
  const hitmonlee = mon(106);
  const hit = useMove(getMove("highjumpkick"), hitmonlee, mon(143), draws(...plainHit));
  assertEqual([lost(hitmonlee), "crash" in hit], [0, false], "a High Jump Kick that lands costs nothing");
}

section("Multi-hit");
{
  // Each hit after the count rolls its own crit and damage; give it plenty.
  const hitsFor = (i) => useMove(getMove("bulletseed"), mon(286), mon(143), draws(HIT, (i + 0.5) / 20, ...Array(10).fill([NO_CRIT, ROLL]).flat())).hits;
  assertEqual(Array.from({ length: 20 }, (_, i) => hitsFor(i)), [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5],
    "Bullet Seed hits 2 or 3 times 35% of the time each, 4 or 5 times 15% each (Gen 5)");
  const five = useMove(getMove("bulletseed"), mon(286), mon(143), draws(HIT, 0.99, ...Array(5).fill([NO_CRIT, ROLL]).flat()));
  const one = useMove({ ...getMove("bulletseed"), multihit: undefined }, mon(286), mon(143), draws(...plainHit));
  assertEqual(five.damage, 5 * one.damage, "each hit does its own damage");
  const rattata = mon(19, 5);
  rattata.hp = 1;
  const early = useMove(getMove("bulletseed"), mon(286), rattata, draws(HIT, 0.99, NO_CRIT, ROLL));
  assertEqual([early.hits, early.damage], [1, 1], "hits stop once the target faints");
}
{
  const kick = useMove(getMove("doublekick"), mon(106), mon(143), draws(HIT, NO_CRIT, ROLL, 0, ROLL));
  assertEqual([kick.hits, kick.crit], [2, true], "Double Kick always hits twice, and a critical second hit counts");
}
{
  const kicks = (move, ...rest) => useMove(move, mon(237), mon(143), draws(...rest));
  const all = [...plainHit, ...plainHit, ...plainHit];
  assertEqual(kicks(getMove("triplekick"), ...plainHit, ...plainHit, 0.95).hits, 2, "Triple Kick stops at its first missed kick");
  assertTrue(kicks(getMove("triplekick"), ...all).damage > kicks({ ...getMove("triplekick"), risingPower: undefined }, ...all).damage,
    "Triple Kick's kicks get stronger (10, 20, then 30 power)");
}

section("Turn order");
{
  const slowpoke = mon(79), jolteon = mon(135);
  const moves = (...ids) => ids.map(getMove);
  assertEqual(firstToMove([slowpoke, jolteon], moves("tackle", "tackle"), draws()), 1, "the faster Pokémon moves first");
  assertEqual(firstToMove([slowpoke, jolteon], moves("quickattack", "tackle"), draws()), 0, "a +1 priority move goes before a faster Pokémon");
  assertEqual(firstToMove([slowpoke, jolteon], moves("extremespeed", "quickattack"), draws()), 0, "+2 priority goes before +1");
  assertEqual(firstToMove([jolteon, slowpoke], moves("vitalthrow", "tackle"), draws()), 1, "a -1 priority move goes after a slower Pokémon");
  assertEqual([0.2, 0.7].map((d) => firstToMove([mon(25), mon(25)], moves("tackle", "tackle"), draws(d))), [0, 1], "a Speed tie is a coin flip");
}

section("Recoil knockouts in battles");
{
  // Raticate Lv 50 knows Double-Edge (120 power, 33% recoil).
  assertTrue(autoMoveset(20, 50).includes("doubleedge"), "fixture: Raticate Lv 50 knows Double-Edge");
  const mirrors = Array.from({ length: 300 }, (_, i) => battle([[20, 50]], [[20, 50]], i + 1));
  const selfKOs = mirrors.flatMap((b) => b.log.flat().filter((e) => e.userFainted).map((e) => ({ b, e })));
  assertTrue(selfKOs.length > 0, `some Raticate faint from their own recoil (${selfKOs.length} in 300 battles)`);
  assertTrue(selfKOs.every(({ b, e }) => b.knockouts.some((k) => k.side === e.side && k.slot === e.slot && k.bySide === 1 - e.side && k.bySlot === e.targetSlot)),
    "a recoil faint counts as a knockout for the Pokémon that was hit");
  // Gen 5: when both last Pokémon faint in one move, the side whose Pokémon fainted last (the recoil user's) wins.
  const both = selfKOs.filter(({ b, e }) => e.fainted && b.log.at(-1).at(-1) === e);
  assertTrue(both.length > 0, `some battles end with both Raticate fainting on one Double-Edge (${both.length})`);
  assertTrue(both.every(({ b, e }) => b.winner === e.side), "the Raticate that used Double-Edge wins");
  assertTrue(mirrors.every(replays), "battles with recoil replay to their snapshots");
  assertEqual(mirrors.map(faintsInLog), mirrors.map((b) => b.knockouts.map(({ turn, side, slot }) => ({ turn, side, slot }))), "and their faints match the knockouts");
}

section("Drain in battles");
{
  assertTrue(autoMoveset(47, 50).includes("gigadrain"), "fixture: Parasect Lv 50 knows Giga Drain");
  const drains = Array.from({ length: 50 }, (_, i) => battle([[47, 50]], [[62, 50]], i + 1));
  assertTrue(drains.some((b) => b.log.flat().some((e) => e.drain > 0)), "Parasect heals during battles");
  assertTrue(drains.every(replays), "battles with drain replay to their snapshots");
}

finish();
