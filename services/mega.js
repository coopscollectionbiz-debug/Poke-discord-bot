// ==========================================================
// services/mega.js — Mega Stone use and Mega cards (Phase M1).
//
// useMegaStone() is the ONE way a stone becomes an unlock. It is a
// synchronous, all-or-nothing mutation meant to run inside
// runInventoryTransaction (services/inventory.js), which supplies the rest of
// the existing safety chain:
//   validate → lockUser (A1) → requestId replay check → THIS mutation
//   → saveAndAck (A1/A2 save queue: atomic local snapshot, seq + epoch
//   fencing, Discord backup) → acknowledge.
// The stone and the unlock change the same in-memory player record in one
// synchronous block, so every snapshot the queue writes holds both or
// neither; a failed save is retried, never rolled back (memory and disk
// can't diverge); a crash before the write loses both together.
// ==========================================================

import { getCatalogItem } from "../catalog/items.js";
import { getQuantity, consumeItems } from "./inventory.js";
import { getMega, megasOfSpecies, megaFormGate, megaBattleEligibility, megaSpritePath, megaAbility, allMegaStones } from "../utils/megas.js";
import { parseLineKey, ownsLine, checkMegaUnlock, recordMegaUnlock, variantChoiceOf, readMegaUnlocks, megaLineKey, REQUEST_ID_PATTERN } from "./megaUnlocks.js";
import { getTraining } from "../utils/training.js";
import { megaFieldOf } from "./megaTeam.js";
import { isMegaCapabilityEnabled } from "../config/features.js";

export const STONE_ID_PATTERN = /^megastone_[a-z0-9]{1,40}$/;
const fail = (error, code, status = 400) => ({ ok: false, error, code, status });
const STONE_IDS = new Set(allMegaStones().map((s) => s.id));

/**
 * Use one Mega Stone on one line to unlock one form, permanently.
 * Synchronous and all-or-nothing: on any refusal nothing changes.
 *
 * @param {object} user
 * @param {object} req
 * @param {string} req.line     "<species>:normal" | "<species>:shiny"
 * @param {string} req.stoneId  e.g. "megastone_charizarditex"
 * @param {string} req.formId   e.g. "mega-charizard-x", "mega-meowstic-f"
 * @param {object} [req.choice] optional { gender } / { appearance }; must match formId
 * @param {string} [req.requestId]
 * @param {number} [req.now]
 * @param {object} [opts] { env }
 */
export function useMegaStone(user, { line, stoneId, formId, choice, requestId, now = Date.now() } = {}, { env = process.env } = {}) {
  // 1. Feature and form availability.
  if (!isMegaCapabilityEnabled("unlock", env)) return fail("Mega Evolution isn't available yet.", "disabled", 403);
  const f = getMega(formId);
  if (!f) return fail("Unknown Mega form.", "unknown_form");
  const gate = megaFormGate(formId, "unlock", { env });
  if (!gate.allowed) return { ...fail(`${f.name} can't be unlocked right now.`, "blocked"), reasons: gate.reasons };

  // 2–3. The line: well-formed, normal/shiny explicit, owned, right species.
  const p = parseLineKey(line);
  if (!p) return fail("Choose a normal or shiny Pokémon line.", "bad_line");
  if (p.species !== f.species) return fail(`${f.name} isn't a form of that Pokémon.`, "wrong_species");
  if (!ownsLine(user, line)) return fail(`You don't own a ${p.variant === "shiny" ? "shiny " : ""}${f.baseSpecies}.`, "not_owned");

  // 4. The stone: a known Mega Stone, the one this form needs, and in the bag.
  if (typeof stoneId !== "string" || !STONE_ID_PATTERN.test(stoneId) || !STONE_IDS.has(stoneId)) return fail("Unknown Mega Stone.", "unknown_stone");
  if (f.prerequisite.kind !== "stone") return fail(`${f.name} isn't unlocked with a Mega Stone.`, "no_stone_form");
  if (f.prerequisite.item !== stoneId) return fail(`${getCatalogItem(stoneId)?.name ?? stoneId} doesn't unlock ${f.name}.`, "wrong_stone");
  if (getQuantity(user, stoneId) < 1) return fail(`You don't have a ${getCatalogItem(stoneId)?.name ?? stoneId}.`, "no_stone");

  // 6. Variant choice (Meowstic gender D-6, Tatsugiri appearance D-7): the
  //    chosen form IS the choice; an explicit choice must agree with it.
  const implied = variantChoiceOf(formId);
  if (choice !== undefined && choice !== null) {
    if (!implied || typeof choice !== "object" || Array.isArray(choice) || JSON.stringify(choice) !== JSON.stringify(implied)) {
      return fail("That choice doesn't match the selected Mega form.", "bad_choice");
    }
  }

  // 5 + 7. Form rules on this line: not already unlocked, variant not locked.
  const check = checkMegaUnlock(user, { line, formId });
  if (!check.ok) return fail(check.error, check.code);

  if (requestId !== undefined && requestId !== null && !REQUEST_ID_PATTERN.test(String(requestId))) return fail("Invalid request id.", "bad_request_id");

  // 8–9. Record the unlock, then consume exactly one stone — one synchronous
  //      block, so no save can run between them. Every condition either step
  //      checks was verified above; should consumption still fail, the
  //      unlock written a moment ago is taken back (user.items is only ever
  //      changed through services/inventory.js).
  const hadLine = Object.prototype.hasOwnProperty.call(user.megaUnlocks ?? {}, line);
  const hadField = Object.prototype.hasOwnProperty.call(user, "megaUnlocks");
  const rec = recordMegaUnlock(user, { line, formId, stone: stoneId, ...(requestId != null && { requestId }), at: now }, { env });
  if (!rec.ok) return fail(rec.error, rec.code);
  const spent = consumeItems(user, { [stoneId]: 1 });
  if (!spent.ok) {
    delete user.megaUnlocks[line].forms[formId];
    if (!hadLine) delete user.megaUnlocks[line];
    if (!hadField) delete user.megaUnlocks;
    return fail(spent.error, "no_stone");
  }
  return { ok: true, line, formId, name: f.name, stone: stoneId, stonesLeft: getQuantity(user, stoneId), ...(implied && { choice: implied }) };
}

