// ==========================================================
// utils/battle/sim.js
// Turn-by-turn 6v6 singles sim. Pure: same inputs + seed → same result.
// Models power, type, accuracy, STAB, crits and the damage roll only —
// no abilities (except Shedinja's Wonder Guard), items, status or
// move side effects (see the battles spec).
// ==========================================================

import { getSpecies, getMove, effectiveness } from "./data.js";
import { computeStats } from "./stats.js";
import { autoMoveset } from "./moveset.js";
import { createRng } from "./rng.js";
import {
  DAMAGE_ROLL_MIN, CRIT_CHANCE, HIGH_CRIT_CHANCE, CRIT_MULT, MOVE_RANDOM_CHANCE, TURN_CAP,
} from "./tuning.js";

const SHEDINJA = 292;

function buildMon(member, statMult) {
  const species = getSpecies(member.speciesId);
  const s = computeStats(species.baseStats, member.level);
  const boost = (v) => Math.floor(v * statMult);
  const maxHp = member.speciesId === SHEDINJA ? 1 : s.hp;
  return {
    speciesId: member.speciesId,
    level: member.level,
    types: species.types,
    atk: boost(s.atk), def: boost(s.def), spa: boost(s.spa), spd: boost(s.spd), spe: boost(s.spe),
    maxHp,
    hp: maxHp,
    moves: autoMoveset(member.speciesId, member.level).map(getMove),
  };
}

// Shedinja's Wonder Guard is the one ability modeled (spec): only
// super-effective hits damage it.
function typeMult(move, target) {
  const eff = effectiveness(move.type, target.types);
  return target.speciesId === SHEDINJA && eff <= 1 ? 0 : eff;
}

function attackStats(move, attacker, target) {
  return move.category === "Physical" ? [attacker.atk, target.def] : [attacker.spa, target.spd];
}

function expectedDamage(move, attacker, target) {
  const [a, d] = attackStats(move, attacker, target);
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const acc = move.accuracy === true ? 1 : move.accuracy / 100;
  return move.power * stab * typeMult(move, target) * (a / d) * acc;
}

function chooseMove(attacker, target, rng) {
  if (rng.next() < MOVE_RANDOM_CHANCE) return attacker.moves[rng.int(attacker.moves.length)];
  return attacker.moves.reduce((best, m) =>
    expectedDamage(m, attacker, target) > expectedDamage(best, attacker, target) ? m : best);
}

function damage(move, attacker, target, rng) {
  if (move.accuracy !== true && rng.next() >= move.accuracy / 100) return 0;
  const eff = typeMult(move, target);
  if (eff === 0) return 0;
  const [a, d] = attackStats(move, attacker, target);
  const base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * move.power * a) / d) / 50) + 2;
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const crit = rng.next() < (move.critRatio >= 2 ? HIGH_CRIT_CHANCE : CRIT_CHANCE) ? CRIT_MULT : 1;
  const roll = DAMAGE_ROLL_MIN + rng.next() * (1 - DAMAGE_ROLL_MIN);
  return Math.max(1, Math.floor(base * stab * eff * crit * roll));
}

export function simulateBattle({ sides, seed, surge }) {
  const rng = createRng(seed);
  const teams = sides.map((side, i) =>
    side.members.map((m) => buildMon(m, surge && surge.side === i ? surge.statMult : 1)));
  const snapshot = () => teams.map((t) => t.map((m) => m.hp / m.maxHp));
  const activeSlot = (i) => teams[i].findIndex((m) => m.hp > 0);
  const snapshots = [snapshot()];
  const knockouts = [];

  for (let turn = 1; turn <= TURN_CAP; turn++) {
    const slots = [activeSlot(0), activeSlot(1)];
    const mons = slots.map((s, i) => teams[i][s]);
    const choices = [chooseMove(mons[0], mons[1], rng), chooseMove(mons[1], mons[0], rng)];
    const first = mons[0].spe !== mons[1].spe ? (mons[0].spe > mons[1].spe ? 0 : 1) : (rng.next() < 0.5 ? 0 : 1);

    for (const i of [first, 1 - first]) {
      const attacker = mons[i];
      const target = mons[1 - i];
      if (attacker.hp <= 0 || target.hp <= 0) continue;
      target.hp = Math.max(0, target.hp - damage(choices[i], attacker, target, rng));
      if (target.hp === 0) knockouts.push({ turn, side: 1 - i, slot: slots[1 - i], bySide: i, bySlot: slots[i] });
    }

    snapshots.push(snapshot());
    const out = [0, 1].find((i) => activeSlot(i) === -1);
    if (out !== undefined) return { winner: 1 - out, turns: turn, endedBy: "knockout", snapshots, knockouts };
  }

  // Turn cap: more total HP fraction wins; an exact tie goes to the Defender (side 1).
  const total = (i) => snapshots.at(-1)[i].reduce((a, b) => a + b, 0);
  return { winner: total(0) > total(1) ? 0 : 1, turns: TURN_CAP, endedBy: "turnCap", snapshots, knockouts };
}
