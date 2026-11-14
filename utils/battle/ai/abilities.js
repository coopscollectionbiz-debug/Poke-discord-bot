// ==========================================================
// utils/battle/ai/abilities.js — the ability an ordinary Pokémon fights
// with: the best of its species' regular abilities for its Team's Battle
// plan, picked fresh for each fight and never stored (CONTEXT.md "Ability").
// Hidden abilities are never used. A Mega form always uses its own
// (utils/battle/showdown/sets.js).
// ==========================================================

import { getSpecies, getAbilityRating } from "../data.js";

const FULL = { FULL_SIM_ENABLED: "1" };
/** Showdown's id for an ability name ("Swift Swim" → "swiftswim"). */
export const abilityId = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

export const WEATHER_SETTER_ABILITIES = new Set(["drizzle", "drought", "sandstream", "snowwarning"]);
const WEATHER_USER_ABILITIES = new Set([
  "swiftswim", "raindish", "hydration", "dryskin", "chlorophyll", "solarpower", "flowergift", "leafguard", "harvest",
  "protosynthesis", "sandrush", "sandforce", "sandveil", "slushrush", "icebody", "snowcloak",
]);

// What a plan adds to an ability's general usefulness (Showdown's own 0–5
// rating, in the full sim's data: tools/generate-full-sim-data.mjs).
const PLAN_BONUS = {
  weather: (id) => (WEATHER_SETTER_ABILITIES.has(id) ? 3 : WEATHER_USER_ABILITIES.has(id) ? 2 : 0),
};

/** The regular ability (slot 0 or 1) with the best rating plus plan bonus; the first listed wins a tie. */
export function pickAbility(speciesId, planId) {
  const regular = getSpecies(speciesId, FULL)?.abilities ?? [];
  const score = (name) => getAbilityRating(abilityId(name)) + (PLAN_BONUS[planId]?.(abilityId(name)) ?? 0);
  return regular.reduce((best, name) => (score(name) > score(best) ? name : best), regular[0]);
}
