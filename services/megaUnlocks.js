// ==========================================================
// services/megaUnlocks.js — the additive, line-bound Mega unlock schema
// (Phase M0). Pure, synchronous functions; nothing here is wired into a
// command, route, load or save path yet (Phase M1 does that, inside
// runInventoryTransaction together with consuming the stone).
//
// Shape (absent on every existing player; readers default to "none"):
//
//   user.megaUnlocks = {
//     "6:normal": {                                   // line = species:variant (D-1)
//       forms: {
//         "mega-charizard-x": { at: 1762732800000, stone: "megastone_charizarditex", req: "a1b2c3d4" },
//         "mega-charizard-y": { at: 1762819200000, stone: "megastone_charizarditey" }
//       },
//       preferred: "mega-charizard-x"                 // or null
//     },
//     "678:shiny": { forms: { "mega-meowstic-f": { at, stone, choice: { gender: "f" } } }, preferred: null }
//   }
//
// Rules:
//   • Unlocks are never deleted by gameplay: losing every copy of a line
//     leaves them dormant; they come back when the line is owned again.
//   • Normal and shiny lines are independent.
//   • A line may hold several forms (Charizard X and Y; Absol and Absol Z).
//   • Variant-bound Megas (D-6 Meowstic gender, D-7 Tatsugiri appearance) are
//     exclusive per line: the first choice is permanent.
//   • Malformed data is quarantined into user.megaLegacy, never silently dropped.
//   • Nothing here creates user.megaUnlocks on a player who doesn't have it.
// ==========================================================

import { getMega, megasOfSpecies } from "../utils/megas.js";
import { isMegaEvolutionEnabled } from "../config/features.js";

export const LINE_PATTERN = /^([1-9]\d{0,3}):(normal|shiny)$/;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const fail = (error, code) => ({ ok: false, error, code });

export const megaLineKey = (species, variant) => `${Number(species)}:${variant === "shiny" || variant === true ? "shiny" : "normal"}`;
export function parseLineKey(line) {
  const m = LINE_PATTERN.exec(String(line));
  return m ? { species: Number(m[1]), variant: m[2] } : null;
}

/** Does the player own at least one copy of this line? */
export function ownsLine(user, line) {
  const p = parseLineKey(line);
  if (!p) return false;
  const counts = user?.pokemon?.[p.species];
  return Number.isSafeInteger(counts?.[p.variant]) && counts[p.variant] > 0;
}

function validRecord(formId, rec, species) {
  const f = getMega(formId);
  if (!f || f.species !== species) return false;
  if (!isPlainObject(rec) || !Number.isSafeInteger(rec.at) || rec.at < 0) return false;
  if (rec.stone !== null && rec.stone !== undefined && typeof rec.stone !== "string") return false;
  if (rec.req !== undefined && !REQUEST_ID_PATTERN.test(String(rec.req))) return false;
  if (rec.choice !== undefined && !isPlainObject(rec.choice)) return false;
  return true;
}

/**
 * Read-only view of a player's unlocks: only well-formed entries, as plain
 * copies. Missing or malformed data reads as "nothing unlocked".
 * @returns {{ [line]: { forms: string[], preferred: string|null } }}
 */
export function readMegaUnlocks(user) {
  const raw = user?.megaUnlocks;
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const line of Object.keys(raw)) {
    const p = parseLineKey(line);
    if (!p || DANGEROUS.has(line)) continue;
    const entry = raw[line];
    if (!isPlainObject(entry) || !isPlainObject(entry.forms)) continue;
    const forms = Object.keys(entry.forms).filter((id) => !DANGEROUS.has(id) && validRecord(id, entry.forms[id], p.species)).sort();
    if (!forms.length) continue;
    out[line] = { forms, preferred: forms.includes(entry.preferred) ? entry.preferred : null };
  }
  return out;
}

/** Unlocked form ids on one line ([] if none or malformed). */
export const unlockedForms = (user, line) => readMegaUnlocks(user)[line]?.forms ?? [];

/** Unlocked forms on lines the player owns right now (dormant lines excluded). */
export function activeMegaForms(user) {
  return Object.entries(readMegaUnlocks(user))
    .filter(([line]) => ownsLine(user, line))
    .flatMap(([line, e]) => e.forms.map((form) => ({ line, form })));
}

/**
 * Repair user.megaUnlocks IN PLACE. Idempotent. Never creates the field and
 * never drops data silently: anything it can't keep goes to user.megaLegacy
 * as { key, value, reason, at }.
 * @returns {{ changed: boolean, quarantined: number }}
 */
