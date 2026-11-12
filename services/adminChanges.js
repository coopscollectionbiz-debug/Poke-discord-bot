// ==========================================================
// services/adminChanges.js — Admin changes to one player record.
//
// Pure, synchronous functions over a user object (no I/O, no locks). The
// admin API (services/adminApi.js) runs them inside the player's lock and
// saves afterwards. Design: docs/design/admin-dashboard-overhaul.md.
//
//   parseChange(raw, ctx)        -> { ok, change } | { ok:false, error }
//   applyChange(user, change, ctx) mutates the user (all-or-nothing) and
//                                -> { ok, summary, before, after, warnings, ... }
//   previewChange(user, change, ctx) same result on a copy; user untouched.
//
// Rules locked in the design session:
//   • Counts change by an amount; removing more than the player has is
//     rejected with the current amount. Levels are set directly.
//   • Removing a species + Variant's last copy resets its Level and clears
//     its Team / Battle team slots. Removing the displayed trainer clears
//     displayedTrainer.
//   • A first grant of a species + Variant gets a Catch level (rolled unless
//     the admin passes one); extra copies add count only.
//   • Pokémon that aren't acquirable (unreleased generation) need
//     allowUnreleased. Items must be holdable (catalog active + inventory).
// ==========================================================

import { getSpeciesEntry, isAcquirable } from "../utils/speciesCatalog.js";
import { trainingKey, getTraining, expForLevel, rollCatchLevel } from "../utils/training.js";
import { canRemoveCopies, removeCopies, plainCount } from "./ownership.js";
import { addCopy, copiesOf, syncLine, normalizeBox } from "./box.js";
import { LEVEL_CAP } from "../utils/battle/tuning.js";
import { getCatalogItem, isHoldable } from "../catalog/items.js";
import { grantItem, consumeItem, getQuantity, MAX_QUANTITY_PER_OP } from "./inventory.js";
import { ownsTrainer, grantTrainer, revokeTrainer, normalizeTrainers, MAX_CURRENCY_GRANT } from "./assets.js";
import { toTeamObj } from "../utils/teamNormalize.js";
import { getRank } from "../utils/rankSystem.js";
import { createNewUser } from "../utils/userSchema.js";

export const KINDS = Object.freeze(["cc", "tp", "item", "pokemon", "trainer", "level", "cooldown", "reset"]);
/** Kinds that may go to many players at once (adds only). */
export const BULK_KINDS = Object.freeze(["cc", "tp", "item", "pokemon", "trainer", "cooldown"]);
export const COOLDOWNS = Object.freeze({
  daily: "Daily",
  weekly: "Weekly pack",
  quest: "Quest",
  recruit: "Recruit",
  battle: "Battle cap",
});
export const MAX_AMOUNT = Math.min(MAX_CURRENCY_GRANT, MAX_QUANTITY_PER_OP);
export const MAX_REASON = 300;
/** Rank for players under the first TP tier (getRank returns null there; matches createNewUser). */
const BASE_RANK = "Novice Trainer";

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (n) => Number(n).toLocaleString("en-US");
const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const variantOf = (v) => (v === "shiny" ? "shiny" : "normal");
const variantLabel = (v) => (v === "shiny" ? "shiny " : "");
export const speciesLabel = (id) => getSpeciesEntry(id)?.name ?? `#${id}`;

function parseAmount(v) {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (!Number.isSafeInteger(n) || n < 1) return fail("Amount must be a whole number of at least 1.");
  if (n > MAX_AMOUNT) return fail(`Amount can't be more than ${fmt(MAX_AMOUNT)}.`);
  return { ok: true, value: n };
}

function parseLevel(v) {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (!Number.isSafeInteger(n) || n < 1 || n > LEVEL_CAP) return fail(`Level must be between 1 and ${LEVEL_CAP}.`);
  return { ok: true, value: n };
}

function parseSpecies(v) {
  const id = Number(v);
  if (!Number.isInteger(id) || !getSpeciesEntry(id)) return fail("Unknown Pokémon.");
  return { ok: true, value: id };
}

/**
 * Validate and normalize a change request from the dashboard.
 * @param {object} raw
 * @param {{ trainerKeys?: Map<string,string>|Set<string> }} [ctx] - known trainer sprite keys (lower-case → key)
 */
