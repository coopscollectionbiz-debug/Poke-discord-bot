// ==========================================================
// catalog/opponentPlans.js — computer-run opponents' Battle plans and AI
// skill under the full sim (full-sim spec, "Battle plans" and "AI").
//
// DRAFT for owner sign-off: each Challenge opponent plays a plan that fits
// their canon style, and each Trainer class one that fits its theme.
// Skill: Rookie for the youngest classes, Solid for most classes, Expert
// for every Challenge opponent (Gym Leaders, the Elite Four, Blue, Red),
// Ace Trainers and Dragon Tamers (owner decision, 2026-11-12). Challenges
// make up for their Experts with a retuned hidden stat boost on the full sim
// (utils/battle/tuning.js FULL_SIM.challengeStatBoost).
// Their plan also picks their moves (services/battlePlans.js planMoves).
// ==========================================================

const p = (plan, skill = "solid") => Object.freeze({ plan, skill });

export const CHALLENGE_PLANS = Object.freeze({
  brock: p("hazards", "expert"), // Rock: Stealth Rock
  misty: p("weather", "expert"), // Water: rain
  surge: p("status", "expert"), // Electric: Thunder Wave
  erika: p("status", "expert"), // Grass: Sleep Powder, Stun Spore
  koga: p("status", "expert"), // Poison: Toxic
  sabrina: p("setup", "expert"), // Psychic: Calm Mind
  blaine: p("weather", "expert"), // Fire: sun
  giovanni: p("hazards", "expert"), // Ground: Stealth Rock, Spikes
  lorelei: p("status", "expert"), // Ice: Sing, Lovely Kiss
  bruno: p("setup", "expert"), // Fighting: Bulk Up
  agatha: p("status", "expert"), // Ghost: Hypnosis, Will-O-Wisp
  lance: p("setup", "expert"), // Dragon: Dragon Dance
  blue: p("allout", "expert"),
  red: p("setup", "expert"),
});

const ROOKIE = ["youngster", "lass", "bugcatcher", "camper", "picnicker", "richboy"];
const THEMED = {
  hiker: "hazards", pokemaniac: "hazards",
  psychic: "setup", psychicf: "setup", blackbelt: "setup", battlegirl: "setup", dragontamer: "setup",
  channeler: "status", hexmaniac: "status", engineer: "status", supernerd: "status", burglar: "status", biker: "status",
  rocketgrunt: "status", rocketgruntf: "status",
  fisherman: "weather", swimmer: "weather", swimmerf: "weather", sailor: "weather", firebreather: "weather", skier: "weather", skierf: "weather",
  birdkeeper: "speed", juggler: "speed",
};
export const CLASS_PLANS = Object.freeze(Object.fromEntries([
  ...["youngster", "lass", "bugcatcher", "camper", "picnicker", "gentleman", "lady", "richboy", "beauty"].map((k) => [k, p(THEMED[k] ?? "allout", ROOKIE.includes(k) ? "rookie" : "solid")]),
  ...Object.entries(THEMED).map(([k, plan]) => [k, p(plan, k === "dragontamer" ? "expert" : "solid")]),
  ["acetrainer", p("setup", "expert")],
  ["acetrainerf", p("setup", "expert")],
]));

const DEFAULT = p("allout");
/** A Challenge opponent's { plan, skill }. */
export const opponentPlan = (key) => CHALLENGE_PLANS[key] ?? DEFAULT;
/** A Trainer class's { plan, skill }. */
export const classPlan = (key) => CLASS_PLANS[key] ?? DEFAULT;
