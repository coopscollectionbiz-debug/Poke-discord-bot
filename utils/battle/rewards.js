// ==========================================================
// utils/battle/rewards.js
// Battle EXP (Gen V formula), Elo, and the per-user battle record
// that holds Battle rating, W/L, and the daily Battle caps.
// ==========================================================

import { getSpecies } from "./data.js";
import { BST_YIELD_SCALE, TRAINER_BATTLE_MULT, WIN_EXP_MULT, ELO, CAPS, RANKED } from "./tuning.js";
import { liveEffects } from "../../services/liveEvents.js";

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

// user.battle is the RANKED record (ranked + wager battles): rating, W/L for
// the current season, plus the daily Battle caps shared by every mode
// (day/started/vs). A record from an earlier season is archived to
// user.battle.past and reset (rating ELO.start, 0–0) the first time it is
// written; readers use rankedRecord(), which treats it as reset.
export function getBattleRecord(user, day) {
  user.battle ??= { rating: ELO.start, wins: 0, losses: 0, day, started: 0, vs: {}, season: RANKED.season };
  const b = user.battle;
  if ((b.season ?? 0) !== RANKED.season) {
    if ((b.wins ?? 0) + (b.losses ?? 0) > 0) (b.past ??= []).push({ season: b.season ?? 0, rating: b.rating, wins: b.wins, losses: b.losses });
    Object.assign(b, { rating: ELO.start, wins: 0, losses: 0, season: RANKED.season });
  }
  if (b.day !== day) Object.assign(b, { day, started: 0, vs: {} });
  return b;
}

/** Read-only view of this season's ranked record ({ rating, wins, losses }); a stale season reads as reset. */
export function rankedRecord(user) {
  const b = user?.battle;
  if (!b || (b.season ?? 0) !== RANKED.season) return { rating: ELO.start, wins: 0, losses: 0 };
  return { rating: b.rating ?? ELO.start, wins: b.wins ?? 0, losses: b.losses ?? 0 };
}

/**
 * Lifetime ranked progress for achievements: wins across every season
 * (archived + current, or a not-yet-archived old record) and the best rating
 * ever reached. The season reset never takes back achievement progress.
 */
export function lifetimeRanked(user) {
  const b = user?.battle;
  if (!b) return { wins: 0, bestRating: 0 };
  const past = Array.isArray(b.past) ? b.past : [];
  const wins = past.reduce((s, p) => s + (Number(p.wins) || 0), 0) + (Number(b.wins) || 0);
  const bestRating = Math.max(Number(b.rating) || 0, ...past.map((p) => Number(p.rating) || 0));
  return { wins, bestRating };
}

/** The casual (open battle) record: unrated W/L and streaks. Created on first write. */
export function getCasualRecord(user) {
  user.casual ??= { wins: 0, losses: 0, streak: 0, bestStreak: 0 };
  return user.casual;
}

// A Live event can add battles to the daily total (never the per-Defender limit).
export const dailyCap = (fx = liveEffects()) => CAPS.perDay + (fx.battleCap || 0);

export function capBlock(record, opponentId, fx = liveEffects()) {
  if (record.started >= dailyCap(fx)) return "daily";
  if ((record.vs[opponentId] ?? 0) >= CAPS.perOpponent) return "opponent";
  return null;
}

export function recordStart(record, opponentId) {
  record.started++;
  record.vs[opponentId] = (record.vs[opponentId] ?? 0) + 1;
}
