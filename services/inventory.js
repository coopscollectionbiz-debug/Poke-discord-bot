// ==========================================================
// services/inventory.js — unified inventory (Release B)
//
// Canonical storage is unchanged: user.items = { [itemId]: integer >= 0 }.
// The catalog (catalog/items.js) says which ids exist and which are
// obtainable. This module is the ONE place that changes user.items.
//
// Pure functions (getQuantity / grantItem / consumeItem / consumeItems /
// normalizeInventory / auditInventory / listInventory) are synchronous and
// all-or-nothing: on failure they change nothing. Call them inside the
// user's lock, between your awaits and the save.
//
// runInventoryTransaction() wraps one mutation end to end:
//   1 validate (caller) → 2 lock (A1 lockUser) → 3 replay check + mutate
//   (sync, all-or-nothing) → 4 save (A1/A2 saveAndAck: true = on disk)
//   → 5 acknowledge (saved / "saved with a delay") → 6 on failure nothing
//   changed; on a failed SAVE the change stays in memory and the A2 queue
//   keeps retrying (never rolled back, so memory and disk can't diverge).
// ==========================================================

import { getCatalogItem, isHoldable, CATEGORIES, RARITIES, ABSOLUTE_MAX_STACK } from "../catalog/items.js";
import { isMegaCapabilityEnabled, isHeldItemCapabilityEnabled } from "../config/features.js";

/** Largest quantity a single grant/consume may move. */
export const MAX_QUANTITY_PER_OP = 1_000_000;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

// ----------------------------------------------------------
// Validation
// ----------------------------------------------------------
/** A positive whole number within the per-operation bound. */
export function validateQuantity(q) {
  if (typeof q === "string" && /^\d+$/.test(q.trim())) q = Number(q.trim());
  if (typeof q !== "number" || !Number.isSafeInteger(q)) return fail("Quantity must be a whole number.");
  if (q < 1) return fail("Quantity must be at least 1.");
  if (q > MAX_QUANTITY_PER_OP) return fail(`Quantity can't exceed ${MAX_QUANTITY_PER_OP.toLocaleString()}.`);
  return { ok: true, value: q };
}

/**
 * An item that may be held in user.items today (active + inventory-stored).
 * Held items (catalog/heldItems.js) are also gated by the held-item feature
 * flags for that player, so they can't be granted (admin, rewards) before
 * launch. opts: { env, userId }.
 */
export function validateHoldableItem(id, { env = process.env, userId = null } = {}) {
  const entry = getCatalogItem(id);
  if (!entry) return fail("Unknown item.");
  if (entry.status !== "active") return fail(`${entry.name} isn't available yet.`);
  if (entry.storage !== "inventory") return fail(`${entry.name} can't be kept in the bag.`);
  if (entry.category === "held" && !isHeldItemCapabilityEnabled("dashboard", env, userId)) return fail(`${entry.name} isn't available yet.`);
  return { ok: true, entry };
}

