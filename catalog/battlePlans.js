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

const FULL = { FULL_SIM_ENABLED: "1" };
const LEGACY = {};

export const DEFAULT_PLAN = "allout";

// Player-facing names and one-line blurbs (copy: /unslop before release).
export const BATTLE_PLANS = Object.freeze([
  { id: "allout", name: "All-out attack", blurb: "Uses its strongest move every turn.", roles: [] },
  { id: "setup", name: "Set up & sweep", blurb: "Boosts its stats while it's safe, then attacks.", roles: ["setup"], hint: ["swordsdance", "nastyplot", "dragondance", "calmmind"] },
  { id: "status", name: "Status & stall", blurb: "Paralyzes, burns, poisons or sleeps the foe, then outlasts it.", roles: ["status"], hint: ["thunderwave", "willowisp", "toxic"] },
  { id: "hazards", name: "Hazards & screens", blurb: "Sets Stealth Rock, Spikes or screens early, then attacks.", roles: ["hazard", "screen"], hint: ["stealthrock", "spikes", "reflect", "lightscreen"] },
  { id: "weather", name: "Weather", blurb: "Sets the weather that helps its Team most, then plays to it.", roles: ["weather"], hint: ["raindance", "sunnyday", "sandstorm", "snowscape"] },
  { id: "speed", name: "Speed control", blurb: "Sets Trick Room if its Team is slow, Tailwind if it's fast.", roles: ["speed"], hint: ["trickroom", "tailwind"] },
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

const setsWeatherByAbility = (speciesId) => WEATHER_SETTER_ABILITIES.has(abilityId(pickAbility(speciesId, "weather") ?? ""));

/**
 * Does this Team bring what its plan needs? members: [{ speciesId, moves }]
 * with the moves each one actually brings. helpers: how many members help
 * the plan; missing: example moves that would make it ready.
 */
export function planReadiness(members, planId) {
  const plan = planById(planId) ?? planById(DEFAULT_PLAN);
  if (!plan.roles.length) return { ready: true, helpers: members.length, missing: [] };
  const helps = (m) => (m.moves ?? []).some((id) => moveRoles(id).some((r) => plan.roles.includes(r)))
    || (plan.id === "weather" && getSpecies(m.speciesId) && setsWeatherByAbility(m.speciesId));
  const helpers = members.filter(helps).length;
  return { ready: helpers > 0, helpers, missing: helpers > 0 ? [] : [...plan.hint] };
}
