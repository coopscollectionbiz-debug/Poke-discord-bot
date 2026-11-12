// ==========================================================
// services/battleTeam.js — the Battle team (ranked and wager battles).
//
// Players have two teams (owner decision, docs/design/TEAMS-COLLECTION-REDESIGN.md):
//   • Display team = user.displayedPokemon (unchanged meaning: open battles,
//     /showteam, trainer card, every existing display)
//   • Battle team  = user.battleTeam (new; same slot shape:
//     [{ id, variant, mega? }], 1–6 slots)
//
// Battle team rules: everything a Display team must satisfy
// (prepareTeamSelection: 1–6 unique owned slots, the Mega rules — at most one
// Mega per team) PLUS at most ONE mythic-tier Pokémon (pokemonData tier
// "mythic"; legendary-tier is unlimited).
//
// Rollback safety: production v28 never reads battleTeam, so the extra field
// is ignored there. `battleTeam` missing means "never set" (no Battle team).
// Players set it themselves on the Teams page (owner decision: no automatic
// copy of the Display team).
//
// Nothing here runs battles; the ranked/wager side reads the Battle team in a
// later milestone.
// ==========================================================

import { toTeamObj, normVariant } from "../utils/economyRules.js";
import { getSpeciesEntry } from "../utils/speciesCatalog.js";
import { megaFieldOf, megaFitsSlot, prepareTeamSelection } from "./megaTeam.js";
import { slotCopyUid } from "./ownership.js";
import { addNotice, NOTICE_KINDS } from "./notices.js";

export const BATTLE_TEAM_MAX_MYTHIC = 1;

export const isMythicTier = (id) => String(getSpeciesEntry(id)?.tier ?? "").toLowerCase() === "mythic";
const speciesName = (id) => getSpeciesEntry(id)?.name ?? `#${id}`;

/** True when the player has ever set (or been given) a Battle team. */
export const hasBattleTeam = (user) => Array.isArray(user?.battleTeam);

/**
 * Clean a stored team array the same way normalizeDisplayedTeam cleans the
 * Display team: legacy numbers → objects, variant normalized, a valid Mega
 * kept, slots whose exact variant isn't owned removed. Returns a new array.
 */
export function cleanStoredTeam(user, raw) {
  let team = Array.isArray(raw) ? raw : [];
  if (team.length && typeof team[0] !== "object") {
    team = team.map((pid) => ({ id: Number(pid), variant: "normal" })).filter((t) => Number.isInteger(t.id));
  }
  return team
    .map((t) => {
      const slot = { id: Number(t?.id), variant: t?.variant === "shiny" ? "shiny" : "normal" };
      const mega = megaFieldOf(t);
      const uid = slotCopyUid(user, { ...slot, uid: t?.uid }); // TM system: a named customized copy
      const out = mega && Number.isInteger(slot.id) && megaFitsSlot(user, slot, mega) ? { ...slot, mega } : slot;
      return uid ? { ...out, uid } : out;
    })
    .filter((t) => Number.isInteger(t.id))
    .filter((t) => Number(user.pokemon?.[t.id]?.[t.variant] || 0) > 0);
}

/**
 * IN PLACE: enforce the mythic limit on a stored Battle team. Saving already
 * enforces it; this catches teams that went over because species changed
 * tier (2026-11-11 re-tier: Dialga, Palkia, Giratina and Kyurem became
 * mythic). Keeps the first mythic-tier slot in slot order, removes the rest
 * from the Battle team (the Pokémon stay in the collection) and stores a
 * one-time notice. Idempotent. Returns the removed slots.
 */
export function trimBattleTeamMythics(user, now = Date.now()) {
  if (!hasBattleTeam(user)) return [];
  let kept = null;
  const removed = [];
  user.battleTeam = user.battleTeam.filter((s) => {
    if (!isMythicTier(s.id)) return true;
    if (kept == null) { kept = s; return true; }
    removed.push(s);
    return false;
  });
  if (removed.length) {
    const names = removed.map((s) => `${s.variant === "shiny" ? "shiny " : ""}${speciesName(s.id)}`);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    addNotice(user, NOTICE_KINDS.BATTLE_TEAM_TRIM,
      `${list} ${removed.length === 1 ? "was" : "were"} removed from your Battle team. Some Pokémon are now mythic-tier, and a Battle team can have only one (you kept ${speciesName(kept.id)}). ${removed.length === 1 ? "It's" : "They're"} still in your collection.`,
      now);
  }
  return removed;
}

/** IN PLACE: clean user.battleTeam when present. Never creates the field. */
export function normalizeBattleTeam(user) {
  if (!user || !("battleTeam" in user)) return undefined;
  if (!Array.isArray(user.battleTeam)) {
    delete user.battleTeam; // malformed → treated as "never set"
    return undefined;
  }
  user.battleTeam = cleanStoredTeam(user, user.battleTeam);
  trimBattleTeamMythics(user);
  return user.battleTeam;
}

/**
 * Validate a Battle team the dashboard sent. Display-team rules first
 * (prepareTeamSelection), then the mythic limit.
 * @returns {{ok:true, team:Array} | {ok:false, status:number, error:string, code:string}}
 */
export function prepareBattleTeamSelection(user, rawTeam, opts = {}) {
  const prepared = prepareTeamSelection(user, rawTeam, opts);
  if (!prepared.ok) return prepared;
  const mythics = prepared.team.filter((s) => isMythicTier(s.id));
  if (mythics.length > BATTLE_TEAM_MAX_MYTHIC) {
    const names = mythics.map((s) => speciesName(s.id)).join(", ");
    return {
      ok: false,
      status: 400,
      code: "too_many_mythics",
      error: `A Battle team can have only one mythic-tier Pokémon. Your team has ${mythics.length}: ${names}.`,
    };
  }
  return prepared;
}

/** Is this exact copy (species + variant) on either team? */
export function isOnAnyTeam(user, pokeId, variant) {
  const pid = Number(pokeId);
  const v = normVariant(variant);
  const on = (raw) => (Array.isArray(raw) ? raw : []).map(toTeamObj).filter(Boolean).some((t) => t.id === pid && t.variant === v);
  return on(user?.displayedPokemon) || on(user?.battleTeam);
}