// ----------------------------------------------------------
// Reads
// ----------------------------------------------------------
/** Owned count (0 for missing, malformed or prototype keys). */
export function getQuantity(user, id) {
  const items = user?.items;
  if (!items || typeof items !== "object" || typeof id !== "string" || DANGEROUS_KEYS.has(id) || !own(items, id)) return 0;
  const v = items[id];
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

export const hasItem = (user, id, qty = 1) => getQuantity(user, id) >= qty;

// ----------------------------------------------------------
// Writes (synchronous, all-or-nothing)
// ----------------------------------------------------------
function ensureItems(user) {
  if (!user.items || typeof user.items !== "object" || Array.isArray(user.items)) user.items = {};
  return user.items;
}

/**
 * Add `qty` of an obtainable item. Refuses unknown, future ("defined") and
 * non-inventory items, bad quantities, and anything over the stack limit.
 * @returns {{ok:true, quantity:number} | {ok:false, error:string}}
 */
export function grantItem(user, id, qty, { env = process.env } = {}) {
  if (!user || typeof user !== "object") return fail("No player record.");
  const item = validateHoldableItem(id, { env, userId: user.id ?? null });
  if (!item.ok) return item;
  const q = validateQuantity(qty);
  if (!q.ok) return q;
  const max = Math.min(item.entry.maxStack ?? ABSOLUTE_MAX_STACK, ABSOLUTE_MAX_STACK);
  const next = getQuantity(user, id) + q.value;
  if (next > max) {
    if (item.entry.category === "held") return fail(`You already own ${item.entry.name}.`, { max, code: "already_owned" });
    return fail(`You can't hold more than ${max.toLocaleString()} ${item.entry.name}.`, { max });
  }
  ensureItems(user)[id] = next;
  return { ok: true, quantity: next };
}

/**
 * Remove `qty`. Works for any id the player holds (including legacy ids not
 * in the catalog), but never goes below zero.
 * @returns {{ok:true, quantity:number} | {ok:false, error:string}}
 */
export function consumeItem(user, id, qty) {
  return consumeItems(user, { [id]: qty });
}

/**
 * Remove several items at once: either ALL are removed or NOTHING is
 * (e.g. a shiny evolution spends stones AND dust).
 * Zero amounts are ignored (callers often pass "dust: 0").
 */
export function consumeItems(user, costs) {
  if (!user || typeof user !== "object") return fail("No player record.");
  if (!costs || typeof costs !== "object") return fail("Nothing to consume.");
  const plan = [];
  for (const id of Object.keys(costs)) {
    if (DANGEROUS_KEYS.has(id) || typeof id !== "string") return fail("Unknown item.");
    const raw = costs[id];
    if (raw === 0) continue;
    const q = validateQuantity(raw);
    if (!q.ok) return q;
    const have = getQuantity(user, id);
    if (have < q.value) {
      const name = getCatalogItem(id)?.name ?? id;
      return fail(`Not enough ${name}. Requires ${q.value}, you have ${have}.`, { item: id, required: q.value, available: have });
    }
    plan.push([id, have - q.value]);
  }
  const items = ensureItems(user);
  for (const [id, left] of plan) items[id] = left;
  return { ok: true, quantity: plan.length === 1 ? plan[0][1] : undefined };
}

// ----------------------------------------------------------
// Normalization (idempotent, never silently drops a value)
// ----------------------------------------------------------
/**
 * Make user.items a plain map of non-negative integers, IN PLACE.
 * Values that can't be kept as-is are recorded once in user.itemsLegacy
 * ([{ key, value, reason }]) so nothing disappears silently:
 *   • non-numeric / non-finite → moved out of items into itemsLegacy
 *   • negative → 0, fractional → floored (original recorded)
 *   • "__proto__"/"constructor"/"prototype" keys → moved out
 * Unknown (non-catalog) ids with valid counts are KEPT in items.
 * evolution_stone always exists (legacy guarantee the dashboard relies on).
 * @returns {{ changed: boolean, quarantined: number }}
 */
export function normalizeInventory(user) {
  if (!user || typeof user !== "object") return { changed: false, quarantined: 0 };
  let changed = false;
  let quarantined = 0;

  const raw = user.items;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null && !(typeof raw === "object" && !Array.isArray(raw))) {
      record(user, "(items)", raw, "items was not an object");
      quarantined++;
    } else if (Array.isArray(raw) && raw.length) {
      record(user, "(items)", raw, "items was an array");
      quarantined++;
    }
    user.items = {};
    changed = true;
  }
  const items = user.items;

  for (const key of Object.keys(items)) {
    const v = items[key];
    if (DANGEROUS_KEYS.has(key)) {
      record(user, key, v, "reserved key");
      delete items[key];
      quarantined++;
      changed = true;
      continue;
    }
    if (Number.isSafeInteger(v) && v >= 0) continue; // already canonical
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      record(user, key, v, "not a number");
      delete items[key];
      quarantined++;
      changed = true;
      continue;
    }
    const fixed = Math.min(Math.max(0, Math.floor(n)), ABSOLUTE_MAX_STACK);
    if (fixed !== v) {
      if (n < 0 || !Number.isInteger(n) || n > ABSOLUTE_MAX_STACK || typeof v !== "number") {
        record(user, key, v, n < 0 ? "negative" : n > ABSOLUTE_MAX_STACK ? "too large" : !Number.isInteger(n) ? "fractional" : "numeric string");
      }
      items[key] = fixed;
      changed = true;
    }
  }

  if (!Number.isSafeInteger(items.evolution_stone)) {
    items.evolution_stone = 0;
    changed = true;
  }
  return { changed, quarantined };
}

