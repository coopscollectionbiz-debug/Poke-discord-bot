// ==========================================================
// services/megaTeam.js — Mega cards in the battle team (Phase M1).
//
// A team slot stays { id, variant } and may carry one optional field:
//   { id: 6, variant: "normal", mega: "mega-charizard-x" }
// meaning "this line, shown and (from Phase M2) battling as this Mega form".
//
// Rules (approved; docs/mega-evolution/README.md, owner direction):
//   • at most ONE Mega slot per team
//   • a line can't be on the team both as its base and as its Mega
//   • the form must be unlocked on that exact line (species + normal/shiny),
//     the line must be owned, the form must pass megaFormGate("team")
//   • a Mega slot is one ordinary slot (1–6 total)
//
// Battle boundary (Phase M2): buildTeam() in utils/battle/runBattle.js asks
// resolveBattleMega() (below) which slot, if any, battles as a Mega. Only a
// fully valid, battle-eligible Mega passes (capability "battle" is opt-in:
// MEGA_EVOLUTION_ENABLED and MEGA_BATTLES_ENABLED); otherwise every slot
// battles as its base form. Nothing is written to player data.
//
// Rollback: production v21 rebuilds every slot as { id, variant }, so the
// extra field simply disappears and the slot battles as the base form.
//
// TM system (phase T1): a slot may also carry `uid`, naming one customized
// (TM-trained) copy of that line (services/ownership.js). It is kept only
// when the record exists for that exact line; no uid = a plain copy, as
// before. Lines stay unique per team, so a team holds at most one copy.
// ==========================================================

import { toTeamObj } from "../utils/economyRules.js";
import { normalizeTeam } from "../utils/teamNormalize.js";
import { getMega, megaFormGate, megaBattleEligibility, megaBattleProfile, MEGA_ID_PATTERN } from "../utils/megas.js";
import { unlockedForms, megaLineKey } from "./megaUnlocks.js";
import { isMegaCapabilityEnabled } from "../config/features.js";
import { slotCopyUid, slotBoxUid } from "./ownership.js";

const fail = (status, error, code) => ({ ok: false, status, error, code });

/** The slot's `mega` value if it is a well-formed Mega id string, else null. */
export function megaFieldOf(entry) {
  const m = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.mega : undefined;
  return typeof m === "string" && m.length <= 64 && MEGA_ID_PATTERN.test(m) ? m : null;
}

/** Data integrity only (no flags): known form of this species, unlocked on this line. */
export function megaFitsSlot(user, slot, megaId) {
  const f = getMega(megaId);
  return !!f && f.species === slot.id && unlockedForms(user, megaLineKey(slot.id, slot.variant)).includes(megaId);
}

/**
 * The bot's stored-team normalization (moved verbatim from bot_final.js
 * normalizeUserSchema, step 4), plus: a valid Mega selection is kept.
 * Teams without Mega fields come out exactly as before. IN PLACE.
 */
export function normalizeDisplayedTeam(user) {
  if (!Array.isArray(user.displayedPokemon)) {
    user.displayedPokemon = [];
  }
  // Convert legacy [243,245] => [{id:243, variant:"normal"}, ...]
  if (user.displayedPokemon.length && typeof user.displayedPokemon[0] !== "object") {
    user.displayedPokemon = user.displayedPokemon
      .map((pid) => ({ id: Number(pid), variant: "normal" }))
      .filter((t) => Number.isInteger(t.id));
  }
  // Normalize + remove ghosts (must own that specific variant)
  user.displayedPokemon = user.displayedPokemon
    .map((t) => {
      const slot = { id: Number(t?.id), variant: t?.variant === "shiny" ? "shiny" : "normal" };
      const mega = megaFieldOf(t);
      // Any copy of the line (docs/adr/0001); trained copies are copies too.
      const uid = slotBoxUid(user, { ...slot, uid: t?.uid }) ?? slotCopyUid(user, { ...slot, uid: t?.uid });
      const out = mega && Number.isInteger(slot.id) && megaFitsSlot(user, slot, mega) ? { ...slot, mega } : slot;
      return uid ? { ...out, uid } : out;
    })
    .filter((t) => Number.isInteger(t.id))
    .filter((t) => {
      const owned = user.pokemon?.[t.id];
      if (!owned) return false;
      return Number(owned?.[t.variant] || 0) > 0;
    });
  return user.displayedPokemon;
}

/**
 * Validate a team the dashboard sent (POST /api/set-pokemon-team). Same
 * results as the previous inline route code for teams without Megas; the
 * Mega rules apply only to slots that carry `mega`.
 * @returns {{ok:true, team:Array} | {ok:false, status:number, error:string, code:string}}
 */
