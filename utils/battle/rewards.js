// ==========================================================
// utils/battle/rewards.js
// Battle EXP (Gen V formula), Elo, and the per-user battle record
// that holds Battle rating, W/L, and the daily Battle caps.
// ==========================================================

import { getSpecies } from "./data.js";
import { BST_YIELD_SCALE, TRAINER_BATTLE_MULT, WIN_EXP_MULT, ELO, CAPS } from "./tuning.js";

const bst = (speciesId) => Object.values(getSpecies(speciesId).baseStats).reduce((a, b) => a + b, 0);

// Gen V scaled EXP per knockout (Serebii): beating foes above your Level
// pays more, below pays less. Base stat total stands in for the real
// EXP-yield number, which the Showdown data doesn't have.
export function koExp({ foeSpeciesId, foeLevel, recipientLevel }) {
  const a = 2 * foeLevel + 10;
  const c = foeLevel + recipientLevel + 10;
  const b = (Math.round(bst(foeSpeciesId) * BST_YIELD_SCALE) * foeLevel / 5) * TRAINER_BATTLE_MULT;
  return Math.floor((Math.floor(Math.sqrt(a) * a * a) * b) / Math.floor(Math.sqrt(c) * c * c)) + 1;
}

// Every Team member earns from every knockout (Exp. Share style).
export function teamExp({ members, knockedOut, won }) {
  return members.map((m) => {
    const sum = knockedOut.reduce((t, f) => t + koExp({ foeSpeciesId: f.speciesId, foeLevel: f.level, recipientLevel: m.level }), 0);
    return Math.floor(sum * (won ? WIN_EXP_MULT : 1));
  });
}

export function eloUpdate(ra, rb, scoreA) {
  const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
  const delta = ELO.k * (scoreA - expectedA);
  return [Math.round(ra + delta), Math.round(rb - delta)];
}

export const utcDay = (date) => date.toISOString().split("T")[0];

export function getBattleRecord(user, day) {
  user.battle ??= { rating: ELO.start, wins: 0, losses: 0, day, started: 0, vs: {} };
  if (user.battle.day !== day) Object.assign(user.battle, { day, started: 0, vs: {} });
  return user.battle;
}

export function capBlock(record, opponentId) {
  if (record.started >= CAPS.perDay) return "daily";
  if ((record.vs[opponentId] ?? 0) >= CAPS.perOpponent) return "opponent";
  return null;
}

export function recordStart(record, opponentId) {
  record.started++;
  record.vs[opponentId] = (record.vs[opponentId] ?? 0) + 1;
}
