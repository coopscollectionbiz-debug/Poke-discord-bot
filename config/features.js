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
