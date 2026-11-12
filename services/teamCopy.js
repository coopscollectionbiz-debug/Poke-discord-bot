// ==========================================================
// services/teamCopy.js — copying one team onto the other (owner decision,
// 2026-11-11): the Teams page's "Copy from Display team" / "Copy from Battle
// team". The page copies the Pokémon, their order and Mega choices into the
// team it shows; Save sends the team with copyFrom + copiedKeys, and the
// team save calls applyTeamCopy in the same locked write, so the team and
// the copied moves land together or not at all.
//
// Extension point: held items (PR #72, user.equipment.{display|battle})
// add their own copy step here, for the same copied keys.
// ==========================================================

import { chosenMoves, setMoveset, TEAM_TYPES } from "./movesets.js";

const KEY = /^([1-9]\d{0,4}):(normal|shiny)$/;
export const MAX_COPIED_KEYS = 6;

/**
 * Validate copyFrom / copiedKeys from the team save body.
 * @returns {{ok:true, copy:null} | {ok:true, copy:{from, keys}} | {ok:false, status, error, code}}
 */
export function parseTeamCopy(body, teamType) {
  const from = body?.copyFrom;
  if (from == null) return { ok: true, copy: null };
  if (!TEAM_TYPES.includes(from) || from === teamType) return { ok: false, status: 400, error: "Unknown team to copy from.", code: "bad_copy" };
  const keys = body?.copiedKeys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_COPIED_KEYS || keys.some((k) => typeof k !== "string" || !KEY.test(k))) {
    return { ok: false, status: 400, error: "Invalid copied Pokémon.", code: "bad_copy" };
  }
  return { ok: true, copy: { from, keys: [...new Set(keys)] } };
}

/**
 * IN PLACE, after the team itself was validated and saved: for each copied
 * Pokémon that is on the saved team, make its moves on team `to` the same as
 * on team `from` (automatic there → automatic here). Pokémon added by hand
 * after the copy are not in copiedKeys and keep their own moves.
 * @returns the keys whose moves were copied
 */
export function applyTeamCopy(user, { from, to, keys }, savedTeam) {
  const onTeam = new Set((savedTeam ?? []).map((s) => `${Number(s.id)}:${s.variant === "shiny" ? "shiny" : "normal"}`));
  const done = [];
  for (const key of keys) {
    if (!onTeam.has(key)) continue;
    const [id, variant] = key.split(":");
    setMoveset(user, to, Number(id), variant, chosenMoves(user, from, Number(id), variant));
    done.push(key);
  }
  return done;
}
