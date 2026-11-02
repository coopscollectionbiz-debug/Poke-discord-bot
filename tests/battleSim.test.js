// ==========================================================
// tests/battleSim.test.js
// Gen 5 stat formula, auto movesets, and the seeded battle sim.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { getSpecies, getMove, effectiveness, fallbackMoveFor } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { autoMoveset, movesLearned } from "../utils/battle/moveset.js";
import { simulateBattle } from "../utils/battle/sim.js";
import { TURN_CAP } from "../utils/battle/tuning.js";

const side = (...members) => ({ members: members.map(([speciesId, level]) => ({ speciesId, variant: "normal", level })) });
const battle = (a, b, seed) => simulateBattle({ sides: [side(...a), side(...b)], seed, surge: null });

section("Stats");
assertEqual(computeStats(getSpecies(25).baseStats, 50), { hp: 102, atk: 67, def: 42, spa: 62, spd: 52, spe: 102 }, "Pikachu Lv 50 stats (IV 15, EV 0)");

section("Auto movesets");
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
assertEqual(autoMoveset(63, 50), [fallbackMoveFor(["Psychic"])], "Abra falls back to a Psychic move");
assertEqual(autoMoveset(129, 14), [fallbackMoveFor(["Water"])], "Magikarp under 15 falls back to a Water move");
assertTrue(autoMoveset(129, 15).includes("tackle"), "Magikarp knows Tackle at 15");
const flame = getSpecies(4).levelMoves.find(([, m]) => m === "flamethrower");
assertTrue(!!flame, "Charmander learns Flamethrower by level");
assertTrue(movesLearned(4, flame[0] - 1, flame[0]).includes("flamethrower"), "movesLearned reports Flamethrower on the level it's learned");
assertEqual(movesLearned(4, flame[0], flame[0]), [], "no moves learned without a level change");

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

finish();