export function prepareTeamSelection(user, rawTeam, { env = process.env } = {}) {
  if (!Array.isArray(rawTeam)) return fail(400, "Missing id/team", "bad_team");
  const ownsVariant = (pid, variant) => {
    const p = user.pokemon?.[pid];
    if (!p) return false;
    return (p[variant] ?? 0) > 0;
  };

  // Parse (unchanged) + carry a well-formed mega field; anything else in
  // `mega` (wrong type, malformed id) is refused rather than silently dropped.
  const parsed = [];
  for (const entry of rawTeam) {
    const slot = toTeamObj(entry);
    if (!slot) continue;
    const hasMegaKey = entry && typeof entry === "object" && !Array.isArray(entry) && entry.mega !== undefined && entry.mega !== null;
    let out = slot;
    if (hasMegaKey) {
      const mega = megaFieldOf(entry);
      if (!mega) return fail(400, "Invalid Mega form.", "bad_mega");
      out = { ...slot, mega };
    }
    // TM system: a named customized copy must exist for this exact line.
    const hasUidKey = entry && typeof entry === "object" && !Array.isArray(entry) && entry.uid !== undefined && entry.uid !== null;
    if (hasUidKey) {
      const uid = slotBoxUid(user, { ...slot, uid: entry.uid }) ?? slotCopyUid(user, { ...slot, uid: entry.uid });
      if (!uid) return fail(400, "That Pokémon copy no longer exists. Reload and try again.", "unknown_copy");
      out = { ...out, uid };
    }
    parsed.push(out);
  }

  const megaSlots = parsed.filter((s) => s.mega);
  if (megaSlots.length) {
    if (!isMegaCapabilityEnabled("team", env)) return fail(403, "Mega Evolution teams aren't available yet.", "disabled");
    if (megaSlots.length > 1) return fail(400, "Only one Mega Pokémon can be on a team.", "too_many_megas");
    const m = megaSlots[0];
    const f = getMega(m.mega);
    if (!f || f.species !== m.id) return fail(400, "That Mega form doesn't belong to that Pokémon.", "wrong_species");
    const gate = megaFormGate(m.mega, "team", { env });
    if (!gate.allowed) return { ...fail(400, `${f.name} isn't available for teams right now.`, "blocked"), reasons: gate.reasons };
    if (!unlockedForms(user, megaLineKey(m.id, m.variant)).includes(m.mega)) return fail(400, `${f.name} isn't unlocked for that ${m.variant === "shiny" ? "shiny " : ""}${f.baseSpecies}.`, "not_unlocked");
    if (parsed.some((s) => !s.mega && s.id === m.id && s.variant === m.variant)) return fail(400, `${f.baseSpecies} can't be on the team as both its base form and ${f.name}.`, "base_and_mega");
  }

  // Unique = (id + variant) pair: Casual and Ranked hold each Pokémon once
  // (only the Showcase takes repeats). Each slot still names its copy.
  const dedupMap = new Map();
  for (const slot of parsed) {
    const key = `${slot.id}:${slot.variant}`;
    if (!dedupMap.has(key)) dedupMap.set(key, slot);
  }
  const normalized = [...dedupMap.values()];
  if (normalized.length === 0 || normalized.length > 6) {
    return fail(400, "Team must be 1–6 unique slots (unique = Pokémon + variant).", "bad_size");
  }
  const unowned = normalized.filter((slot) => !ownsVariant(slot.id, slot.variant));
  if (unowned.length) {
    const list = unowned.map((s) => `#${s.id} (${s.variant})`).join(", ");
    return fail(400, `Unowned Pokémon slots: ${list}`, "unowned");
  }
  return { ok: true, team: normalized };
}

/**
 * What a battle does with this player's team (Phase M1: every slot battles
 * as its base form). Pure: reads only.
 */
export function megaBattleBoundary(user, { env = process.env } = {}) {
  const raw = Array.isArray(user?.displayedPokemon) ? user.displayedPokemon : [];
  const requested = raw.map(megaFieldOf).filter(Boolean);
  const mega = resolveBattleMega(user, { env });
  return {
    megaBattles: isMegaCapabilityEnabled("battle", env),
    requestedMega: requested[0] ?? null,
    battlesAs: normalizeTeam(raw, 6).map((s) => ({ id: s.id, variant: s.variant, form: mega?.ok && mega.key === (s.uid ? `u:${s.uid}` : `${s.id}:${s.variant}`) ? mega.formId : "base" })),
    reason: mega && !mega.ok ? mega.reason : null,
  };
}

/**
 * Phase M2: which team slot (if any) battles as a Mega, decided at battle
 * time from the stored team. FAIL-CLOSED: on any doubt — battles switched
 * off, more than one Mega slot, form unknown or of another species, not
 * unlocked on that line, line not owned, form blocked, battle profile
 * unverified, ability not modelled, generation not live — NO slot battles as
 * a Mega (everyone battles as their base form, never an unearned advantage).
 * Pure: reads only.
 * @returns {null | {ok:true, key:string, formId:string, profile:object} | {ok:false, reason:string, formId?:string}}
 */
export function resolveBattleMega(user, { env = process.env, team = user?.displayedPokemon } = {}) {
  const raw = Array.isArray(team) ? team : []; // `team`: the Display team (default) or the Battle team
  const megaSlots = raw.filter((t) => megaFieldOf(t));
  if (!megaSlots.length) return null;
  if (!isMegaCapabilityEnabled("battle", env)) return { ok: false, reason: "Mega battles are switched off" };
  if (megaSlots.length > 1) return { ok: false, reason: "more than one Mega slot in the stored team" };
  const t = megaSlots[0];
  const slot = { id: Number(t.id), variant: t.variant === "shiny" ? "shiny" : "normal" };
  const formId = megaFieldOf(t);
  const f = getMega(formId);
  if (!f || f.species !== slot.id) return { ok: false, reason: "form doesn't belong to that Pokémon", formId };
  if (!(Number(user.pokemon?.[slot.id]?.[slot.variant]) > 0)) return { ok: false, reason: "line not owned", formId };
  if (!unlockedForms(user, megaLineKey(slot.id, slot.variant)).includes(formId)) return { ok: false, reason: "not unlocked on that line", formId };
  const e = megaBattleEligibility(formId, { env });
  if (!e.battleReady) return { ok: false, reason: e.reasons[0], formId };
  // The slot's copy when it names one (held items and the Mega slot follow the copy).
  return { ok: true, key: typeof t.uid === "string" ? `u:${t.uid}` : `${slot.id}:${slot.variant}`, formId, profile: megaBattleProfile(formId) };
}
