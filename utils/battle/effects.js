// ==========================================================
// utils/battle/effects.js — the effect-aware battle engine (Mega M2).
//
// Used ONLY for battles in which some battler has an ability (today: a
// Mega Evolution). simulateBattle() in sim.js keeps its legacy loop for
// every other battle, so ordinary battles can't change (proven by the
// pre-M2 corpus test). This engine is the legacy model plus:
//   • abilities (utils/battle/abilities.js) at fixed hook points
//   • stat stages (−6…+6; accuracy/evasion supported)
//   • weather (sun, rain, sand, snow, strong winds) with 5-turn duration
//   • terrain (Electric Terrain) with 5-turn duration
//   • burn (the one status any implemented ability can cause)
//   • entry effects (battle start and replacements) and end-of-turn effects
// Same inputs + seed → same result. Every random draw comes from `rng`.
// ==========================================================

import { getMove, effectiveness } from "./data.js";
import { getAbility } from "./abilities.js";
import {
  DAMAGE_ROLL_MIN, CRIT_CHANCE, HIGH_CRIT_CHANCE, CRIT_MULT, MOVE_RANDOM_CHANCE, TURN_CAP,
} from "./tuning.js";
import fs from "fs";

const FLAGS = JSON.parse(fs.readFileSync(new URL("../../data/battle/move-flags.json", import.meta.url), "utf8")).moves;
const MULTIHIT_ODDS = [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5];
const STATS = ["atk", "def", "spa", "spd", "spe"];
const STAT_NAME = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };
export const WEATHER_TURNS = 5;
export const TERRAIN_TURNS = 5;
const WEATHER_TEXT = {
  sun: ["The sunlight turned harsh!", "The harsh sunlight faded."],
  rain: ["It started to rain!", "The rain stopped."],
  sand: ["A sandstorm kicked up!", "The sandstorm subsided."],
  snow: ["It started to snow!", "The snow stopped."],
  winds: ["Mysterious strong winds are protecting Flying-type Pokémon!", "The mysterious strong winds have dissipated!"],
};

/** Stage multiplier: atk…spe (2+n)/2 or 2/(2−n); accuracy/evasion (3+n)/3 or 3/(3−n). */
export function stageMult(stage, accuracyLike = false) {
  const b = accuracyLike ? 3 : 2;
  return stage >= 0 ? (b + stage) / b : b / (b - stage);
}

/** The move with its flags (from data/battle/move-flags.json). */
export const withFlags = (move, id) => ({ ...move, flags: FLAGS[id] ?? {} });