export function parseChange(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return fail("Missing change.");
  const kind = String(raw.kind ?? "");
  if (!KINDS.includes(kind)) return fail("Unknown change type.");
  const op = raw.op === "remove" ? "remove" : raw.op === "add" ? "add" : null;

  if (kind === "cc" || kind === "tp") {
    if (!op) return fail("Choose add or remove.");
    const a = parseAmount(raw.amount);
    return a.ok ? { ok: true, change: { kind, op, amount: a.value } } : a;
  }
  if (kind === "item") {
    if (!op) return fail("Choose add or remove.");
    const itemId = String(raw.itemId ?? "");
    if (!getCatalogItem(itemId) && op === "add") return fail("Unknown item.");
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(itemId)) return fail("Unknown item.");
    const a = parseAmount(raw.amount);
    return a.ok ? { ok: true, change: { kind, op, itemId, amount: a.value } } : a;
  }
  if (kind === "pokemon") {
    if (!op) return fail("Choose add or remove.");
    const s = parseSpecies(raw.speciesId);
    if (!s.ok) return s;
    const a = parseAmount(raw.amount);
    if (!a.ok) return a;
    const change = { kind, op, speciesId: s.value, variant: variantOf(raw.variant), amount: a.value };
    if (op === "add" && raw.level != null && raw.level !== "") {
      const l = parseLevel(raw.level);
      if (!l.ok) return l;
      change.level = l.value;
    }
    return { ok: true, change };
  }
  if (kind === "trainer") {
    if (!op) return fail("Choose add or remove.");
    const raw_key = String(raw.key ?? "").trim();
    if (!raw_key || raw_key.length > 200 || /[\\/]/.test(raw_key)) return fail("Unknown trainer.");
    let key = raw_key;
    if (op === "add") {
      const known = ctx.trainerKeys;
      const hit = known instanceof Map ? known.get(raw_key.toLowerCase()) : known?.has?.(raw_key) ? raw_key : null;
      if (!hit) return fail("Unknown trainer.");
      key = hit;
    }
    return { ok: true, change: { kind, op, key } };
  }
  if (kind === "level") {
    const s = parseSpecies(raw.speciesId);
    if (!s.ok) return s;
    const l = parseLevel(raw.level);
    if (!l.ok) return l;
    return { ok: true, change: { kind, speciesId: s.value, variant: variantOf(raw.variant), level: l.value } };
  }
  if (kind === "cooldown") {
    const list = Array.isArray(raw.cooldowns) ? [...new Set(raw.cooldowns.map(String))] : [];
    if (!list.length) return fail("Choose at least one cooldown.");
    if (list.some((c) => !COOLDOWNS[c])) return fail("Unknown cooldown.");
    return { ok: true, change: { kind, cooldowns: list } };
  }
  // reset
  return { ok: true, change: { kind, confirmName: String(raw.confirmName ?? "") } };
}

/** Removals, Level changes, resets and every bulk change need a reason. */
export function needsReason(change, { bulk = false } = {}) {
  if (bulk) return true;
  return change.op === "remove" || change.kind === "level" || change.kind === "reset";
}

/** Is this change allowed in a bulk grant? */
export function isBulkable(change) {
  return BULK_KINDS.includes(change.kind) && (change.kind === "cooldown" || change.op === "add");
}

// ----------------------------------------------------------
// Team helpers
// ----------------------------------------------------------
const TEAM_FIELDS = [
  ["displayedPokemon", "Team"],
  ["battleTeam", "Battle team"],
];

/** Slots (1-based) holding this species + Variant on each team. */
export function teamSlotsOf(user, speciesId, variant) {
  const out = [];
  for (const [field, label] of TEAM_FIELDS) {
    const team = Array.isArray(user?.[field]) ? user[field] : [];
    team.forEach((entry, i) => {
      const t = toTeamObj(entry);
      if (t && t.id === speciesId && t.variant === variant) out.push({ field, label, slot: i + 1 });
    });
  }
  return out;
}

function clearTeamSlots(user, speciesId, variant) {
  for (const [field] of TEAM_FIELDS) {
    if (!Array.isArray(user[field])) continue;
    user[field] = user[field].filter((entry) => {
      const t = toTeamObj(entry);
      return !(t && t.id === speciesId && t.variant === variant);
    });
  }
}

