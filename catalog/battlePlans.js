// ==========================================================
// catalog/battlePlans.js — the six Battle plans (data and rules only).
//
// A Battle plan (CONTEXT.md) steers how a Team plays its moves once a fight
// starts; it never changes a picked Moveset (full-sim spec, "Battle plans").
// The AI that follows a plan lives in utils/battle/ai/choose.js.
//
// moveRoles() reads what each status move does from the full sim's data,
// where tools/generate-full-sim-data.mjs derives it from the engine's own
// move data, so every move counts for the plans it helps without hand-kept
// lists, and the bot's main thread never loads the engine.
// ==========================================================

import { getMove, getSpecies } from "../utils/battle/data.js";
import { WEATHER_SETTER_ABILITIES, pickAbility, abilityId } from "../utils/battle/ai/abilities.js";
import { WEATHER_OF, WEATHER_FANS, weatherFor } from "../utils/battle/ai/weather.js";

const FULL = { FULL_SIM_ENABLED: "1" };
const LEGACY = {};

export const DEFAULT_PLAN = "allout";

// Player-facing names and one-line blurbs.
export const BATTLE_PLANS = Object.freeze([
  { id: "allout", name: "All-out attack", blurb: "Uses its strongest move every turn.", roles: [] },
  { id: "setup", name: "Set up & sweep", blurb: "Raises its Attack, Special Attack or Speed while the foe can't take half its HP in one hit, then attacks.", roles: ["setup"], hint: ["swordsdance", "nastyplot", "dragondance", "calmmind"] },
  { id: "status", name: "Status & stall", blurb: "Paralyzes, burns, poisons or puts the foe to sleep, then protects and heals.", roles: ["status"], hint: ["thunderwave", "willowisp", "toxic"] },
  { id: "hazards", name: "Hazards & screens", blurb: "Sets Stealth Rock, Spikes, Reflect or Light Screen early, then attacks.", roles: ["hazard", "screen"], hint: ["stealthrock", "spikes", "reflect", "lightscreen"] },
  { id: "weather", name: "Weather", blurb: "Sets the weather that helps most of its Team, such as rain for Water types.", roles: ["weather"], hint: ["raindance", "sunnyday", "sandstorm", "snowscape"] },
  { id: "speed", name: "Speed control", blurb: "Sets Trick Room when its Team is slower than the foe's, Tailwind when it's faster.", roles: ["speed"], hint: ["trickroom", "tailwind"] },
].map((p) => Object.freeze(p)));

const BY_ID = new Map(BATTLE_PLANS.map((p) => [p.id, p]));
export const planById = (id) => BY_ID.get(id) ?? null;
export const isPlanId = (id) => BY_ID.has(id);

/**
 * What a move does for the plans: attack, setup, status, hazard, screen,
 * weather, speed, recovery, protect. An attack only today's data still
 * has (a picked move kept until edited) is still an attack.
 */
export function moveRoles(moveId) {
  const m = getMove(moveId, FULL) ?? getMove(moveId, LEGACY);
  if (!m) return [];
  return m.category === "Status" ? [...(m.roles ?? [])] : ["attack"];
}

const averageSpeeds = new WeakMap();
/** The average base Speed of every species (67 on the full sim), what "slow" is measured against. */
export function averageBaseSpeed(env = FULL) {
  const table = getSpecies(1, env);
  if (!averageSpeeds.has(table)) {
    let total = 0, n = 0;
    for (let id = 1; getSpecies(id, env); id++, n++) total += getSpecies(id, env).baseStats.spe;
    averageSpeeds.set(table, total / n);
  }
  return averageSpeeds.get(table);
}

/** Slower than the average Pokémon, so most foes move first. */
export const isSlow = (speciesId, env = FULL) => getSpecies(speciesId, env).baseStats.spe < averageBaseSpeed(env);

/**
 * Before a fight, does setup move `moveId` raise something this Pokémon
 * uses, bringing `attackIds`? Attack with a physical attack, Special Attack
 * with a special one, Speed when it's slow. In battle the AI asks the same
 * of the foe in front of it (utils/battle/ai/choose.js); with no foe yet, a
 * slow Pokémon stands in for one that's outsped.
 */
