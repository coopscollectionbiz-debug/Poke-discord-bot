// ==========================================================
// utils/battle/sim.js
// Turn-by-turn 6v6 singles sim. Pure: same inputs + seed → same result.
// Models power, type, accuracy, STAB, crits, the damage roll, priority,
// multi-hit, drain, recoil and crash damage. No abilities (except Shedinja's
// Wonder Guard), items, status, stat changes or other move side effects
// (see the battles spec).
// ==========================================================

import { getSpecies, getMove, effectiveness } from "./data.js";
import { computeStats } from "./stats.js";
import { autoMoveset } from "./moveset.js";
import { createRng } from "./rng.js";
import {
  DAMAGE_ROLL_MIN, CRIT_CHANCE, HIGH_CRIT_CHANCE, CRIT_MULT, MOVE_RANDOM_CHANCE, TURN_CAP,
} from "./tuning.js";

const SHEDINJA = 292;
// Gen 5 odds for a 2-5 hit move: 2 or 3 hits 35% each, 4 or 5 hits 15% each.
const MULTIHIT_ODDS = [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5];

// member.statMult raises every stat, HP included, without changing the
// Level: challenge opponents fight with CHALLENGE.statBoost.
export function buildMon(member, levelMult = 1) {
  const species = getSpecies(member.speciesId);
  const level = Math.min(100, Math.round(member.level * levelMult));
  const k = member.statMult ?? 1;
  const s = Object.fromEntries(Object.entries(computeStats(species.baseStats, level)).map(([stat, v]) => [stat, Math.round(v * k)]));
  const maxHp = member.speciesId === SHEDINJA ? 1 : s.hp;
  return {
    speciesId: member.speciesId,
    level,
    types: species.types,
    atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe,
    maxHp,
    // hpFraction carries damage between Elite Four fights: absent is full HP,
    // 0 is fainted, and any sliver above 0 keeps at least 1 HP.
    hp: member.hpFraction === undefined ? maxHp
      : member.hpFraction <= 0 ? 0
      : Math.max(1, Math.round(maxHp * member.hpFraction)),
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

// Total power if every hit lands: Bullet Seed averages 3.1 hits, Triple Kick 10 + 20 + 30.
function expectedPower(move) {
  if (move.risingPower) return move.power * (move.multihit * (move.multihit + 1)) / 2;
  if (Array.isArray(move.multihit)) return move.power * 3.1;
  return move.power * (move.multihit ?? 1);
}

function expectedDamage(move, attacker, target) {
  const [a, d] = attackStats(move, attacker, target);
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const acc = move.accuracy === true ? 1 : move.accuracy / 100;
  return expectedPower(move) * stab * typeMult(move, target) * (a / d) * acc;
}

function chooseMove(attacker, target, rng) {
  if (rng.next() < MOVE_RANDOM_CHANCE) return attacker.moves[rng.int(attacker.moves.length)];
  return attacker.moves.reduce((best, m) =>
    expectedDamage(m, attacker, target) > expectedDamage(best, attacker, target) ? m : best);
}

// Which side acts first: higher move priority, then higher Speed, then a coin flip.
export function firstToMove(mons, moves, rng) {
  const [p0, p1] = moves.map((m) => m.priority ?? 0);
  if (p0 !== p1) return p0 > p1 ? 0 : 1;
  if (mons[0].spe !== mons[1].spe) return mons[0].spe > mons[1].spe ? 0 : 1;
  return rng.next() < 0.5 ? 0 : 1;
}

const hits = (move, rng) => (Array.isArray(move.multihit) ? MULTIHIT_ODDS[rng.int(MULTIHIT_ODDS.length)] : move.multihit ?? 1);

// One hit's damage, with its own crit and damage roll.
function hitDamage(power, move, attacker, target, eff, rng) {
  const [a, d] = attackStats(move, attacker, target);
  const base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * a) / d) / 50) + 2;
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const crit = rng.next() < (move.critRatio >= 2 ? HIGH_CRIT_CHANCE : CRIT_CHANCE) ? CRIT_MULT : 1;
  const roll = DAMAGE_ROLL_MIN + rng.next() * (1 - DAMAGE_ROLL_MIN);
  return { amount: Math.max(1, Math.floor(base * stab * eff * crit * roll)), crit: crit > 1 };
}

const hurt = (mon, amount) => {
  const dealt = Math.min(mon.hp, amount);
  mon.hp -= dealt;
  return dealt;
};