function record(user, key, value, reason) {
  if (!Array.isArray(user.itemsLegacy)) user.itemsLegacy = [];
  const json = safeJson(value);
  if (user.itemsLegacy.some((e) => e && e.key === key && e.reason === reason && e.value === json)) return;
  user.itemsLegacy.push({ key: String(key), value: json, reason, at: new Date().toISOString() });
}
const safeJson = (v) => {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

// ----------------------------------------------------------
// Audit (report-only)
// ----------------------------------------------------------
export function auditInventory(user) {
  const problems = [];
  const items = user?.items;
  if (!items || typeof items !== "object" || Array.isArray(items)) return ["items is not an object"];
  for (const key of Object.keys(items)) {
    const v = items[key];
    if (DANGEROUS_KEYS.has(key)) problems.push(`reserved key ${key}`);
    else if (!Number.isSafeInteger(v) || v < 0) problems.push(`items.${key} is not a non-negative integer`);
    else {
      const e = getCatalogItem(key);
      if (e && v > (e.maxStack ?? ABSOLUTE_MAX_STACK)) problems.push(`items.${key} exceeds its stack limit`);
    }
  }
  return problems;
}

// ----------------------------------------------------------
// Listing (what the Discord command and dashboard show)
// ----------------------------------------------------------
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));

// Mega Stones stay "defined" (never grantable) but become usable from the
// dashboard when the Mega "unlock" capability is on (config/features.js).
const isUsableMegaStone = (entry, env) => !!entry?.mega && isMegaCapabilityEnabled("unlock", env);

function usageText(entry, env = process.env) {
  if (!entry) return "Not recognised by this version of the bot.";
  if (isUsableMegaStone(entry, env)) return "Use it on the dashboard (Mega Evolution) to permanently unlock its Mega form for one of your Pokémon.";
  if (entry.status !== "active") return "Not usable yet.";
  if (entry.id === "evolution_stone") return "Used when evolving a Pokémon on the dashboard.";
  if (entry.id === "shiny_dust") return "Used on the dashboard to make a Pokémon shiny, or to evolve a shiny one.";
  if (entry.category === "held") return "A permanent unlock: equip it on the dashboard Teams page (one Pokémon per team).";
  return "No direct use.";
}

/**
 * The player's bag as display rows (never the raw record).
 * @param {object} user
 * @param {{ category?: string }} [opts]
 * @returns {Array<{id,name,description,category,categoryLabel,rarity,quantity,status,known,usable,usage}>}
 */
export function listInventory(user, { category = null, env = process.env } = {}) {
  const items = user?.items && typeof user.items === "object" && !Array.isArray(user.items) ? user.items : {};
  const rows = [];
  for (const id of Object.keys(items)) {
    if (DANGEROUS_KEYS.has(id)) continue;
    const quantity = getQuantity(user, id);
    if (quantity <= 0) continue;
    const entry = getCatalogItem(id);
    const cat = entry?.category ?? "special";
    if (category && cat !== category) continue;
    rows.push({
      id,
      name: entry?.name ?? id,
      description: entry?.description ?? "An item from an earlier version of the bot.",
      category: cat,
      categoryLabel: CATEGORIES[cat]?.label ?? cat,
      rarity: entry?.rarity ?? "common",
      quantity,
      status: entry?.status ?? "unknown",
      known: !!entry,
      usable: (!!entry && entry.status === "active" && (entry.id === "evolution_stone" || entry.id === "shiny_dust")) || isUsableMegaStone(entry, env),
      usage: usageText(entry, env),
      icon: entry?.icon ?? null,
    });
  }
  rows.sort(
    (a, b) =>
      (CATEGORIES[a.category]?.order ?? 99) - (CATEGORIES[b.category]?.order ?? 99) ||
      (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) ||
      a.name.localeCompare(b.name)
  );
  return rows;
}

// ----------------------------------------------------------
// Replay protection (duplicate dashboard clicks / retried requests)
// ----------------------------------------------------------
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/; // no "_" → can't spell __proto__
const REQUEST_KEEP = 50;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_HARD_CAP = 200;

