// ==========================================================
// analysis/held-items/itemSim.mjs — PROTOTYPE held-item battle sim (audit only).
//
// A faithful copy of the legacy loop in utils/battle/sim.js (same damage
// formula, stats, crit, roll, accuracy, multi-hit, drain/recoil/crash, AI,
// turn order, turn cap, seeded RNG) with held-item hooks added at the points
// the design proposes (HELD-ITEM-ARCHITECTURE-AUDIT.md §6). Not production
// code: it exists to measure balance before anything is built.
//
// With no items it must reproduce simulateBattle() exactly; run.mjs checks
// that on thousands of seeds before using it.
// ==========================================================

import { getSpecies, getMove, effectiveness } from "../../utils/battle/data.js";
import { computeStats } from "../../utils/battle/stats.js";
import { createRng } from "../../utils/battle/rng.js";
import { memberMoves } from "../../utils/battle/sim.js";
import { DAMAGE_ROLL_MIN, CRIT_CHANCE, HIGH_CRIT_CHANCE, CRIT_MULT, MOVE_RANDOM_CHANCE, TURN_CAP } from "../../utils/battle/tuning.js";
import fs from "fs";

const FLAGS = JSON.parse(fs.readFileSync(new URL("../../data/battle/move-flags.json", import.meta.url), "utf8")).moves;
const POKEDATA = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
const SHEDINJA = 292;
const MULTIHIT_ODDS = [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5];
export const isNFE = (id) => Array.isArray(POKEDATA[id]?.evolvesTo) && POKEDATA[id].evolvesTo.length > 0;

const TYPE_BOOSTERS = {
  charcoal: "Fire", mystic_water: "Water", miracle_seed: "Grass", magnet: "Electric", never_melt_ice: "Ice",
  black_belt: "Fighting", poison_barb: "Poison", soft_sand: "Ground", sharp_beak: "Flying", twisted_spoon: "Psychic",
  silver_powder: "Bug", hard_stone: "Rock", spell_tag: "Ghost", dragon_fang: "Dragon", black_glasses: "Dark",
  metal_coat: "Steel", silk_scarf: "Normal", fairy_feather: "Fairy",
};
const Q = (n) => n / 4096; // Showdown-style modifiers

// Prototype registry: the same hook names the design proposes.
export const ITEMS = {
  life_orb: { onFinalDamage: () => Q(5324), afterMove: (c) => c.dealt > 0 && c.hurtSelf(Math.max(1, Math.floor(c.self.maxHp / 10))) },
  choice_band: { statMult: { atk: 1.5 }, choiceLock: true },
  choice_specs: { statMult: { spa: 1.5 }, choiceLock: true },
  choice_scarf: { statMult: { spe: 1.5 }, choiceLock: true },
  assault_vest: { statMult: { spd: 1.5 } },
  eviolite: { statMult: (mon) => (isNFE(mon.speciesId) ? { def: 1.5, spd: 1.5 } : {}) },
  expert_belt: { onFinalDamage: (c) => (c.eff > 1 ? Q(4915) : 1) },
  muscle_band: { onBasePower: (c) => (c.move.category === "Physical" ? Q(4505) : 1) },
  wise_glasses: { onBasePower: (c) => (c.move.category === "Special" ? Q(4505) : 1) },
  leftovers: { residual: (c) => c.heal(Math.max(1, Math.floor(c.self.maxHp / 16))) },
  black_sludge: { residual: (c) => (c.self.types.includes("Poison") ? c.heal(Math.max(1, Math.floor(c.self.maxHp / 16))) : c.hurtSelf(Math.max(1, Math.floor(c.self.maxHp / 8)))) },
  shell_bell: { afterMove: (c) => c.dealt > 0 && c.heal(Math.max(1, Math.floor(c.dealt / 8))) },
  focus_sash: { oncePerBattle: true, onSurvive: (c) => c.hpBefore === c.self.maxHp },
  sitrus_berry: { oncePerBattle: true, afterHit: (c) => c.self.hp > 0 && c.self.hp <= c.self.maxHp / 2 && (c.heal(Math.floor(c.self.maxHp / 4)), true) },
  rocky_helmet: { onHitBy: (c) => c.contact && c.attacker.hp > 0 && c.hurtOther(c.attacker, Math.max(1, Math.floor(c.attacker.maxHp / 6))) },
  quick_claw: { quickChance: 0.2 },
  scope_lens: { critStage: 1 },
  light_ball: { statMult: (mon) => (mon.speciesId === 25 ? { atk: 2, spa: 2 } : {}) },
  thick_club: { statMult: (mon) => ([104, 105].includes(mon.speciesId) ? { atk: 2 } : {}) },
  ...Object.fromEntries(Object.entries(TYPE_BOOSTERS).map(([id, type]) => [id, { onBasePower: (c) => (c.mt === type ? Q(4915) : 1) }])),
};
export const TYPE_BOOSTER_FOR = Object.fromEntries(Object.entries(TYPE_BOOSTERS).map(([k, v]) => [v, k]));