export function setupMatters(speciesId, moveId, attackIds, env = FULL) {
  const boosts = getMove(moveId, env)?.boosts ?? {};
  const has = (category) => attackIds.some((id) => getMove(id, env)?.category === category);
  return (boosts.atk > 0 && has("Physical")) || (boosts.spa > 0 && has("Special")) || (boosts.spe > 0 && isSlow(speciesId, env));
}

/** The attacking stats this Pokémon is better at: ["atk"], ["spa"], or both when even. */
export function betterAttackStats(speciesId, env = FULL) {
  const { atk, spa } = getSpecies(speciesId, env).baseStats;
  return atk > spa ? ["atk"] : spa > atk ? ["spa"] : ["atk", "spa"];
}

/**
 * A setup move worth adding to this Pokémon, whatever it brings now: one
 * that raises the attacking stat it's better at, or Speed when it's slow.
 * Advice follows this (recommended moves, and the Teams page's "how to get
 * this plan going"), so it never says to add Calm Mind to an Entei.
 */
export function setupSuits(speciesId, moveId, env = FULL) {
  const boosts = getMove(moveId, env)?.boosts ?? {};
  return betterAttackStats(speciesId, env).some((s) => boosts[s] > 0) || (boosts.spe > 0 && isSlow(speciesId, env));
}

const weatherAbilityId = (speciesId) => abilityId(pickAbility(speciesId, "weather") ?? "");

/** The weather the AI plays to for these Pokémon ([{ speciesId }]): the one most of them favor, or null. */
export function teamWeatherOf(members, env = FULL) {
  return weatherFor(members.filter((m) => getSpecies(m.speciesId, env))
    .map((m) => ({ types: getSpecies(m.speciesId, env).types, ability: weatherAbilityId(m.speciesId) })));
}

/** The ability this Pokémon fights with on Weather, when it sets `weather` (Pelipper's Drizzle), else null. */
export function weatherAbility(speciesId, weather) {
  const id = weatherAbilityId(speciesId);
  return weather && WEATHER_SETTER_ABILITIES.has(id) && WEATHER_FANS[weather].abilities.includes(id) ? pickAbility(speciesId, "weather") : null;
}

/** Does move `id` help `plan` for Team member `m` ({ speciesId, moves })? weather: the Team's. */
export function moveHelps(id, m, plan, weather, env = FULL) {
  if (!moveRoles(id).some((r) => plan.roles.includes(r))) return false;
  if (plan.id === "setup") return setupMatters(m.speciesId, id, m.moves ?? [], env);
  if (plan.id === "weather") return WEATHER_OF[id] === weather;
  return true;
}

/**
 * Does this Team bring what its plan needs? members: [{ speciesId, name?,
 * baseName?, moves }] with the moves each one actually brings. A move counts
 * only when the AI would play it for the plan (moveHelps).
 *   helpers: [{ speciesId, name, moves, ability }], who helps and with what
 *   missing: example moves that would make it ready
 *   noWeather: Weather, on a Team no weather helps (it can't run at all)
 */
export function planReadiness(members, planId) {
  const plan = planById(planId) ?? planById(DEFAULT_PLAN);
  if (!plan.roles.length) return { ready: true, helpers: [], missing: [] };
  const weather = plan.id === "weather" ? teamWeatherOf(members) : null;
  if (plan.id === "weather" && !weather) return { ready: false, helpers: [], missing: [], noWeather: true };
  const helpers = members
    .map((m) => ({ speciesId: m.speciesId, name: m.baseName ?? m.name, moves: (m.moves ?? []).filter((id) => moveHelps(id, m, plan, weather)), ability: weatherAbility(m.speciesId, weather) }))
    .filter((h) => h.moves.length || h.ability);
  const missing = helpers.length ? [] : plan.hint.filter((id) => !weather || WEATHER_OF[id] === weather);
  return { ready: helpers.length > 0, helpers, missing };
}