// ----------------------------------------------------------
// Field: weather, terrain, stat changes, status, HP effects, notes.
// ----------------------------------------------------------
export function createField(rng) {
  const fx = {
    rng,
    weather: null, // { kind, turns, source }
    terrain: null, // { kind, turns }
    notes: [],     // notes for the current phase (flushed into the log)
    active: [null, null],
    note(text) { if (text) this.notes.push(text); },
    abilityOf(mon, { ignoreBreakable = false } = {}) {
      const a = getAbility(mon?.ability);
      if (!a || a.status !== "implemented") return null;
      if (ignoreBreakable && a.breakable) return null;
      return a;
    },
    hasAbility(mon, pred) { const a = this.abilityOf(mon); return !!a && pred(a); },
    weatherIs(kind) { return this.weather?.kind === kind; },
    setWeather(kind, source) {
      if (this.weather?.kind === kind) return;
      if (this.weather?.kind === "winds" && kind !== "winds") return; // strong winds can't be replaced
      this.weather = { kind, turns: kind === "winds" ? Infinity : WEATHER_TURNS, source };
      this.note(`${source.name}'s ${source.ability}: ${WEATHER_TEXT[kind][0]}`);
    },
    setTerrain(kind, source) {
      if (this.terrain?.kind === kind) return;
      this.terrain = { kind, turns: TERRAIN_TURNS, source };
      this.note(`${source.name}'s ${source.ability}: An electric current ran across the battlefield!`);
    },
    stat(mon, s) { return Math.floor(mon[s] * stageMult(mon.stages[s])); },
    boost(mon, changes, source, cause) {
      if (mon.hp <= 0) return;
      const invert = this.hasAbility(mon, (a) => a.invertsBoosts);
      for (const [s, raw] of Object.entries(changes)) {
        const d = invert ? -raw : raw;
        const next = Math.max(-6, Math.min(6, mon.stages[s] + d));
        const actual = next - mon.stages[s];
        if (!actual) { this.note(`${mon.name}'s ${STAT_NAME[s]} won't go any ${d > 0 ? "higher" : "lower"}!`); continue; }
        mon.stages[s] = next;
        const size = Math.abs(actual) >= 2 ? (actual > 0 ? " sharply" : " harshly") : "";
        this.note(`${cause ? `${(source ?? mon).name}'s ${cause}: ` : ""}${mon.name}'s ${STAT_NAME[s]}${size} ${actual > 0 ? "rose" : "fell"}!`);
        if (actual < 0 && source && source !== mon) {
          const a = this.abilityOf(mon);
          a?.onFoeLoweredStat?.({ fx: this, self: mon, note: (t) => this.note(t) });
        }
      }
    },
    setStatus(mon, status, source, text) {
      if (mon.hp <= 0 || mon.status) return false;
      if (status === "brn" && mon.types.includes("Fire")) return false;
      if (this.hasAbility(mon, (a) => a.statusImmune?.includes(status))) return false;
      mon.status = status;
      this.note(text);
      return true;
    },
    heal(mon, fraction, text) {
      const amount = Math.min(mon.maxHp - mon.hp, Math.floor(mon.maxHp / fraction));
      if (amount > 0) { mon.hp += amount; this.note(text); }
    },
    // Damage outside a move (weather, burn, Solar Power, Innards Out).
    damage(mon, amount, text, cause) {
      if (mon.hp <= 0 || amount <= 0) return 0;
      const dealt = Math.min(mon.hp, Math.max(1, Math.floor(amount)));
      mon.hp -= dealt;
      this.note(text);
      if (mon.hp === 0) this.fainted.push({ mon, by: cause ?? null });
      return dealt;
    },
    chip(mon, denom, text) { return this.damage(mon, mon.maxHp / denom, text); },
    fainted: [],
  };
  return fx;
}

const isGrounded = (fx, mon) => !mon.types.includes("Flying") && fx.abilityOf(mon)?.grounded !== false;

// ----------------------------------------------------------
// Move pipeline
// ----------------------------------------------------------
function moveTypeFor(fx, move, attacker) {
  const a = fx.abilityOf(attacker);
  const t = a?.onModifyType?.({ fx, move, attacker });
  return t ? { type: t.type, mult: t.mult } : { type: move.type, mult: 1 };
}

/** Type effectiveness with Scrappy, strong winds and abilities that grant immunity. */
function typeEff(fx, mt, attacker, target) {
  const scrappy = fx.abilityOf(attacker)?.ignoresGhostImmunity?.includes(mt);
  const types = scrappy ? target.types.filter((t) => t !== "Ghost") : target.types;
  let eff = types.length ? effectiveness(mt, types) : 1;
  if (fx.weatherIs("winds") && target.types.includes("Flying") && effectiveness(mt, ["Flying"]) > 1) eff /= effectiveness(mt, ["Flying"]);
  return eff;
}

function weatherDamageMult(fx, mt, attacker) {
  const own = fx.abilityOf(attacker)?.ownWeather;
  const w = own ?? fx.weather?.kind;
  if (w === "sun") return mt === "Fire" ? 1.5 : mt === "Water" ? 0.5 : 1;
  if (w === "rain") return mt === "Water" ? 1.5 : mt === "Fire" ? 0.5 : 1;
  return 1;
}

function auraMult(fx, mt) {
  const on = fx.active.filter((m) => m && m.hp > 0);
  const aura = on.some((m) => fx.abilityOf(m)?.aura === mt);
  if (!aura) return 1;
  return on.some((m) => fx.abilityOf(m)?.auraBreak) ? 0.75 : 4 / 3;
}

/**
 * Everything about one attacker → target move that doesn't need random
 * numbers: type, effectiveness, power, attacking/defending stats, modifiers.
 */
export function prepareMove(fx, move, attacker, target) {
  const breaker = !!fx.abilityOf(attacker)?.moldBreaker;
  const tAbility = fx.abilityOf(target, { ignoreBreakable: breaker });
  const aAbility = fx.abilityOf(attacker);
  const { type: mt, mult: typeMult } = moveTypeFor(fx, move, attacker);
  const eff = typeEff(fx, mt, attacker, target);
  const c = { fx, move, mt, attacker, target, eff, power: move.power };
  let power = move.power * typeMult;
  power *= aAbility?.onBasePower?.(c) ?? 1;
  power *= auraMult(fx, mt);
  if (fx.terrain?.kind === "electric" && mt === "Electric" && isGrounded(fx, attacker)) power *= 1.3;
  const physical = move.category === "Physical";
  const [as, ds] = physical ? ["atk", "def"] : ["spa", "spd"];
  let atkMult = aAbility?.onModifyAtk?.(c) ?? 1;
  atkMult *= tAbility?.onSourceModifyAtk?.(c) ?? 1;
  let defMult = 1;
  if (fx.weatherIs("sand") && !physical && target.types.includes("Rock")) defMult *= 1.5;
  if (fx.weatherIs("snow") && physical && target.types.includes("Ice")) defMult *= 1.5;
  const stab = attacker.types.includes(mt) ? (aAbility?.stab?.(c) ?? 1.5) : 1;
  const noGuard = !!aAbility?.noGuard || !!fx.abilityOf(target)?.noGuard;
  return { mt, eff, power: Math.max(1, Math.round(power)), physical, as, ds, atkMult, defMult, stab, tAbility, aAbility, breaker, noGuard, c };
}

function attackDefense(fx, p, attacker, target, crit) {
  const aStage = crit ? Math.max(0, attacker.stages[p.as]) : attacker.stages[p.as];
  const dStage = crit ? Math.min(0, target.stages[p.ds]) : target.stages[p.ds];
  const a = Math.max(1, Math.floor(attacker[p.as] * stageMult(aStage) * p.atkMult));
  const d = Math.max(1, Math.floor(target[p.ds] * stageMult(dStage) * p.defMult));
  return [a, d];
}

function finalMult(fx, p, attacker, target, crit) {
  let m = weatherDamageMult(fx, p.mt, attacker);
  if (attacker.status === "brn" && p.physical) m *= 0.5;
  m *= p.tAbility?.onFinalDamage?.({ ...p.c, eff: p.eff, crit }) ?? 1;
  return m;
}

function oneHit(fx, p, power, attacker, target, rng, { critImmune, extra = 1 }) {
  const crit = !critImmune && rng.next() < (p.c.move.critRatio >= 2 ? HIGH_CRIT_CHANCE : CRIT_CHANCE);
  const [a, d] = attackDefense(fx, p, attacker, target, crit);
  const base = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * a) / d) / 50) + 2;
  const roll = DAMAGE_ROLL_MIN + rng.next() * (1 - DAMAGE_ROLL_MIN);
  const amount = Math.max(1, Math.floor(base * p.stab * p.eff * (crit ? CRIT_MULT : 1) * roll * finalMult(fx, p, attacker, target, crit) * extra));
  return { amount, crit };
}

/** Expected damage (move AI): no crit, average roll, hit chance. */
export function expectedDamageFx(fx, move, attacker, target) {
  const p = prepareMove(fx, move, attacker, target);
  if (p.eff === 0) return 0;
  const imm = p.tAbility?.onTryHit?.({ ...p.c, note() {}, fx: { ...fx, note() {}, heal() {}, boost() {} }, target: { ...target } });
  if (imm?.immune) return 0;
  const multi = p.aAbility?.multihit;
  const hits = move.risingPower ? (move.multihit * (move.multihit + 1)) / 2
    : Array.isArray(move.multihit) ? (multi === "max" ? move.multihit[1] : 3.1)
    : move.multihit ?? (multi === "parental" ? 1.25 : 1);
  const acc = move.accuracy === true || p.noGuard ? 1 : Math.min(1, (move.accuracy / 100) * stageMult(attacker.stages.accuracy - target.stages.evasion, true));
  const [a, d] = attackDefense(fx, p, attacker, target, false);
  return p.power * hits * p.stab * p.eff * (a / d) * acc * finalMult(fx, p, attacker, target, false);
}

const hurt = (mon, amount) => {
  const dealt = Math.min(mon.hp, amount);
  mon.hp -= dealt;
  return dealt;
};

/**
 * One move with abilities, stages, weather and status. Returns the same
 * event fields as the legacy useMove plus `notes` when something triggered.
 */
export function useMoveFx(fx, move, attacker, target, rng) {
  const notesBefore = fx.notes.length;
  const note = (t) => fx.note(t);
  fx.abilityOf(attacker)?.onBeforeMove?.({ fx, attacker, move, mt: moveTypeFor(fx, move, attacker).type, note });
  const p = prepareMove(fx, move, attacker, target);
  const lands = (m) => m.accuracy === true || p.noGuard || rng.next() < Math.min(1, (m.accuracy / 100) * stageMult(attacker.stages.accuracy - target.stages.evasion, true));
  const missed = !lands(move);
  const result = { damage: 0, crit: false, eff: p.eff, missed };
  let immune = p.eff === 0;
  if (!missed && !immune && p.tAbility?.onTryHit) {
    const r = p.tAbility.onTryHit({ ...p.c, note });
    if (r?.immune) {
      immune = true;
      result.eff = 0;
      result.absorbed = true;
      if (!r.silent) note(`${target.name}'s ${target.ability} made it immune!`);
    }
  }
  if (!missed && !immune) {
    const multi = p.aAbility?.multihit;
    const critImmune = !!p.tAbility?.critImmune;
    let count;
    if (Array.isArray(move.multihit)) count = multi === "max" ? move.multihit[1] : MULTIHIT_ODDS[rng.int(MULTIHIT_ODDS.length)];
    else count = move.multihit ?? (multi === "parental" ? 2 : 1);
    const parental = !move.multihit && multi === "parental";
    let landed = 0;
    while (landed < count && target.hp > 0 && (landed === 0 || !move.multiaccuracy || multi === "max" || lands(move))) {
      const basePower = move.risingPower ? move.power * (landed + 1) : move.power;
      const pw = move.risingPower ? prepareMove(fx, { ...move, power: basePower }, attacker, target).power : p.power;
      // Parental Bond: the second strike deals 0.25× damage (Gen 7+).
      const hit = oneHit(fx, p, pw, attacker, target, rng, { critImmune, extra: parental && landed === 1 ? 0.25 : 1 });
      const hpBefore = target.hp;
      const dealt = hurt(target, hit.amount);
      result.damage += dealt;
      result.crit ||= hit.crit;
      landed++;
      const hc = { ...p.c, note, rng, damage: dealt, hpBefore };
      if (target.hp === 0) {
        p.tAbility?.onFaintedBy?.({ ...hc, target, attacker });
        break;
      }
      p.tAbility?.onDamagingHit?.(hc); // Mold Breaker suppresses breakable on-hit abilities
    }
    if (move.multihit || parental) result.hits = landed;
  }
  if (move.drain && result.damage > 0) {
    const healed = Math.min(attacker.maxHp - attacker.hp, Math.round((result.damage * move.drain[0]) / move.drain[1]));
    attacker.hp += healed;
    if (healed > 0) result.drain = healed;
  }
  if (move.recoil && result.damage > 0 && attacker.hp > 0) result.recoil = hurt(attacker, Math.max(1, Math.round((result.damage * move.recoil[0]) / move.recoil[1])));
  if (move.crash && (missed || immune)) result.crash = hurt(attacker, Math.max(1, Math.floor(attacker.maxHp / 2)));
  if (fx.notes.length > notesBefore) result.notes = fx.notes.splice(notesBefore);
  return result;
}

// ----------------------------------------------------------
// Turn order, entry and end-of-turn
// ----------------------------------------------------------
export function speedOf(fx, mon) {
  let s = fx.stat(mon, "spe");
  s = Math.floor(s * (fx.abilityOf(mon)?.onModifySpe?.({ fx, self: mon }) ?? 1));
  return s;
}

export function firstToMoveFx(fx, mons, moves, rng) {
  const [p0, p1] = moves.map((m) => m.priority ?? 0);
  if (p0 !== p1) return p0 > p1 ? 0 : 1;
  const [s0, s1] = mons.map((m) => speedOf(fx, m));
  if (s0 !== s1) return s0 > s1 ? 0 : 1;
  return rng.next() < 0.5 ? 0 : 1;
}

export function chooseMoveFx(fx, attacker, target, rng) {
  if (rng.next() < MOVE_RANDOM_CHANCE) return attacker.moves[rng.int(attacker.moves.length)];
  return attacker.moves.reduce((best, m) => (expectedDamageFx(fx, m, attacker, target) > expectedDamageFx(fx, best, attacker, target) ? m : best));
}

/** Entry effects for battlers that just came in, faster first (ties: side 0). */
export function runEntries(fx, entering) {
  const order = [...entering].sort((a, b) => speedOf(fx, b.mon) - speedOf(fx, a.mon) || a.side - b.side);
  for (const { mon, side } of order) {
    mon.enteredThisTurn = true;
    mon.proteanUsed = false;
    const foe = fx.active[1 - side];
    fx.abilityOf(mon)?.onEntry?.({ fx, self: mon, foe, note: (t) => fx.note(t), rng: fx.rng });
  }
}

/** End of turn: weather chip, Solar Power, burn, Speed Boost, then durations. */
export function runResidual(fx) {
  const alive = () => fx.active.filter((m) => m && m.hp > 0);
  if (fx.weatherIs("sand")) {
    for (const m of alive()) {
      if (m.types.some((t) => ["Rock", "Ground", "Steel"].includes(t)) || fx.hasAbility(m, (a) => a.weatherImmune?.includes("sand"))) continue;
      fx.chip(m, 16, `${m.name} is buffeted by the sandstorm!`);
    }
  }
  for (const m of alive()) fx.abilityOf(m)?.onResidual?.({ fx, self: m, note: (t) => fx.note(t) });
  for (const m of alive()) if (m.status === "brn") fx.chip(m, 16, `${m.name} was hurt by its burn!`);
  if (fx.weather && fx.weather.turns !== Infinity && --fx.weather.turns <= 0) { fx.note(WEATHER_TEXT[fx.weather.kind][1]); fx.weather = null; }
  if (fx.weather?.kind === "winds" && !(fx.weather.source.hp > 0)) { fx.note(WEATHER_TEXT.winds[1]); fx.weather = null; }
  if (fx.terrain && --fx.terrain.turns <= 0) { fx.note("The electricity disappeared from the battlefield."); fx.terrain = null; }
  for (const m of fx.active) if (m) m.enteredThisTurn = false;
}

/** A battler fainted: Soul-Heart and similar "any faint" reactions. */
export function onAnyFaint(fx, fainted) {
  for (const m of fx.active) if (m && m !== fainted && m.hp > 0) fx.abilityOf(m)?.onAnyFaint?.({ fx, self: m, note: (t) => fx.note(t) });
}

// ----------------------------------------------------------
// The battle loop for battles with effects (mirrors sim.js's legacy loop)
// ----------------------------------------------------------
export function prepareBattler(mon, moveIds, name) {
  mon.ability ??= null;
  mon.types = [...mon.types];
  mon.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
  mon.status = null;
  mon.flashFire = false;
  mon.moves = moveIds.map((id) => withFlags(getMove(id), id));
  mon.name ??= name ?? `#${mon.speciesId}`;
  return mon;
}

export function simulateBattleFx({ teams, rng }) {
  const fx = createField(rng);
  const snapshot = () => teams.map((t) => t.map((m) => m.hp / m.maxHp));
  const activeSlot = (i) => teams[i].findIndex((m) => m.hp > 0);
  const snapshots = [snapshot()];
  const knockouts = [];
  const log = [];
  const turnNotes = [];
  let lastFaintSide = null;
  const seen = [-1, -1];
  // A side can start with everyone fainted (an Elite Four fight after a win
  // in which the player's last Pokémon fainted too, with no Revive). It loses
  // at turn 0, as in sim.js's legacy loop.
  const outAtStart = [0, 1].filter((i) => activeSlot(i) === -1);
  if (outAtStart.length) return { winner: outAtStart.includes(0) ? 1 : 0, turns: 0, endedBy: "knockout", snapshots, knockouts, log, turnNotes };

  const recordFaints = (turn, slots, byMove) => {
    for (const { mon, by } of fx.fainted.splice(0)) {
      const side = teams[0].includes(mon) ? 0 : 1;
      const slot = teams[side].indexOf(mon);
      if (knockouts.some((k) => k.side === side && k.slot === slot)) continue;
      knockouts.push({ turn, side, slot, bySide: 1 - side, bySlot: slots[1 - side] });
      lastFaintSide = side;
      fx.note(`${mon.name} fainted!`);
      onAnyFaint(fx, mon);
      void by; void byMove;
    }
  };

  for (let turn = 1; turn <= TURN_CAP; turn++) {
    const slots = [activeSlot(0), activeSlot(1)];
    const mons = slots.map((s, i) => teams[i][s]);
    fx.active = mons;
    const entering = [0, 1].filter((i) => seen[i] !== slots[i]).map((i) => ({ mon: mons[i], side: i }));
    [0, 1].forEach((i) => { seen[i] = slots[i]; });
    if (entering.length) runEntries(fx, entering);
    const start = fx.notes.splice(0);

    const choices = [chooseMoveFx(fx, mons[0], mons[1], rng), chooseMoveFx(fx, mons[1], mons[0], rng)];
    const first = firstToMoveFx(fx, mons, choices, rng);
    const events = [];
    for (const i of [first, 1 - first]) {
      const attacker = mons[i];
      const target = mons[1 - i];
      if (attacker.hp <= 0 || target.hp <= 0) continue;
      const userHp = attacker.hp;
      const foeHpBefore = target.hp;
      const hit = useMoveFx(fx, choices[i], attacker, target, rng);
      const ev = {
        side: i, slot: slots[i], targetSlot: slots[1 - i], move: choices[i].name, ...hit,
        hpAfter: target.hp / target.maxHp, fainted: target.hp === 0,
        ...(attacker.hp !== userHp && { userHpAfter: attacker.hp / attacker.maxHp, userFainted: attacker.hp === 0 }),
      };
      events.push(ev);
      if (target.hp === 0 && foeHpBefore > 0) {
        knockouts.push({ turn, side: 1 - i, slot: slots[1 - i], bySide: i, bySlot: slots[i] });
        lastFaintSide = 1 - i;
        fx.abilityOf(attacker)?.onSourceKO?.({ fx, self: attacker, note: (t) => fx.note(t) });
        onAnyFaint(fx, target);
      }
      if (attacker.hp === 0) {
        knockouts.push({ turn, side: i, slot: slots[i], bySide: 1 - i, bySlot: slots[1 - i] });
        lastFaintSide = i;
        onAnyFaint(fx, attacker);
      }
      recordFaints(turn, slots);
      if (fx.notes.length) ev.notes = [...(ev.notes ?? []), ...fx.notes.splice(0)];
    }
    runResidual(fx);
    recordFaints(turn, slots);
    const end = fx.notes.splice(0);
    if (events.length) {
      if (start.length) events[0].preNotes = start;
      if (end.length) events.at(-1).endNotes = end;
    }
    turnNotes.push({ start, end });
    log.push(events);
    snapshots.push(snapshot());
    const out = [0, 1].filter((i) => activeSlot(i) === -1);
    if (out.length) return { winner: out.length === 2 ? lastFaintSide : 1 - out[0], turns: turn, endedBy: "knockout", snapshots, knockouts, log, turnNotes };
  }
  const total = (i) => snapshots.at(-1)[i].reduce((a, b) => a + b, 0);
  return { winner: total(0) > total(1) ? 0 : 1, turns: TURN_CAP, endedBy: "turnCap", snapshots, knockouts, log, turnNotes };
}