// Crit stages on top of the bot's own base chance (1/12; high-crit moves 1/8).
// Stage +1 → 1/8, +2 → 1/2, +3 → 1 (mainline Gen 7+ ladder above the base).
const CRIT_LADDER = [CRIT_CHANCE, HIGH_CRIT_CHANCE, 0.5, 1];

export function buildMon(member, levelMult = 1) {
  const species = getSpecies(member.speciesId);
  const level = Math.min(100, Math.round(member.level * levelMult));
  const s = computeStats(species.baseStats, level);
  const maxHp = member.speciesId === SHEDINJA ? 1 : s.hp;
  const item = member.item ? ITEMS[member.item] : null;
  const mon = {
    speciesId: member.speciesId, level, types: species.types,
    atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe, maxHp, hp: maxHp,
    moves: memberMoves(member).map((id) => ({ ...getMove(id), id })),
    itemId: member.item ?? null, item, itemUsed: false, locked: null,
  };
  if (item?.statMult) {
    const mult = typeof item.statMult === "function" ? item.statMult(mon) : item.statMult;
    for (const [k, m] of Object.entries(mult)) mon[k] = Math.floor(mon[k] * m);
  }
  return mon;
}

const active = (mon) => mon.item && !(mon.item.oncePerBattle && mon.itemUsed) ? mon.item : null;
function typeMult(move, target) {
  const eff = effectiveness(move.type, target.types);
  return target.speciesId === SHEDINJA && eff <= 1 ? 0 : eff;
}
const attackStats = (move, a, t) => (move.category === "Physical" ? [a.atk, t.def] : [a.spa, t.spd]);
function powerMult(move, attacker, eff) {
  const it = active(attacker);
  return it?.onBasePower ? it.onBasePower({ move, mt: move.type, eff }) : 1;
}
function finalMult(move, attacker, eff) {
  const it = active(attacker);
  return it?.onFinalDamage ? it.onFinalDamage({ move, eff }) : 1;
}
function expectedPower(move) {
  if (move.risingPower) return move.power * (move.multihit * (move.multihit + 1)) / 2;
  if (Array.isArray(move.multihit)) return move.power * 3.1;
  return move.power * (move.multihit ?? 1);
}
function expectedDamage(move, attacker, target) {
  const [a, d] = attackStats(move, attacker, target);
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const acc = move.accuracy === true ? 1 : move.accuracy / 100;
  const eff = typeMult(move, target);
  return expectedPower(move) * stab * eff * (a / d) * acc * powerMult(move, attacker, eff) * finalMult(move, attacker, eff);
}
function chooseMove(attacker, target, rng) {
  if (attacker.locked) return attacker.locked; // Choice lock: no draw (the holder can't pick)
  const m = rng.next() < MOVE_RANDOM_CHANCE ? attacker.moves[rng.int(attacker.moves.length)]
    : attacker.moves.reduce((best, x) => (expectedDamage(x, attacker, target) > expectedDamage(best, attacker, target) ? x : best));
  if (active(attacker)?.choiceLock) attacker.locked = m;
  return m;
}
function firstToMove(mons, moves, rng, stats) {
  const [p0, p1] = moves.map((m) => m.priority ?? 0);
  if (p0 !== p1) return p0 > p1 ? 0 : 1;
  // Quick Claw: rolled only when a holder is involved (no extra draws otherwise).
  const quick = mons.map((m) => (active(m)?.quickChance ? rng.next() < active(m).quickChance : false));
  if (quick[0] !== quick[1]) { stats.quickClaw++; return quick[0] ? 0 : 1; }
  if (mons[0].spe !== mons[1].spe) return mons[0].spe > mons[1].spe ? 0 : 1;
  return rng.next() < 0.5 ? 0 : 1;
}
const hits = (move, rng) => (Array.isArray(move.multihit) ? MULTIHIT_ODDS[rng.int(MULTIHIT_ODDS.length)] : move.multihit ?? 1);

function hitDamage(power, move, attacker, target, eff, rng) {
  const [a, d] = attackStats(move, attacker, target);
  const p = Math.max(1, Math.round(power * powerMult(move, attacker, eff)));
  const base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * p * a) / d) / 50) + 2;
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const stage = Math.min(3, (move.critRatio >= 2 ? 1 : 0) + (active(attacker)?.critStage ?? 0));
  const crit = rng.next() < CRIT_LADDER[stage] ? CRIT_MULT : 1;
  const roll = DAMAGE_ROLL_MIN + rng.next() * (1 - DAMAGE_ROLL_MIN);
  return { amount: Math.max(1, Math.floor(base * stab * eff * crit * roll * finalMult(move, attacker, eff))), crit: crit > 1 };
}
const hurt = (mon, amount) => { const dealt = Math.min(mon.hp, amount); mon.hp -= dealt; return dealt; };
const healMon = (mon, amount) => { const h = Math.min(mon.maxHp - mon.hp, amount); if (mon.hp > 0) mon.hp += h; return h; };

