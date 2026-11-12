// ==========================================================
// services/movesets.js — chosen movesets, per team (owner decision,
// 2026-11-10): each team keeps its own up-to-4 moves for the same Pokémon
// copy, with a copy-from-the-other-team option on the dashboard.
//
//   user.movesets = {
//     display: { "6:normal": ["flamethrower", "slash", …],     // plain copies of the line
//                "u:c_7Hk2Qm9xLp": ["dragonclaw", …] },        // one copy (any copy, docs/adr/0001)
//     battle:  { "6:normal": ["wingattack", …] },              // ranked + wager
//   }
//
// A move is allowed when the species learns it by level-up at or below the
// copy's REAL Level (never its Lv 50 ranked Level), or — for a customized
// copy (TM system, services/ownership.js) — when that copy learned it from
// a TM (customPokemon[uid].tmMoves). TM moves belong to the copy, never to
// the line: a plain copy never sees another copy's TM moves.
// 1–4 distinct moves. No stored moveset → the automatic moveset (the last
// four learned), exactly as before. A copy with no selection of its own uses
// the line's selection (stored before copies had their own; its learnable
// pool decides what survives). Every copy is its own Pokémon: its moves
// follow ITS Level, and two copies on one team keep separate movesets.
// ==========================================================

import { getSpecies, getMove } from "../utils/battle/data.js";
import { getTraining } from "../utils/training.js";
import { slotCopyUid, slotBoxUid } from "./ownership.js";
import { copyTraining } from "./box.js";

export const TEAM_TYPES = Object.freeze(["display", "battle"]);
export const MAX_MOVES = 4;
const normV = (variant) => (variant === "shiny" ? "shiny" : "normal");
const lineKey = (id, variant) => `${Number(id)}:${normV(variant)}`;
export const copyKey = (uid) => `u:${uid}`;

/**
 * A valid copy uid for this line, or null. Accepts both kinds of copy id
 * (docs/adr/0001): a box copy (user.box, every copy since the Pokédex /
 * Collection split) and a customized TM copy (user.customPokemon).
 */
export const copyUid = (user, speciesId, variant, uid) => {
  if (uid == null) return null;
  const slot = { id: Number(speciesId), variant: normV(variant), uid };
  return slotBoxUid(user, slot) ?? slotCopyUid(user, slot);
};

/** TM moves this copy learned (none for a plain copy). Unknown move ids are skipped. */
export function tmMovesFor(user, speciesId, variant, { uid = null } = {}) {
  const u = copyUid(user, speciesId, variant, uid);
  const rec = u ? user.customPokemon?.[u] : null;
  if (!rec || rec.suspended) return [];
  return rec.tmMoves.filter((m) => getMove(m));
}

/**
 * Every move this copy may equip: level-up moves learned at or below its
 * real Level (earliest Level kept), then its TM moves. [{ id, learnedAt|null, source }]
 */
export function learnableMoves(user, speciesId, variant, { level = null, uid = null } = {}) {
  const species = getSpecies(Number(speciesId));
  if (!species) return [];
  // The copy's own Level when one is named; else the line's best copy.
  const own = uid != null ? copyUid(user, speciesId, variant, uid) : null;
  const lv = level ?? (own && copyTraining(user, own)?.level) ?? getTraining(user ?? {}, Number(speciesId), variant).level;
  const seen = new Map();
  for (const [at, moveId] of species.levelMoves ?? []) {
    if (at > lv) break;
    if (!seen.has(moveId) && getMove(moveId)) seen.set(moveId, { id: moveId, learnedAt: at, source: "level" });
  }
  for (const moveId of tmMovesFor(user, speciesId, variant, { uid })) {
    if (!seen.has(moveId)) seen.set(moveId, { id: moveId, learnedAt: null, source: "tm" });
  }
  return [...seen.values()];
}

/**
 * The stored moveset for this copy on this team, keeping only moves it may
 * still use (null when none is stored or none survives → automatic moves).
 * With a valid `uid`, the copy's own selection is used first, then the line's.
 */