// ----------------------------------------------------------
// Mega cards: virtual views of owned lines. Never stored, never counted.
// ----------------------------------------------------------
const stoneInfo = (user, stoneId) => ({ id: stoneId, name: getCatalogItem(stoneId)?.name ?? stoneId, have: getQuantity(user, stoneId) });

function formView(f, variant, env) {
  const a = megaAbility(f.ability);
  return {
    formId: f.id,
    name: f.name,
    baseSpecies: f.baseSpecies,
    species: f.species,
    types: f.types,
    typeIds: f.typeIds,
    baseStats: f.baseStats,
    bst: f.bst,
    base: { types: f.base.types, baseStats: f.base.botBaseStats ?? f.base.baseStats },
    ability: { name: f.ability, category: a?.category ?? null, rule: a?.rule ?? null, verified: !f.abilityVerification.startsWith("unverified") },
    variantChoice: f.variant && f.variant.kind !== "color" ? { [f.variant.kind]: f.variant.value } : null,
    sprite: megaSpritePath(f.id, variant),
    stone: f.prerequisite.kind === "stone" ? f.prerequisite.item : null,
    battle: megaBattleEligibility(f.id, { env }),
  };
}

/**
 * Every Mega card for the dashboard. Pure read.
 *   state "active"  – unlocked, line owned: selectable for the team (if allowed)
 *   state "dormant" – unlocked, line currently not owned: kept, not usable
 *   state "locked"  – owned line, eligible form, not unlocked: unlock preview
 * Blocked forms are never offered; an unlock record for a blocked form (only
 * possible through bad data) shows as state "blocked".
 */
export function buildMegaCards(user, { env = process.env } = {}) {
  const cards = [];
  const team = Array.isArray(user?.displayedPokemon) ? user.displayedPokemon : [];
  const teamMega = team.map((s) => ({ s, m: megaFieldOf(s) })).find((x) => x.m);
  const teamCap = isMegaCapabilityEnabled("team", env);
  const unlockCap = isMegaCapabilityEnabled("unlock", env);
  const unlocks = readMegaUnlocks(user);

  for (const [line, entry] of Object.entries(unlocks)) {
    const { species, variant } = parseLineKey(line);
    const owned = ownsLine(user, line);
    for (const formId of entry.forms) {
      const f = getMega(formId);
      const blocked = f.status !== "eligible";
      const state = blocked ? "blocked" : owned ? "active" : "dormant";
      const teamGate = megaFormGate(formId, "team", { env });
      cards.push({
        cardId: `${line}/${formId}`, line, variant, state,
        level: owned ? getTraining(user, species, variant).level : null,
        unlocked: true,
        preferred: entry.preferred === formId,
        onTeam: !!teamMega && teamMega.m === formId && Number(teamMega.s.id) === species && (teamMega.s.variant === "shiny" ? "shiny" : "normal") === variant,
        teamSelectable: state === "active" && teamCap && teamGate.allowed,
        ...formView(f, variant, env),
        requiredStone: f.prerequisite.kind === "stone" ? stoneInfo(user, f.prerequisite.item) : null,
      });
    }
  }

  // Unlock previews for owned lines.
  for (const [sid, counts] of Object.entries(user?.pokemon ?? {})) {
    const species = Number(sid);
    for (const variant of ["normal", "shiny"]) {
      if (!(Number(counts?.[variant]) > 0)) continue;
      const line = megaLineKey(species, variant);
      for (const f of megasOfSpecies(species)) {
        if (unlocks[line]?.forms.includes(f.id)) continue;
        if (!megaFormGate(f.id, "dashboard", { env }).allowed) continue; // blocked, unreleased or not allowlisted
        const check = checkMegaUnlock(user, { line, formId: f.id });
        if (!check.ok && check.code === "variant_locked") continue; // the other gender/appearance is already chosen
        const stone = stoneInfo(user, f.prerequisite.item);
        cards.push({
          cardId: `${line}/${f.id}`, line, variant, state: "locked",
          level: getTraining(user, species, variant).level,
          unlocked: false, preferred: false, onTeam: false, teamSelectable: false,
          ...formView(f, variant, env),
          requiredStone: stone,
          canUnlock: unlockCap && stone.have > 0 && megaFormGate(f.id, "unlock", { env }).allowed,
        });
      }
    }
  }
  const order = { active: 0, dormant: 1, locked: 2, blocked: 3 };
  return cards.sort((a, b) => order[a.state] - order[b.state] || a.species - b.species || a.variant.localeCompare(b.variant) || a.formId.localeCompare(b.formId));
}

/** Mega Stones in the bag (quantity > 0), with the forms each can unlock. */
export function megaStoneBag(user) {
  return allMegaStones()
    .map((s) => ({ id: s.id, name: s.name, quantity: getQuantity(user, s.id), species: s.species, forms: s.forms, restricted: s.acquisition !== "random-pool" }))
    .filter((s) => s.quantity > 0);
}