function useMove(move, attacker, target, rng, stats) {
  const eff = typeMult(move, target);
  const lands = (m) => m.accuracy === true || rng.next() < m.accuracy / 100;
  const missed = !lands(move);
  const result = { damage: 0, crit: false, eff, missed };
  if (!missed && eff > 0) {
    const count = hits(move, rng);
    let landed = 0;
    while (landed < count && target.hp > 0 && (landed === 0 || !move.multiaccuracy || lands(move))) {
      const hit = hitDamage(move.risingPower ? move.power * (landed + 1) : move.power, move, attacker, target, eff, rng);
      const hpBefore = target.hp;
      let amount = hit.amount;
      const tIt = active(target);
      if (tIt?.onSurvive && amount >= target.hp && tIt.onSurvive({ self: target, hpBefore })) {
        amount = target.hp - 1; target.itemUsed = true; stats.sash++;
      }
      result.damage += hurt(target, amount);
      result.crit ||= hit.crit;
      landed++;
      const tIt2 = active(target);
      if (tIt2?.afterHit && tIt2.afterHit({ self: target, heal: (n) => { stats.heal += healMon(target, n); } })) { target.itemUsed = true; stats.berry++; }
      const hb = active(target);
      if (hb?.onHitBy && hb.onHitBy({ contact: !!FLAGS[move.id]?.contact, attacker, hurtOther: (m, n) => { const d = hurt(m, n); stats.helmet += d; return d > 0; } }) && hb.oncePerBattle) target.itemUsed = true;
    }
    if (move.multihit) result.hits = landed;
  }
  if (move.drain && result.damage > 0) {
    const healed = Math.min(attacker.maxHp - attacker.hp, Math.round((result.damage * move.drain[0]) / move.drain[1]));
    attacker.hp += healed;
  }
  if (move.recoil && result.damage > 0) hurt(attacker, Math.max(1, Math.round((result.damage * move.recoil[0]) / move.recoil[1])));
  if (move.crash && (missed || eff === 0)) hurt(attacker, Math.max(1, Math.floor(attacker.maxHp / 2)));
  const aIt = active(attacker);
  if (aIt?.afterMove && attacker.hp > 0) aIt.afterMove({ self: attacker, dealt: result.damage, hurtSelf: (n) => { stats.orb += hurt(attacker, n); }, heal: (n) => { stats.heal += healMon(attacker, n); } });
  return result;
}

/**
 * Same contract as simulateBattle({ sides, seed, surge }) plus per-battle
 * item counters in result.stats.
 */
export function simulateItemBattle({ sides, seed, surge }) {
  const rng = createRng(seed);
  const teams = sides.map((side, i) => side.members.map((m) => buildMon(m, surge && surge.side === i ? surge.levelMult : 1)));
  const stats = { sash: 0, berry: 0, helmet: 0, orb: 0, heal: 0, quickClaw: 0, residualHeal: 0 };
  const activeSlot = (i) => teams[i].findIndex((m) => m.hp > 0);
  let lastFaintSide = null;
  const hpFrac = (i) => teams[i].reduce((a, m) => a + m.hp / m.maxHp, 0);
  for (let turn = 1; turn <= TURN_CAP; turn++) {
    const slots = [activeSlot(0), activeSlot(1)];
    const mons = slots.map((s, i) => teams[i][s]);
    const choices = [chooseMove(mons[0], mons[1], rng), chooseMove(mons[1], mons[0], rng)];
    const first = firstToMove(mons, choices, rng, stats);
    for (const i of [first, 1 - first]) {
      const attacker = mons[i], target = mons[1 - i];
      if (attacker.hp <= 0 || target.hp <= 0) continue;
      useMove(choices[i], attacker, target, rng, stats);
      if (target.hp === 0) lastFaintSide = 1 - i;
      if (attacker.hp === 0) lastFaintSide = i;
    }
    // Residual (end of turn), faster first; only for battlers still standing.
    for (const i of [first, 1 - first]) {
      const m = mons[i];
      const it = active(m);
      if (m.hp > 0 && it?.residual) {
        it.residual({ self: m, heal: (n) => { stats.residualHeal += healMon(m, n); }, hurtSelf: (n) => { hurt(m, n); if (m.hp === 0) lastFaintSide = i; } });
      }
    }
    const out = [0, 1].filter((i) => activeSlot(i) === -1);
    if (out.length) return { winner: out.length === 2 ? lastFaintSide : 1 - out[0], turns: turn, endedBy: "knockout", stats };
  }
  return { winner: hpFrac(0) > hpFrac(1) ? 0 : 1, turns: TURN_CAP, endedBy: "turnCap", stats };
}