/**
 * Look up a request id. Returns the stored result for a replay, a conflict
 * if the same id was used for a different payload, or null if new.
 */
export function findRequest(user, requestId, payloadKey, now = Date.now()) {
  const list = Array.isArray(user?.itemRequests) ? user.itemRequests : [];
  const hit = list.find((r) => r && r.id === requestId && now - (r.at || 0) < REQUEST_TTL_MS);
  if (!hit) return null;
  if (hit.payload !== payloadKey) return { conflict: true };
  return { replay: true, result: hit.result, entry: hit };
}

/**
 * Record a request. `durable` starts false and is set only after a save of a
 * snapshot that contains this change returns true. The entry lives in the
 * player record, so it is saved (and restored after a restart) together
 * with the change it describes: if the entry exists after a restart, the
 * change does too.
 */
export function rememberRequest(user, requestId, payloadKey, result, now = Date.now()) {
  const list = (Array.isArray(user.itemRequests) ? user.itemRequests : []).filter((r) => r && now - (r.at || 0) < REQUEST_TTL_MS);
  const entry = { id: requestId, payload: payloadKey, result, at: now, durable: false };
  list.push(entry);
  // Trim to REQUEST_KEEP by dropping the oldest CONFIRMED entries first: an
  // entry whose save is still pending must survive so a retry of that
  // request can't apply twice. Hard cap REQUEST_HARD_CAP (24 h TTL anyway).
  while (list.length > REQUEST_KEEP) {
    const i = list.findIndex((r) => r.durable === true);
    if (i < 0) break;
    list.splice(i, 1);
  }
  user.itemRequests = list.slice(-REQUEST_HARD_CAP);
  return entry;
}

// ----------------------------------------------------------
// One locked, saved, acknowledged mutation
// ----------------------------------------------------------
/**
 * @param {object} args
 * @param {object} args.trainerData
 * @param {string} args.userId
 * @param {(id:string, fn:Function) => Promise<any>} args.lock   - A1 lockUser
 * @param {(data:object) => Promise<{saved:boolean, note:string}>} args.save - A1/A2 saveAndAck
 * @param {(user:object) => ({ok:boolean, error?:string} & object)} args.mutate - sync, all-or-nothing
 * @param {string|null} [args.requestId] - client-generated id; repeats return the first result
 * @param {string} [args.payloadKey]     - identifies what the request asked for
 * @returns {Promise<{ok:boolean, error?:string, replayed?:boolean, saved?:boolean, note?:string, result?:object}>}
 */
export async function runInventoryTransaction({ trainerData, userId, lock, save, mutate, requestId = null, payloadKey = "" }) {
  if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return fail("Invalid request id.");
  return lock(String(userId), async () => {
    const user = trainerData[userId];
    if (!user) return fail("User not found.");

    if (requestId != null) {
      const seen = findRequest(user, requestId, payloadKey);
      if (seen?.conflict) return fail("This request id was already used for a different action.");
      if (seen?.replay) {
        // Never re-run the mutation. Report "saved" only if a confirmed save
        // contains it; otherwise ask the queue to save the CURRENT state (a
        // whole-map snapshot that includes the original change) and report
        // what actually happened. Local disk only; no network in the lock.
        if (seen.entry.durable === true) return { ok: true, replayed: true, saved: true, persisted: "durable", note: "", result: seen.result };
        const ack = await save(trainerData);
        if (ack.saved) seen.entry.durable = true;
        return { ok: true, replayed: true, saved: ack.saved, persisted: ack.saved ? "durable" : "pending", note: ack.note, result: seen.result };
      }
    }

    let result;
    try {
      result = mutate(user);
    } catch (err) {
      return fail(`Internal error: ${err?.message || err}`);
    }
    if (!result?.ok) return result ?? fail("Rejected.");

    const entry = requestId != null ? rememberRequest(user, requestId, payloadKey, result) : null;
    const ack = await save(trainerData);
    // The flag itself reaches disk with the next save; until then a replay
    // re-confirms by saving again (conservative, never over-claims).
    if (entry && ack.saved) entry.durable = true;
    return { ok: true, replayed: false, saved: ack.saved, persisted: ack.saved ? "durable" : "pending", note: ack.note, result };
  });
}

export { isHoldable };