export function chosenMoves(user, team, speciesId, variant, { uid = null } = {}) {
  const u = copyUid(user, speciesId, variant, uid);
  const stored = user?.movesets?.[team] ?? {};
  const raw = (u && stored[copyKey(u)]) || stored[lineKey(speciesId, variant)];
  if (!Array.isArray(raw) || !raw.length) return null;
  const allowed = new Set(learnableMoves(user, speciesId, variant, { uid: u }).map((m) => m.id));
  const out = [...new Set(raw)].filter((m) => allowed.has(m)).slice(0, MAX_MOVES);
  return out.length ? out : null;
}

const fail = (error, code) => ({ ok: false, status: 400, error, code });

/** Validate a moveset the dashboard sent. → { ok:true, moves, uid } | { ok:false, status, error, code } */
export function validateMoveset(user, speciesId, variant, moves, { uid = null } = {}) {
  const id = Number(speciesId);
  if (!Number.isInteger(id) || !getSpecies(id)) return fail("Unknown Pokémon.", "bad_species");
  if (!(Number(user?.pokemon?.[id]?.[normV(variant)]) > 0)) return fail("You don't own that Pokémon.", "unowned");
  const u = copyUid(user, id, variant, uid);
  if (uid != null && !u) return fail("That Pokémon copy no longer exists. Reload and try again.", "unknown_copy");
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > MAX_MOVES) return fail(`Choose 1–${MAX_MOVES} moves.`, "bad_size");
  if (moves.some((m) => typeof m !== "string" || m.length > 40)) return fail("Invalid move.", "bad_move");
  if (new Set(moves).size !== moves.length) return fail("Each move can only be equipped once.", "duplicate");
  const allowed = new Set(learnableMoves(user, id, variant, { uid: u }).map((m) => m.id));
  const unknown = moves.filter((m) => !allowed.has(m));
  if (unknown.length) {
    const names = unknown.map((m) => getMove(m)?.name ?? m).join(", ");
    return fail(`Not learned yet: ${names}. A Pokémon can only use moves it has learned by its current Level.`, "not_learned");
  }
  return { ok: true, moves: [...moves], uid: u };
}

/**
 * IN PLACE. moves = null clears the choice (automatic moves). With `uid`
 * (already validated by validateMoveset), the copy's own selection is set.
 */
export function setMoveset(user, team, speciesId, variant, moves, { uid = null } = {}) {
  if (!TEAM_TYPES.includes(team)) throw new Error("bad team");
  const k = uid ? copyKey(uid) : lineKey(speciesId, variant);
  user.movesets ??= {};
  user.movesets[team] ??= {};
  if (moves == null) delete user.movesets[team][k];
  else user.movesets[team][k] = [...moves];
  return user.movesets[team][k] ?? null;
}

/**
 * IN PLACE. The POST /api/pokemon/moveset body applied to one user:
 * { team, pokeId, variant, moves: [moveId…] | null, uid? }.
 * → { ok:true, team, uid, moves } | { ok:false, status, error, code }
 * The slot's uid may name a box copy or a TM copy; both resolve through
 * copyUid() (a TM-only check here refused every box copy, 2026-11-12).
 */
export function saveMoveset(user, { team, pokeId, variant, moves, uid = null } = {}) {
  if (!TEAM_TYPES.includes(team)) return { ok: false, status: 400, error: "Unknown team type", code: "bad_team" };
  const v = normV(variant);
  const copy = uid == null ? null : copyUid(user, pokeId, v, uid);
  if (uid != null && !copy) return fail("That Pokémon copy no longer exists. Reload and try again.", "unknown_copy");
  if (moves !== null) {
    const check = validateMoveset(user, pokeId, v, moves, { uid: copy });
    if (!check.ok) return check;
    setMoveset(user, team, pokeId, v, check.moves, { uid: copy });
  } else setMoveset(user, team, pokeId, v, null, { uid: copy });
  return { ok: true, team, uid: copy, moves: chosenMoves(user, team, pokeId, v, { uid: copy }) };
}

/** Display info for a move id. */
export function moveInfo(moveId) {
  const m = getMove(moveId);
  return m ? { id: moveId, name: m.name, type: m.type ?? null, power: m.power ?? null, category: m.category ?? null } : { id: moveId, name: String(moveId), type: null, power: null, category: null };
}
