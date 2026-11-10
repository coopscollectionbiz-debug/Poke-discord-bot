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
//   (battle)                Mega transformation in battle: Phase M2 (not built)
//   (rewards)               Mega Stone / Shard acquisition: Phase M4 (not built)
// ----------------------------------------------------------

export const MEGA_CAPABILITIES = Object.freeze(["dashboard", "unlock", "team", "battle", "rewards"]);
const BUILT = Object.freeze({ dashboard: true, unlock: true, team: true, battle: false, rewards: false });
const SUB_FLAG = Object.freeze({ dashboard: "MEGA_DASHBOARD_ENABLED", unlock: "MEGA_UNLOCKS_ENABLED", team: "MEGA_TEAMS_ENABLED" });
const OFF = new Set(["0", "false", "no", "off"]);

/** Is one Mega capability available? Unknown capabilities are always off. */
export function isMegaCapabilityEnabled(capability, env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(BUILT, capability) || BUILT[capability] !== true) return false;
  if (!isMegaEvolutionEnabled(env)) return false;
  const sub = SUB_FLAG[capability];
  return !(sub && OFF.has(String(env[sub] ?? "").trim().toLowerCase()));
}

/** Every capability's state, for status endpoints and tests. */
export const megaCapabilities = (env = process.env) =>
  Object.freeze(Object.fromEntries(MEGA_CAPABILITIES.map((c) => [c, isMegaCapabilityEnabled(c, env)])));