export function normalizeMegaUnlocks(user, now = Date.now()) {
  if (!user || typeof user !== "object" || !own(user, "megaUnlocks")) return { changed: false, quarantined: 0 };
  let changed = false;
  let quarantined = 0;
  const q = (key, value, reason) => {
    if (!Array.isArray(user.megaLegacy)) user.megaLegacy = [];
    user.megaLegacy.push({ key, value: safeJson(value), reason, at: new Date(now).toISOString() });
    quarantined++;
    changed = true;
  };
  if (!isPlainObject(user.megaUnlocks)) {
    q("(megaUnlocks)", user.megaUnlocks, "megaUnlocks was not an object");
    user.megaUnlocks = {};
    return { changed, quarantined };
  }
  for (const line of Object.keys(user.megaUnlocks)) {
    const entry = user.megaUnlocks[line];
    const p = parseLineKey(line);
    if (!p || DANGEROUS.has(line)) { q(line, entry, "invalid line key"); delete user.megaUnlocks[line]; continue; }
    if (!isPlainObject(entry) || !isPlainObject(entry.forms)) { q(line, entry, "line entry is not { forms: {...} }"); delete user.megaUnlocks[line]; continue; }
    for (const id of Object.keys(entry.forms)) {
      if (!validRecord(id, entry.forms[id], p.species) || DANGEROUS.has(id)) {
        q(`${line}/${id}`, entry.forms[id], getMega(id) ? "malformed unlock record" : "unknown Mega form for this species");
        delete entry.forms[id];
      }
    }
    if (entry.preferred !== undefined && entry.preferred !== null && !own(entry.forms, entry.preferred)) {
      q(`${line}/preferred`, entry.preferred, "preferred form is not unlocked");
      entry.preferred = null;
    }
    if (entry.preferred === undefined) { entry.preferred = null; changed = true; }
    if (!Object.keys(entry.forms).length) { delete user.megaUnlocks[line]; changed = true; }
  }
  return { changed, quarantined };
}
const safeJson = (v) => {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

/** The variant choice an unlock implies (D-6 gender, D-7 appearance), or null. */
export function variantChoiceOf(formId) {
  const v = getMega(formId)?.variant;
  if (!v || v.kind === "color") return null;
  return { [v.kind]: v.value };
}

/**
 * Pure rule check for unlocking `formId` on `line`. No flag check and no item
 * check: M1's transaction adds those. Returns { ok: true } or a refusal.
 */
export function checkMegaUnlock(user, { line, formId }) {
  const p = parseLineKey(line);
  if (!p) return fail("Invalid Pokémon line.", "bad_line");
  const f = getMega(formId);
  if (!f) return fail("Unknown Mega form.", "unknown_form");
  if (f.species !== p.species) return fail(`${f.name} isn't a form of that Pokémon.`, "wrong_species");
  if (f.status !== "eligible") return fail(`${f.name} isn't available.`, "blocked");
  if (!ownsLine(user, line)) return fail("You don't own that Pokémon.", "not_owned");
  const have = unlockedForms(user, line);
  if (have.includes(formId)) return fail(`${f.name} is already unlocked for this Pokémon.`, "already_unlocked");
  if (f.variant && f.variant.kind !== "color") {
    const clash = have.map(getMega).find((g) => g?.variant?.kind === f.variant.kind && g.variant.value !== f.variant.value);
    if (clash) return fail(`This ${f.baseSpecies} already has its ${f.variant.kind} set (${clash.name}).`, "variant_locked");
  }
  return { ok: true };
}

/**
 * Write one unlock record. Synchronous and all-or-nothing. Refuses while
 * MEGA_EVOLUTION_ENABLED is off (Phase M0 never turns it on). It does NOT
 * consume a stone: M1 calls it inside runInventoryTransaction right after
 * consumeItems, so the stone and the unlock land in the same snapshot.
 */
export function recordMegaUnlock(user, { line, formId, stone = null, requestId, at = Date.now() }, { env = process.env } = {}) {
  if (!isMegaEvolutionEnabled(env)) return fail("Mega Evolution isn't available yet.", "disabled");
  const check = checkMegaUnlock(user, { line, formId });
  if (!check.ok) return check;
  if (requestId !== undefined && !REQUEST_ID_PATTERN.test(String(requestId))) return fail("Invalid request id.", "bad_request_id");
  const f = getMega(formId);
  if (f.prerequisite.kind === "stone" && stone !== f.prerequisite.item) return fail(`${f.name} needs ${f.prerequisite.item}.`, "wrong_stone");
  if (!isPlainObject(user.megaUnlocks)) user.megaUnlocks = {};
  const entry = isPlainObject(user.megaUnlocks[line]) ? user.megaUnlocks[line] : (user.megaUnlocks[line] = { forms: {}, preferred: null });
  if (!isPlainObject(entry.forms)) entry.forms = {};
  const choice = variantChoiceOf(formId);
  entry.forms[formId] = { at, stone, ...(requestId !== undefined && { req: String(requestId) }), ...(choice && { choice }) };
  if (entry.preferred === undefined) entry.preferred = null;
  return { ok: true, line, formId };
}

/** Choose (or clear with null) the preferred Mega form of a line. Flag-gated. */
export function setPreferredMega(user, line, formId, { env = process.env } = {}) {
  if (!isMegaEvolutionEnabled(env)) return fail("Mega Evolution isn't available yet.", "disabled");
  if (!parseLineKey(line)) return fail("Invalid Pokémon line.", "bad_line");
  const entry = user?.megaUnlocks?.[line];
  if (formId === null) {
    if (isPlainObject(entry)) entry.preferred = null;
    return { ok: true, line, preferred: null };
  }
  if (!unlockedForms(user, line).includes(formId)) return fail("That Mega form isn't unlocked for this Pokémon.", "not_unlocked");
  entry.preferred = formId;
  return { ok: true, line, preferred: formId };
}

/** Lines of a species with any unlock, for display (includes dormant lines). */
export const megaLinesOfSpecies = (user, species) =>
  Object.keys(readMegaUnlocks(user)).filter((line) => parseLineKey(line).species === Number(species) && megasOfSpecies(species).length);
