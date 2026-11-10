// ==========================================================
// services/movesets.js — chosen movesets, per team (owner decision,
// 2026-11-10): each team keeps its own up-to-4 moves for the same Pokémon
// copy, with a copy-from-the-other-team option on the dashboard.
//
//   user.movesets = {
//     display: { "6:normal": ["flamethrower", "slash", …] },  // casual battles
//     battle:  { "6:normal": ["wingattack", …] },             // ranked + wager
//   }
//
// A move is allowed when the species learns it by level-up at or below the
// copy's REAL Level (never its Lv 50 ranked Level), or from a TM the player
// has learned (TMs aren't implemented yet: tmMovesFor() returns none).
// 1–4 distinct moves. No stored moveset → the automatic moveset (the last
// four learned), exactly as before.
// ==========================================================

import { getSpecies, getMove } from "../utils/battle/data.js";
import { getTraining } from "../utils/training.js";

export const TEAM_TYPES = Object.freeze(["display", "battle"]);
export const MAX_MOVES = 4;
const key = (id, variant) => `${Number(id)}:${variant === "shiny" ? "shiny" : "normal"}`;

/** TM moves this copy can use. TMs are not implemented yet (hook for later). */
export function tmMovesFor(/* user, speciesId, variant */) {
  return [];
}

/**
 * Every move this copy may equip: level-up moves learned at or below its
 * real Level (earliest Level kept), then TM moves. [{ id, learnedAt|null, source }]
 */
export function learnableMoves(user, speciesId, variant, { level = null } = {}) {
  const species = getSpecies(Number(speciesId));
  if (!species) return [];
  const lv = level ?? getTraining(user ?? {}, Number(speciesId), variant).level;
  const seen = new Map();
  for (const [at, moveId] of species.levelMoves ?? []) {
    if (at > lv) break;
    if (!seen.has(moveId) && getMove(moveId)) seen.set(moveId, { id: moveId, learnedAt: at, source: "level" });
  }
  for (const moveId of tmMovesFor(user, speciesId, variant)) {
    if (!seen.has(moveId) && getMove(moveId)) seen.set(moveId, { id: moveId, learnedAt: null, source: "tm" });
  }
  return [...seen.values()];
}

/**
 * The stored moveset for this copy on this team, keeping only moves it may
 * still use (null when none is stored or none survives → automatic moves).
 */
export function chosenMoves(user, team, speciesId, variant) {
  const raw = user?.movesets?.[team]?.[key(speciesId, variant)];
  if (!Array.isArray(raw) || !raw.length) return null;
  const allowed = new Set(learnableMoves(user, speciesId, variant).map((m) => m.id));
  const out = [...new Set(raw)].filter((m) => allowed.has(m)).slice(0, MAX_MOVES);
  return out.length ? out : null;
}

const fail = (error, code) => ({ ok: false, status: 400, error, code });

/** Validate a moveset the dashboard sent. → { ok:true, moves } | { ok:false, status, error, code } */
export function validateMoveset(user, speciesId, variant, moves) {
  const id = Number(speciesId);
  if (!Number.isInteger(id) || !getSpecies(id)) return fail("Unknown Pokémon.", "bad_species");
  if (!(Number(user?.pokemon?.[id]?.[variant === "shiny" ? "shiny" : "normal"]) > 0)) return fail("You don't own that Pokémon.", "unowned");
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > MAX_MOVES) return fail(`Choose 1–${MAX_MOVES} moves.`, "bad_size");
  if (moves.some((m) => typeof m !== "string" || m.length > 40)) return fail("Invalid move.", "bad_move");
  if (new Set(moves).size !== moves.length) return fail("Each move can only be equipped once.", "duplicate");
  const allowed = new Set(learnableMoves(user, id, variant).map((m) => m.id));
  const unknown = moves.filter((m) => !allowed.has(m));
  if (unknown.length) {
    const names = unknown.map((m) => getMove(m)?.name ?? m).join(", ");
    return fail(`Not learned yet: ${names}. A Pokémon can only use moves it has learned by its current Level.`, "not_learned");
  }
  return { ok: true, moves: [...moves] };
}

/** IN PLACE. moves = null clears the choice (automatic moves). */
export function setMoveset(user, team, speciesId, variant, moves) {
  if (!TEAM_TYPES.includes(team)) throw new Error("bad team");
  const k = key(speciesId, variant);
  user.movesets ??= {};
  user.movesets[team] ??= {};
  if (moves == null) delete user.movesets[team][k];
  else user.movesets[team][k] = [...moves];
  return user.movesets[team][k] ?? null;
}

/** Display info for a move id. */
export function moveInfo(moveId) {
  const m = getMove(moveId);
  return m ? { id: moveId, name: m.name, type: m.type ?? null, power: m.power ?? null, category: m.category ?? null } : { id: moveId, name: String(moveId), type: null, power: null, category: null };
}
