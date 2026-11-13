// ==========================================================
// utils/battle/showdown/engine.js — Pokémon Showdown's engine, driven
// synchronously (full-sim spec, docs/superpowers/specs/2026-11-12-full-sim-design.md).
//
// createBattle() builds a seeded Custom Game battle with our engine
// overrides installed; drive() plays it to the end (or the turn cap) by
// asking each side's chooser for a choice whenever the engine wants one.
// Every Pokémon's nickname is `s<slot>`, its Team slot: Showdown reorders
// side.pokemon on every switch, so the nickname is how the slot survives.
//
// The overrides are instance patches on the pinned @pkmn/sim 0.10.12, each
// covered by tests/fullSimEngine.test.js so an upgrade can't change one
// silently:
//   • statModify: set.statMult raises every stat, HP included (Challenge
//     opponents, the cute surge), rounded like utils/battle/sim.js.
//   • randomizer / randomChance / getDamage: our swingier odds (tuning.js):
//     damage roll 80–100% (Showdown 85–100%), crits 1 in 12 at stage 0
//     (Showdown 1 in 24; its 1 in 8 at stage 1 already matches ours), crit
//     damage ×2 (Showdown ×1.5).
// ==========================================================

import { Battle } from "@pkmn/sim";
import { TURN_CAP, DAMAGE_ROLL_MIN, CRIT_CHANCE, CRIT_MULT } from "../tuning.js";

/** Custom Game: no legality checks (any Level, move, ability or item), no team preview. */
export const FORMAT = "gen9customgame@@@!teampreview";

/** Our numeric seed as Showdown's four-part PRNG seed. */
export const seedFor = (n) => [n & 0xffff, (n >>> 16) & 0xffff, 0x1234, 0x5678];

const ROLL_MIN = Math.round(DAMAGE_ROLL_MIN * 100);
const CRIT_DENOMINATOR = Math.round(1 / CRIT_CHANCE);

export function installOverrides(b) {
  const statModify = b.statModify.bind(b);
  b.statModify = (base, set, stat) => {
    const v = statModify(base, set, stat);
    return set.statMult ? Math.round(v * set.statMult) : v;
  };
  b.randomizer = (base) => Math.trunc((base * (ROLL_MIN + b.random(101 - ROLL_MIN))) / 100);
  // The crit roll is the engine's only randomChance(1, 24) call (stage 0 in Gen 9).
  const randomChance = b.randomChance.bind(b);
  b.randomChance = (n, d) => randomChance(n, n === 1 && d === 24 ? CRIT_DENOMINATOR : d);
  // The active move is a per-use copy, so setting its crit multiplier here is safe.
  const getDamage = b.actions.getDamage.bind(b.actions);
  b.actions.getDamage = (source, target, move, ...rest) => {
    if (move && typeof move === "object") move.critModifier ??= CRIT_MULT;
    return getDamage(source, target, move, ...rest);
  };
}

/**
 * A battle between two lists of Showdown sets (each named `s<slot>`, plus
 * an optional statMult). beforeStart(b) runs after both sides exist and
 * before the first switch-in is logged, for HP and status carried over.
 */
export function createBattle({ sets, seed, beforeStart }) {
  const b = new Battle({ formatid: FORMAT, seed: seedFor(seed) });
  installOverrides(b);
  // setPlayer starts the battle once both sides exist; hold that off so
  // beforeStart can change Pokémon before anything is logged.
  b.start = () => {};
  b.setPlayer("p1", { name: "p1", team: sets[0] });
  b.setPlayer("p2", { name: "p2", team: sets[1] });
  delete b.start;
  beforeStart?.(b);
  b.start();
  return b;
}

/**
 * The battle log as a spectator sees it. Showdown writes `|split|pN`, then
 * the exact-HP line for that player, then the public line; this keeps only
 * the public one and drops the `|t:|` timestamps.
 */
export function publicLog(b) {
  const out = [];
  for (let i = 0; i < b.log.length; i++) {
    const line = b.log[i];
    if (line.startsWith("|split|")) { i++; continue; } // skip the private copy; the public one follows
    if (!line.startsWith("|t:|")) out.push(line);
  }
  return out;
}

/** A Pokémon's Team slot, from its `s<slot>` nickname. */
export const slotOf = (pokemon) => Number(/^s(\d+)$/.exec(pokemon.name)[1]);

/** A forced switch (faint, U-turn, Eject Button): the healthy benched Pokémon with the lowest slot. */
export function nextSlotChoice(req) {
  const bench = req.side.pokemon
    .map((p, i) => ({ i, slot: Number(/: s(\d+)$/.exec(p.ident)[1]), ok: !p.active && !p.condition.endsWith(" fnt") }))
    .filter((p) => p.ok)
    .sort((a, b) => a.slot - b.slot);
  return bench.length ? `switch ${bench[0].i + 1}` : "default";
}

/**
 * Plays the battle until it ends or `turnCap` turns have been played.
 * choosers[i](request, battle, side) returns a choice string for a move
 * request; switch requests never reach it (slot order decides). A choice
 * the engine refuses (Choice lock, Taunt, no PP) becomes its default.
 */
export function drive(b, choosers, { turnCap = TURN_CAP } = {}) {
  const limit = 40 * turnCap + 100; // requests, not turns: a turn can ask several times
  for (let n = 0; !b.ended; n++) {
    if (b.turn > turnCap) return { cappedAt: turnCap };
    if (n > limit) throw new Error(`full sim: no progress after ${limit} requests`);
    // Every side decides before any choice is made, so a chooser that looks
    // ahead on a copy of the battle can't see the other side's move.
    const choices = b.sides.map((side, i) => {
      const req = side.activeRequest;
      if (!req || req.wait) return null;
      return req.forceSwitch ? nextSlotChoice(req) : (choosers[i](req, b, i) ?? "default");
    });
    b.sides.forEach((side, i) => {
      if (choices[i] !== null && !side.choose(choices[i])) side.choose("default");
    });
    if (!b.ended && b.allChoicesDone()) b.commitChoices();
  }
  return { cappedAt: null };
}