// ----------------------------------------------------------
// Apply
// ----------------------------------------------------------
const count = (user, id, variant) => num(user?.pokemon?.[id]?.[variant]);

/**
 * Apply one change to a user record, in place. All-or-nothing: on failure
 * the record is unchanged.
 * @param {object} user
 * @param {object} change - from parseChange
 * @param {{ allowUnreleased?: boolean, rand?: () => number, now?: number, trainerName?: (key:string)=>string, playerName?: string }} [ctx]
 */
export function applyChange(user, change, ctx = {}) {
  if (!user || typeof user !== "object") return fail("Player not found.");
  const warnings = [];
  const now = ctx.now ?? Date.now();

  switch (change.kind) {
    case "cc":
    case "tp": {
      const label = change.kind.toUpperCase();
      const before = num(user[change.kind]);
      if (change.op === "remove" && change.amount > before) return fail(`They have ${fmt(before)} ${label}.`, { current: before });
      const after = change.op === "add" ? before + change.amount : before - change.amount;
      if (!Number.isSafeInteger(after)) return fail("Balance would overflow.");
      user[change.kind] = after;
      const result = { ok: true, summary: `${change.op === "add" ? "Add" : "Remove"} ${fmt(change.amount)} ${label}`, before, after, warnings };
      if (change.kind === "tp") {
        const fromRank = user.rank || getRank(before) || BASE_RANK;
        const toRank = getRank(after) || BASE_RANK;
        user.rank = toRank;
        if (toRank !== fromRank) {
          warnings.push(`Rank changes from ${fromRank} to ${toRank}.`);
          result.rankChanged = { from: fromRank, to: toRank };
        }
      }
      return result;
    }

    case "item": {
      const entry = getCatalogItem(change.itemId);
      const name = entry?.name ?? change.itemId;
      const before = getQuantity(user, change.itemId);
      if (change.op === "add") {
        if (!isHoldable(change.itemId)) return fail(`${name} can't be granted.`);
        const r = grantItem(user, change.itemId, change.amount);
        if (!r.ok) return fail(r.error.replace(/^You can't hold/, "They can't hold"));
        return { ok: true, summary: `Add ${fmt(change.amount)} × ${name}`, before, after: r.quantity, warnings };
      }
      if (change.amount > before) return fail(`They have ${fmt(before)} × ${name}.`, { current: before });
      const r = consumeItem(user, change.itemId, change.amount);
      if (!r.ok) return fail(r.error);
      return { ok: true, summary: `Remove ${fmt(change.amount)} × ${name}`, before, after: before - change.amount, warnings };
    }

    case "pokemon": {
      const { speciesId: id, variant, amount } = change;
      const name = `${variantLabel(variant)}${speciesLabel(id)}`;
      const before = count(user, id, variant);
      if (change.op === "add") {
        if (!isAcquirable(id) && !ctx.allowUnreleased) {
          return fail(`${speciesLabel(id)} isn't released yet. Turn on "Show unreleased" to grant it for testing.`);
        }
        if (!isAcquirable(id)) warnings.push(`${speciesLabel(id)} isn't released yet.`);
        const after = before + amount;
        if (!Number.isSafeInteger(after)) return fail("Count would overflow.");
        const result = { ok: true, summary: `Add ${fmt(amount)} × ${name}`, before, after, warnings };
        // Each granted copy is its own Pokémon (docs/adr/0001): it rolls a
        // Catch level unless the admin set one, and registers in the Pokédex.
        const rand = ctx.rand ?? Math.random;
        let best = 0;
        for (let i = 0; i < amount; i++) {
          const made = addCopy(user, id, variant, { exp: change.level != null ? expForLevel(change.level) : null, rand });
          best = Math.max(best, made.level);
        }
        result.level = change.level ?? best;
        result.levelRolled = change.level == null;
        return result;
      }
      if (amount > before) return fail(`They have ${fmt(before)} × ${name}.`, { current: before });
      // TM system (services/ownership.js): admin removals take untrained copies
      // only; a copy with TM-trained moves is never removed this way (fail closed).
      const can = canRemoveCopies(user, { id, variant, n: amount, allowTeam: true });
      if (!can.ok) {
        const untrained = plainCount(user, id, variant);
        return fail(`${fmt(before - untrained)} of their ${fmt(before)} × ${name} have TM-trained moves and can't be removed here. At most ${fmt(untrained)} can be removed.`, { current: before, untrained });
      }
      const after = before - amount;
      const result = { ok: true, summary: `Remove ${fmt(amount)} × ${name}`, before, after, warnings };
      if (after === 0) {
        const level = getTraining(user, id, variant).level;
        for (const s of teamSlotsOf(user, id, variant)) warnings.push(`Clears ${s.label} slot ${s.slot}.`);
        warnings.push(`Resets Lv ${level} (their last ${name}).`);
        result.levelReset = level;
        clearTeamSlots(user, id, variant);
      }
      const removed = removeCopies(user, { id, variant, n: amount, allowTeam: true }); // lowest Level first; the Pokédex keeps the species
      if (!removed.ok) return fail(removed.error ?? "Couldn't remove those copies.");
      return result;
    }

    case "trainer": {
      const label = ctx.trainerName?.(change.key) ?? change.key;
      const owned = ownsTrainer(user, change.key);
      if (change.op === "add") {
        if (owned) return fail(`They already own ${label}.`);
        grantTrainer(user, change.key);
        return { ok: true, summary: `Add trainer ${label}`, before: "not owned", after: "owned", warnings };
      }
      if (!owned) return fail(`They don't own ${label}.`);
      const displayed = String(user.displayedTrainer ?? "").toLowerCase() === change.key.toLowerCase();
      if (displayed) warnings.push("It's their displayed trainer; their trainer card will fall back to the default.");
      revokeTrainer(user, change.key);
      if (displayed) user.displayedTrainer = null;
      return { ok: true, summary: `Remove trainer ${label}`, before: "owned", after: "not owned", warnings };
    }

    case "level": {
      const { speciesId: id, variant, level } = change;
      const name = `${variantLabel(variant)}${speciesLabel(id)}`;
      if (count(user, id, variant) <= 0) return fail(`They don't own ${name}.`);
      // One copy: the one named by uid, else their best (the Level shown for the line).
      normalizeBox(user);
      const copy = change.uid ? copiesOf(user, id, variant).find((c) => c.uid === change.uid) : copiesOf(user, id, variant)[0];
      if (!copy) return fail(`That ${name} no longer exists.`);
      const before = copy.level;
      if (before === level) return fail(`${name} is already Lv ${level}.`);
      user.box[copy.uid].exp = expForLevel(level);
      syncLine(user, id, variant);
      return { ok: true, summary: `Set ${name} to Lv ${level}`, before: `Lv ${before}`, after: `Lv ${level}`, warnings };
    }

    case "cooldown": {
      const before = {};
      for (const c of change.cooldowns) before[c] = cooldownState(user, c, now);
      for (const c of change.cooldowns) resetCooldown(user, c);
      const after = {};
      for (const c of change.cooldowns) after[c] = cooldownState(user, c, now);
      const names = change.cooldowns.map((c) => COOLDOWNS[c]).join(", ");
      return { ok: true, summary: `Reset ${names}`, before, after, warnings };
    }

    case "reset": {
      const expected = String(ctx.playerName ?? user.name ?? "").trim().toLowerCase();
      if (!expected || change.confirmName.trim().toLowerCase() !== expected) {
        return fail(`Type the player's name (${ctx.playerName ?? user.name ?? ""}) to confirm.`);
      }
      if (user.pendingWager) {
        const at = num(user.pendingWager.expiresAt);
        return fail(`They have an open wager offer${at ? ` until ${new Date(at).toISOString().slice(11, 16)} UTC` : ""}. Try again after it ends.`);
      }
      const before = clone(user);
      const fresh = createNewUser(user.id ?? ctx.userId, user.name);
      for (const k of Object.keys(user)) delete user[k];
      Object.assign(user, fresh);
      warnings.push("Everything is wiped: CC, TP, items, Pokémon, Levels, trainers, Teams, achievements and battle records.");
      return { ok: true, summary: "Reset player", before, after: "new player", warnings, snapshot: true };
    }

    default:
      return fail("Unknown change type.");
  }
}

/** Run a change on a copy of the user; the user is not modified. */
export function previewChange(user, change, ctx = {}) {
  return applyChange(clone(user), change, ctx);
}

// ----------------------------------------------------------
// Cooldowns
// ----------------------------------------------------------
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A short, readable state for one cooldown. */
export function cooldownState(user, c, now = Date.now()) {
  if (c === "daily") return utcDay(num(user.lastDaily) || 0) === utcDay(now) && num(user.lastDaily) > 0 ? "claimed today" : "ready";
  if (c === "weekly") return user.weeklyPackClaimed ? "claimed this week" : "ready";
  if (c === "quest") return num(user.lastQuest) > 0 ? `last ${new Date(num(user.lastQuest)).toISOString().slice(0, 16).replace("T", " ")} UTC` : "ready";
  if (c === "recruit") return num(user.lastRecruit) > 0 ? `last ${new Date(num(user.lastRecruit)).toISOString().slice(0, 16).replace("T", " ")} UTC` : "ready";
  if (c === "battle") {
    const b = user.battle;
    return b && b.day === utcDay(now) ? `${num(b.started)} started today` : "0 started today";
  }
  return "";
}

function resetCooldown(user, c) {
  if (c === "daily") user.lastDaily = 0; // streak kept
  else if (c === "weekly") user.weeklyPackClaimed = false;
  else if (c === "quest") user.lastQuest = 0;
  else if (c === "recruit") user.lastRecruit = 0;
  else if (c === "battle" && user.battle && typeof user.battle === "object") {
    user.battle.started = 0;
    user.battle.vs = {};
  }
}

// ----------------------------------------------------------
// Bulk filters
// ----------------------------------------------------------
/** Last active (ms): stored lastActiveAt, else the latest claim. */
export function lastActiveOf(u) {
  const stored = num(u?.lastActiveAt);
  const claims = [u?.lastDaily, u?.lastRecruit, u?.lastQuest, u?.lastWeeklyPack].map(num).filter((n) => n > 0);
  return Math.max(stored, ...claims, 0);
}

const optNum = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);

/**
 * Normalize bulk filters. Every filter is optional; they combine with AND.
 * { ccMin, ccMax, tpMin, tpMax, activeDays, onboardedOnly, owns: {kind, id, variant, has} }
 */
export function parseFilters(raw = {}) {
  const f = {};
  for (const k of ["ccMin", "ccMax", "tpMin", "tpMax", "activeDays"]) {
    const v = optNum(raw[k]);
    if (Number.isNaN(v) || (v != null && v < 0)) return fail(`${k} must be a number of 0 or more.`);
    if (v != null) f[k] = v;
  }
  f.onboardedOnly = raw.onboardedOnly !== false;
  if (raw.owns && typeof raw.owns === "object" && raw.owns.id != null && raw.owns.id !== "") {
    const kind = raw.owns.kind === "item" ? "item" : "pokemon";
    if (kind === "pokemon" && !getSpeciesEntry(raw.owns.id)) return fail("Unknown Pokémon in filter.");
    if (kind === "item" && !getCatalogItem(String(raw.owns.id))) return fail("Unknown item in filter.");
    f.owns = { kind, id: kind === "pokemon" ? Number(raw.owns.id) : String(raw.owns.id), variant: raw.owns.variant === "shiny" ? "shiny" : raw.owns.variant === "normal" ? "normal" : "any", has: raw.owns.has !== false };
  }
  return { ok: true, filters: f };
}

export function matchesFilters(u, f, now = Date.now()) {
  if (!u || typeof u !== "object") return false;
  if (f.onboardedOnly && !u.onboardingComplete) return false;
  const cc = num(u.cc);
  const tp = num(u.tp);
  if (f.ccMin != null && cc < f.ccMin) return false;
  if (f.ccMax != null && cc > f.ccMax) return false;
  if (f.tpMin != null && tp < f.tpMin) return false;
  if (f.tpMax != null && tp > f.tpMax) return false;
  if (f.activeDays != null) {
    const last = lastActiveOf(u);
    if (!last || now - last > f.activeDays * 86_400_000) return false;
  }
  if (f.owns) {
    let has;
    if (f.owns.kind === "item") has = getQuantity(u, f.owns.id) > 0;
    else {
      const e = u.pokemon?.[f.owns.id];
      has = f.owns.variant === "any" ? num(e?.normal) + num(e?.shiny) > 0 : num(e?.[f.owns.variant]) > 0;
    }
    if (has !== f.owns.has) return false;
  }
  return true;
}

export { normalizeTrainers };
