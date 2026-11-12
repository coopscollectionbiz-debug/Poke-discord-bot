// ==========================================================
// services/showcaseTeam.js: the Showcase team (CONTEXT.md "Showcase team").
//
// A player's up-to-6 favorites, shown on /showcase and the trainer card
// strip. It never fights, so it has no rules beyond owning what's in it:
//   • repeats are allowed, but every slot is its own Copy (two Caterpie need
//     two Caterpie; docs/adr/0001)
//   • any number of unlocked Mega forms
//   • no movesets, no held items
// Stored as user.showcaseTeam = [{ id, variant, uid, mega? }].
//
// At launch the field is absent; the first normalization fills it ONCE with
// a copy of the player's current Casual team (displayedPokemon). After that
// an empty array means "no favorites picked", never "fill it again".
// ==========================================================

import { megaFieldOf, megaFitsSlot } from "./megaTeam.js";
import { copiesOf, copyOf } from "./box.js";
import { getMega, megaFormGate } from "../utils/megas.js";
import { isMegaCapabilityEnabled } from "../config/features.js";
import { toTeamObj } from "../utils/economyRules.js";

export const SHOWCASE_MAX = 6;
const fail = (status, error, code) => ({ ok: false, status, error, code });
const normV = (v) => (v === "shiny" ? "shiny" : "normal");
const lineOf = (rec) => `${Number(rec?.id)}:${rec?.shiny ? "shiny" : "normal"}`;

// A copy of this line not used yet in `used` (untrained first, best Level first).
function freeCopy(user, id, variant, used) {
  const free = copiesOf(user, id, variant).filter((c) => !used.has(c.uid));
  return (free.find((c) => !c.trained) ?? free[0])?.uid ?? null;
}

/** Clean one list of raw slots into Showcase slots, each with its own copy. */
function cleanSlots(user, raw) {
  const used = new Set();
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (out.length >= SHOWCASE_MAX) break;
    const t = toTeamObj(entry);
    if (!t) continue;
    const slot = { id: Number(t.id), variant: normV(t.variant) };
    const wanted = entry && typeof entry === "object" ? entry.uid : undefined;
    const rec = copyOf(user, wanted);
    let uid = rec && lineOf(rec) === `${slot.id}:${slot.variant}` && !used.has(wanted) ? wanted : null;
    uid ??= freeCopy(user, slot.id, slot.variant, used);
    if (!uid) continue; // no copy left for this slot: it can't be shown
    used.add(uid);
    const mega = megaFieldOf(entry);
    out.push({ ...slot, uid, ...(mega && megaFitsSlot(user, slot, mega) ? { mega } : {}) });
  }
  return out;
}

/**
 * IN PLACE, idempotent. Run after normalizeBox (copies exist).
 * @returns {{ filled: boolean }} filled = the one-time launch fill happened now
 */
export function normalizeShowcase(user) {
  if (!user || typeof user !== "object") return { filled: false };
  if (!("showcaseTeam" in user)) {
    user.showcaseTeam = cleanSlots(user, user.displayedPokemon);
    return { filled: true };
  }
  user.showcaseTeam = cleanSlots(user, user.showcaseTeam);
  return { filled: false };
}

/**
 * Validate a Showcase save (dashboard Teams page). Every slot must be a
 * Pokémon the player owns; a named uid must be a copy of that line and used
 * once; slots without one get a free copy. Up to 6 slots, 0 allowed (clears it).
 * Megas: each must be unlocked on its line and allowed on teams.
 */
export function prepareShowcaseSelection(user, rawTeam, { env = process.env } = {}) {
  if (!Array.isArray(rawTeam)) return fail(400, "Missing team", "bad_team");
  if (rawTeam.length > SHOWCASE_MAX) return fail(400, `A Showcase holds at most ${SHOWCASE_MAX} Pokémon.`, "bad_size");
  const used = new Set();
  const team = [];
  for (const entry of rawTeam) {
    const t = toTeamObj(entry);
    if (!t) return fail(400, "Invalid Pokémon.", "bad_team");
    const slot = { id: Number(t.id), variant: normV(t.variant) };
    if (!(Number(user.pokemon?.[slot.id]?.[slot.variant]) > 0)) return fail(400, `You don't own that ${slot.variant === "shiny" ? "shiny " : ""}Pokémon.`, "unowned");
    let uid = null;
    if (entry && typeof entry === "object" && entry.uid != null) {
      const rec = copyOf(user, entry.uid);
      if (!rec || lineOf(rec) !== `${slot.id}:${slot.variant}`) return fail(400, "That Pokémon copy no longer exists. Reload and try again.", "unknown_copy");
      if (used.has(entry.uid)) return fail(400, "The same Pokémon can't fill two Showcase slots.", "duplicate_copy");
      uid = entry.uid;
    } else {
      uid = freeCopy(user, slot.id, slot.variant, used);
      if (!uid) return fail(400, "You don't have another copy of that Pokémon for this slot.", "no_copy_left");
    }
    used.add(uid);
    const mega = entry && typeof entry === "object" && entry.mega != null ? megaFieldOf(entry) : null;
    if (entry && typeof entry === "object" && entry.mega != null && !mega) return fail(400, "Invalid Mega form.", "bad_mega");
    if (mega) {
      if (!isMegaCapabilityEnabled("team", env)) return fail(403, "Mega Evolution teams aren't available yet.", "disabled");
      const f = getMega(mega);
      if (!f || !megaFitsSlot(user, slot, mega)) return fail(400, "That Mega form isn't unlocked for that Pokémon.", "not_unlocked");
      const gate = megaFormGate(mega, "team", { env });
      if (!gate.allowed) return { ...fail(400, `${f.name} isn't available for teams right now.`, "blocked"), reasons: gate.reasons };
    }
    team.push({ ...slot, uid, ...(mega ? { mega } : {}) });
  }
  return { ok: true, team };
}
