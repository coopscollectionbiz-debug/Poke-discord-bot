// ==========================================================
// utils/battle/showdown/simulate.js — simulateFull(): one fight on
// Showdown's engine, with simulateBattle()'s inputs (utils/battle/sim.js)
// and a superset of its result (showdown/result.js).
//
// sides[i] = { members, plan?, skill? }: built Team members
// (runBattle.buildTeam and the Challenge / encounter rosters), the Team's
// Battle plan (default All-out attack) and its AI skill (default Solid).
// The plan also picks each ordinary member's ability. surge is
// { side, levelMult, statMult? }. ai[i](request, battle, side) overrides
// side i's chooser (tests and tools).
// ==========================================================

import { createBattle, drive } from "./engine.js";
import { memberSet, applyCarryOver } from "./sets.js";
import { buildResult } from "./result.js";
import { readConditions } from "./conditions.js";
import { makeChooser } from "../ai/choose.js";
import { pickAbility } from "../ai/abilities.js";
import { DEFAULT_PLAN } from "../../../catalog/battlePlans.js";

// Each side's chooser gets its own seed, derived from the battle's.
const chooserFor = (side, i, seed) => makeChooser({ plan: side.plan ?? DEFAULT_PLAN, skill: side.skill ?? "solid", seed: (seed * 2 + i + 1) >>> 0 });

// `env`: the data the fight reads, the full sim's unless a caller says otherwise.
export function simulateFull({ sides, seed, surge = null, env = { FULL_SIM_ENABLED: "1" }, ai = sides.map((s, i) => chooserFor(s, i, seed)) }) {
  const initial = sides.map((s) => s.members.map((m) => (m.hpFraction === undefined ? 1 : Math.max(0, m.hpFraction))));
  const sets = sides.map((s, i) => s.members
    .map((m, slot) => memberSet(m, {
      slot,
      ability: pickAbility(m.speciesId, s.plan ?? DEFAULT_PLAN),
      env,
      ...(surge?.side === i && { levelMult: surge.levelMult, statMult: surge.statMult ?? 1 }),
    }))
    .filter(Boolean));
  // A side can start with nobody able to battle: an Elite Four run can win a
  // fight on a double knockout and reach the next one with every Pokémon fainted.
  const out = [0, 1].filter((i) => sets[i].length === 0);
  if (out.length) {
    return {
      winner: out.includes(0) ? 1 : 0, turns: 0, endedBy: "knockout", snapshots: [initial], knockouts: [], log: [],
      v: 2, steps: [], raw: [], endStatus: initial.map((s) => s.map(() => "")),
      conditions: [{ status: sides.map((s, i) => s.members.map((m, slot) => (initial[i][slot] > 0 ? m.status ?? "" : ""))), active: [null, null] }],
    };
  }
  // Status tags and stat chips (Battle FX): read before the leads come in, then after every turn.
  const sizes = initial.map((s) => s.length);
  let conditions = null;
  const b = createBattle({
    sets, seed, beforeStart: (battle) => {
      sides.forEach((s, i) => applyCarryOver(battle, i, s.members));
      conditions = [readConditions(battle, { before: true, sizes })];
    },
  });
  const { cappedAt } = drive(b, ai, { onTurn: (battle) => conditions.push(readConditions(battle, { sizes })) });
  return buildResult(b, { initial, cappedAt, conditions, names: sides.map((side) => side.members.map((m) => m.name ?? `#${m.speciesId}`)) });
}
