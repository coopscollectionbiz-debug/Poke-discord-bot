// ==========================================================
// config/features.js — feature flags read from the environment.
//
// MEGA_EVOLUTION_ENABLED  "1" / "true" / "yes" / "on" turns Mega Evolution on.
//                         Unset or anything else = OFF (the default, D-3).
// MEGA_FORMS              Optional allowlist for a staged release: a
//                         comma-separated list of Mega form ids
//                         ("mega-charizard-x,mega-venusaur"), or "all".
//                         Unset = all forms (still subject to the flag and
//                         to each form's own eligibility).
//
// These flags only gate Mega features. They never touch generation
// availability (config/generations.js, POKEMON_GENERATIONS) and never
// add, change or delete player data. Switching Mega Evolution off keeps
// every unlock and stone (docs/mega-evolution/MEGA-TEST-AND-ROLLBACK-PLAN.md).
// ==========================================================

const TRUE = new Set(["1", "true", "yes", "on"]);
const FORM_ID = /^mega-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Is Mega Evolution switched on? Default: false. */
export function isMegaEvolutionEnabled(env = process.env) {
  return TRUE.has(String(env.MEGA_EVOLUTION_ENABLED ?? "").trim().toLowerCase());
}

/**
 * The MEGA_FORMS allowlist: null = no restriction ("all" or unset),
 * otherwise a frozen Set of well-formed form ids (malformed entries dropped).
 */
export function megaFormAllowlist(env = process.env) {
  const raw = String(env.MEGA_FORMS ?? "").trim().toLowerCase();
  if (!raw || raw === "all") return null;
  return Object.freeze(new Set(raw.split(",").map((s) => s.trim()).filter((s) => FORM_ID.test(s))));
}

/** Flag-level gate for one form (eligibility and generation checks live in utils/megas.js). */
export function isMegaFormAllowedByFlags(formId, env = process.env) {
  if (!isMegaEvolutionEnabled(env)) return false;
  const allow = megaFormAllowlist(env);
  return allow === null || allow.has(String(formId));
}

// ----------------------------------------------------------
// Phase M1: one capability per subsystem. The master switch is required for
// every capability; each built subsystem also has its own switch (default ON
// once the master switch is on, so "0"/"false"/"off"/"no" turns just that
// part off). Subsystems that are NOT BUILT can't be switched on by any
// environment: BUILT[cap] is a code constant changed only by the phase that
// implements it.
//
//   MEGA_DASHBOARD_ENABLED  Mega cards and previews on the dashboard
//   MEGA_UNLOCKS_ENABLED    using a Mega Stone to unlock a form
//   MEGA_TEAMS_ENABLED      placing a Mega card in the battle team
//   MEGA_BATTLES_ENABLED    Mega transformation in battle (Phase M2). OPT-IN:
//                           off unless explicitly "1"/"true"/"yes"/"on", even
//                           when the master switch is on
//   (rewards)               Mega Stone / Shard acquisition: Phase M4 (not built)
// ----------------------------------------------------------

export const MEGA_CAPABILITIES = Object.freeze(["dashboard", "unlock", "team", "battle", "rewards"]);
const BUILT = Object.freeze({ dashboard: true, unlock: true, team: true, battle: true, rewards: false });
const SUB_FLAG = Object.freeze({ dashboard: "MEGA_DASHBOARD_ENABLED", unlock: "MEGA_UNLOCKS_ENABLED", team: "MEGA_TEAMS_ENABLED", battle: "MEGA_BATTLES_ENABLED" });
const OPT_IN = new Set(["battle"]); // these sub-switches default OFF
const OFF = new Set(["0", "false", "no", "off"]);

/** Is one Mega capability available? Unknown capabilities are always off. */
export function isMegaCapabilityEnabled(capability, env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(BUILT, capability) || BUILT[capability] !== true) return false;
  if (!isMegaEvolutionEnabled(env)) return false;
  const sub = SUB_FLAG[capability];
  const value = String(env[sub] ?? "").trim().toLowerCase();
  if (OPT_IN.has(capability)) return TRUE.has(value);
  return !(sub && OFF.has(value));
}

/** Every capability's state, for status endpoints and tests. */
export const megaCapabilities = (env = process.env) =>
  Object.freeze(Object.fromEntries(MEGA_CAPABILITIES.map((c) => [c, isMegaCapabilityEnabled(c, env)])));

// ==========================================================
// Held items (docs/held-items/HELD-ITEM-AMENDMENT.md). Same shape as Mega:
// a master switch plus one switch per subsystem.
//
//   HELD_ITEMS_ENABLED          master switch. Unset = OFF for everyone.
//   HELD_ITEMS_TESTERS          optional comma-separated Discord ids. When set,
//                               the feature is on ONLY for those players (a
//                               staged audience for owner verification).
//   HELD_ITEMS_DASHBOARD_ENABLED  item views + equipping on the Teams page
//   HELD_ITEMS_STARTER_ENABLED    the eight free starter unlocks
//   HELD_ITEMS_SHOP_ENABLED       buying unlocks in the dashboard shop
//   HELD_ITEMS_BATTLES_ENABLED    item effects in battle + Lucky Egg EXP.
//                                 OPT-IN: off unless explicitly on.
//
// Switching anything off never deletes unlocks or equipment: battles just
// ignore items and the dashboard hides the controls.
// ==========================================================
export const HELD_ITEM_CAPABILITIES = Object.freeze(["dashboard", "starter", "shop", "battles"]);
const HELD_SUB_FLAG = Object.freeze({
  dashboard: "HELD_ITEMS_DASHBOARD_ENABLED",
  starter: "HELD_ITEMS_STARTER_ENABLED",
  shop: "HELD_ITEMS_SHOP_ENABLED",
  battles: "HELD_ITEMS_BATTLES_ENABLED",
});
const HELD_OPT_IN = new Set(["battles"]);

/** The tester allowlist: null = everyone (when the master switch is on). */
export function heldItemTesters(env = process.env) {
  const raw = String(env.HELD_ITEMS_TESTERS ?? "").trim();
  if (!raw) return null;
  return Object.freeze(new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s))));
}

/**
 * Is one held-item capability on for this player? `userId` null asks about
 * the feature in general (e.g. a status line); with a tester allowlist set,
 * only listed players get true.
 */
export function isHeldItemCapabilityEnabled(capability, env = process.env, userId = null) {
  if (!HELD_ITEM_CAPABILITIES.includes(capability)) return false;
  if (!TRUE.has(String(env.HELD_ITEMS_ENABLED ?? "").trim().toLowerCase())) return false;
  const testers = heldItemTesters(env);
  if (testers && !(userId != null && testers.has(String(userId)))) return false;
  const value = String(env[HELD_SUB_FLAG[capability]] ?? "").trim().toLowerCase();
  if (HELD_OPT_IN.has(capability)) return TRUE.has(value);
  return !OFF.has(value);
}

export const heldItemCapabilities = (env = process.env, userId = null) =>
  Object.freeze(Object.fromEntries(HELD_ITEM_CAPABILITIES.map((c) => [c, isHeldItemCapabilityEnabled(c, env, userId)])));
