// ==========================================================
// services/assets.js
// The one place that changes trainer ownership (and, over time, other
// assets). Everything here is synchronous: call it inside lockUser,
// between your awaits and the save.
//
// Trainer ownership is ALWAYS an array of sprite keys (file names):
//   user.trainers = ["youngster-gen4.png", "lass.png", ...]
// Older code wrote object maps ({ "file.png": true | count }) or, worse,
// object keys onto the array (arr["file.png"] = 1), which JSON.stringify
// silently drops, so the trainer vanished on the next restart (D1).
// ==========================================================

const keyOf = (k) => String(k ?? "").trim();
const sameKey = (a, b) => keyOf(a).toLowerCase() === keyOf(b).toLowerCase();

/**
 * Make user.trainers a clean, de-duplicated array of strings, IN PLACE on
 * the user object, and return it. Accepts legacy object maps, and rescues
 * keys that were written onto an array as properties.
 */
export function normalizeTrainers(user) {
  if (!user || typeof user !== "object") return [];
  const raw = user.trainers;
  let keys = [];
  if (Array.isArray(raw)) {
    keys = raw.filter((t) => typeof t === "string");
    // Rescue `arr[file] = …` writes (non-index properties on the array).
    for (const k of Object.keys(raw)) {
      if (!/^\d+$/.test(k)) keys.push(k);
    }
  } else if (raw && typeof raw === "object") {
    keys = Object.keys(raw);
  }
  // Exact de-duplication only: normalizing must never merge two keys that
  // differ in case (they could be different sprite files on Linux).
  const out = [...new Set(keys.map(keyOf).filter(Boolean))];
  user.trainers = out;
  return out;
}

/** True if the user owns this trainer key (case-insensitive). */
export function ownsTrainer(user, key) {
  if (!user || !keyOf(key)) return false;
  const raw = user.trainers;
  if (Array.isArray(raw)) {
    return raw.some((t) => sameKey(t, key)) || Object.keys(raw).some((t) => !/^\d+$/.test(t) && sameKey(t, key));
  }
  if (raw && typeof raw === "object") return Object.keys(raw).some((t) => sameKey(t, key));
  return false;
}

/**
 * Give a trainer. Returns true if it was new, false if already owned.
 * Throws on an empty key (a bug in the caller, not a player action).
 */
export function grantTrainer(user, key) {
  const k = keyOf(key);
  if (!k) throw new Error("grantTrainer: missing trainer key");
  const list = normalizeTrainers(user);
  if (list.some((t) => sameKey(t, k))) return false;
  list.push(k);
  return true;
}

/** Remove a trainer. Returns true if it was owned. */
export function revokeTrainer(user, key) {
  const list = normalizeTrainers(user);
  const i = list.findIndex((t) => sameKey(t, key));
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Remove every trainer (admin reset). */
export function clearTrainers(user) {
  if (user && typeof user === "object") user.trainers = [];
}

/** Number of distinct trainers owned. */
export function trainerCount(user) {
  return normalizeTrainers({ trainers: user?.trainers }).length;
}

/**
 * Report-only integrity check for one user record. Returns a list of
 * human-readable problems (never values that identify the player).
 */
export function auditUser(user) {
  const problems = [];
  if (!user || typeof user !== "object" || Array.isArray(user)) return ["record is not an object"];
  if (!Array.isArray(user.trainers)) problems.push("trainers is not an array");
  else if (Object.keys(user.trainers).some((k) => !/^\d+$/.test(k))) problems.push("trainers has keys stored as array properties");
  for (const f of ["cc", "tp"]) {
    if (!Number.isFinite(user[f])) problems.push(`${f} is not a number`);
    else if (user[f] < 0) problems.push(`${f} is negative`);
  }
  for (const [id, e] of Object.entries(user.pokemon || {})) {
    for (const v of ["normal", "shiny"]) {
      const n = e?.[v] ?? 0;
      if (!Number.isInteger(n) || n < 0) problems.push(`pokemon ${id}.${v} is not a non-negative integer`);
    }
  }
  for (const [k, n] of Object.entries(user.items || {})) {
    if (!Number.isInteger(n) || n < 0) problems.push(`items.${k} is not a non-negative integer`);
  }
  return problems;
}

/**
 * Report-only audit of the whole map: { users, usersWithProblems, counts }.
 * Counts problems by type so logs never contain player IDs or values.
 */
export function auditTrainerData(trainerData) {
  const counts = {};
  let usersWithProblems = 0;
  const ids = Object.keys(trainerData || {});
  for (const id of ids) {
    const p = auditUser(trainerData[id]);
    if (p.length) usersWithProblems++;
    for (const msg of p) {
      const type = msg.replace(/^pokemon \S+/, "pokemon <id>");
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return { users: ids.length, usersWithProblems, counts };
}

/** Largest single currency grant (guards against bad reward definitions). */
export const MAX_CURRENCY_GRANT = 1_000_000;

/**
 * Add CC to a player (positive whole amount, bounded). Synchronous; call it
 * inside the player's lock. Returns { ok, cc } or { ok:false, error }.
 */
export function grantCurrency(user, amount) {
  if (!user || typeof user !== "object") return { ok: false, error: "No player record." };
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CURRENCY_GRANT) return { ok: false, error: "Invalid amount." };
  const current = Number.isFinite(user.cc) ? user.cc : 0;
  const next = current + amount;
  if (!Number.isSafeInteger(next)) return { ok: false, error: "Balance would overflow." };
  user.cc = next;
  return { ok: true, cc: next };
}