// One move, start to finish: its hits, then drain, recoil or crash damage,
// following Gen 5 (Pokémon Showdown). Changes both Pokémon's HP and returns
// what playback narrates. damage is what the target actually lost.
export function useMove(move, attacker, target, rng) {
  const eff = typeMult(move, target);
  const lands = (m) => m.accuracy === true || rng.next() < m.accuracy / 100;
  const missed = !lands(move);
  const result = { damage: 0, crit: false, eff, missed };
  if (!missed && eff > 0) {
    const count = hits(move, rng);
    let landed = 0;
    while (landed < count && target.hp > 0 && (landed === 0 || !move.multiaccuracy || lands(move))) {
      const hit = hitDamage(move.risingPower ? move.power * (landed + 1) : move.power, move, attacker, target, eff, rng);
      result.damage += hurt(target, hit.amount);
      result.crit ||= hit.crit;
      landed++;
    }
    if (move.multihit) result.hits = landed;
  }
  if (move.drain && result.damage > 0) {
    const healed = Math.min(attacker.maxHp - attacker.hp, Math.round((result.damage * move.drain[0]) / move.drain[1]));
    attacker.hp += healed;
    if (healed > 0) result.drain = healed;
  }
  if (move.recoil && result.damage > 0) result.recoil = hurt(attacker, Math.max(1, Math.round((result.damage * move.recoil[0]) / move.recoil[1])));
  if (move.crash && (missed || eff === 0)) result.crash = hurt(attacker, Math.max(1, Math.floor(attacker.maxHp / 2)));
  return result;
}

export function simulateBattle({ sides, seed, surge }) {
  const rng = createRng(seed);
  const teams = sides.map((side, i) =>
    side.members.map((m) => buildMon(m, surge && surge.side === i ? surge.levelMult : 1)));
  const snapshot = () => teams.map((t) => t.map((m) => m.hp / m.maxHp));
  const activeSlot = (i) => teams[i].findIndex((m) => m.hp > 0);
  const snapshots = [snapshot()];
  const knockouts = [];
  const log = []; // per turn, the hits in order
  let lastFaintSide = null;

  // A side can start with nobody able to battle: an Elite Four run can win a
  // fight on a double knockout and reach the next one with every Pokémon fainted.
  const outAtStart = [0, 1].filter((i) => activeSlot(i) === -1);
  if (outAtStart.length) return { winner: outAtStart.includes(0) ? 1 : 0, turns: 0, endedBy: "knockout", snapshots, knockouts, log };

  for (let turn = 1; turn <= TURN_CAP; turn++) {
    const slots = [activeSlot(0), activeSlot(1)];
    const mons = slots.map((s, i) => teams[i][s]);
    const choices = [chooseMove(mons[0], mons[1], rng), chooseMove(mons[1], mons[0], rng)];
    const first = firstToMove(mons, choices, rng);

    const events = [];
    for (const i of [first, 1 - first]) {
      const attacker = mons[i];
      const target = mons[1 - i];
      if (attacker.hp <= 0 || target.hp <= 0) continue;
      const userHp = attacker.hp;
      const hit = useMove(choices[i], attacker, target, rng);
      events.push({
        side: i, slot: slots[i], targetSlot: slots[1 - i], move: choices[i].name, ...hit,
        hpAfter: target.hp / target.maxHp, fainted: target.hp === 0,
        ...(attacker.hp !== userHp && { userHpAfter: attacker.hp / attacker.maxHp, userFainted: attacker.hp === 0 }),
      });
      if (target.hp === 0) {
        knockouts.push({ turn, side: 1 - i, slot: slots[1 - i], bySide: i, bySlot: slots[i] });
        lastFaintSide = 1 - i;
      }
      // A Pokémon that faints from its own recoil or crash is knocked out by the one it attacked.
      if (attacker.hp === 0) {
        knockouts.push({ turn, side: i, slot: slots[i], bySide: 1 - i, bySlot: slots[1 - i] });
        lastFaintSide = i;
      }
    }

    log.push(events);
    snapshots.push(snapshot());
    const out = [0, 1].filter((i) => activeSlot(i) === -1);
    // Gen 5: if both sides run out in one move (a recoil KO), the side whose Pokémon fainted last wins.
    if (out.length) return { winner: out.length === 2 ? lastFaintSide : 1 - out[0], turns: turn, endedBy: "knockout", snapshots, knockouts, log };
  }

  // Turn cap: more total HP fraction wins; an exact tie goes to the Defender (side 1).
  const total = (i) => snapshots.at(-1)[i].reduce((a, b) => a + b, 0);
  return { winner: total(0) > total(1) ? 0 : 1, turns: TURN_CAP, endedBy: "turnCap", snapshots, knockouts, log };
}
