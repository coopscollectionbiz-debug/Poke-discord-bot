import { normalizeTrainers } from "../services/assets.js";
import { normalizeInventory } from "../services/inventory.js";
import { normalizeProgression } from "../progression/achievements.js";
import { normalizeMegaUnlocks } from "../services/megaUnlocks.js";
import { normalizeAuras, syncTierAuras } from "../services/auras.js";
import { normalizeCustomPokemon } from "../services/ownership.js";
// ==========================================================
// utils/userSchema.js
// Unified user data schema and initialization
// Supports: Shop, Weekly Pack, Evolution Stones, Dashboard,
// Trainercard, Pokedex, Evolutions, Quests, Daily Rewards
// ==========================================================

export const USER_SCHEMA_TEMPLATE = {
  id: "string (Discord user ID)",
  name: "string (Username)",

  // Currency
  cc: "number (Collection Coins, default 0)",
  tp: "number (Trainer Points, default 0)",
  rank: "string (Trainer rank)",

  // Onboarding
  onboardingComplete: "boolean",
  onboardingStage: "string",
  onboardingDate: "string ISO",

  starterPokemon: "number or null",

  // Collections
  pokemon: "object { [id]: { normal, shiny } }",
  trainers: "array of trainer sprite keys",

  // Display
  displayedPokemon: "array",
  displayedTrainer: "string or null",

  // Cooldowns
  lastDaily: "timestamp",
  lastRecruit: "timestamp",
  lastQuest: "timestamp",
  lastWeeklyPack: "deprecated — kept for safe rollout, no longer read",
  weeklyPackClaimed: "boolean (reset each ISO week)",

  // Inventory + shop
  items: "object { [catalogItemId]: non-negative integer } (catalog/items.js)",
  purchases: "array of strings (e.g. 'starter_pack')",

// Luck / Pity System
luck: "number (pity meter, default 0)",
luckTimestamp: "timestamp (last message timestamp)",

};


// ==========================================================
// Create NEW USER
// ==========================================================
export function createNewUser(userId, username) {
  return {
    id: userId,
    name: username,

    // Currency
    cc: 0,
    tp: 0,
    rank: "Novice Trainer",

    // Onboarding
    onboardingComplete: false,
    onboardingStage: "starter_selection",
    onboardingDate: null,

    // Starter
    starterPokemon: null,

    // Collections
    pokemon: {},
    trainers: [], // array of trainer sprite keys (see services/assets.js)

    // Display
    displayedPokemon: [],
    displayedTrainer: null,

    // Cooldowns
    lastDaily: 0,
    lastRecruit: 0,
    lastQuest: 0,
    lastWeeklyPack: null,
    weeklyPackClaimed: false,

    // Inventory
    items: {
      evolution_stone: 0,
    },

    // Permanent purchase flags
    purchases: [],

// Luck / Pity system
luck: 0,
luckTimestamp: 0,

  };
}


// ==========================================================
// Validate + Repair User Schema (for existing users)
// ==========================================================
export function validateUserSchema(user, userId, username) {
  if (!user) return createNewUser(userId, username);

  // Repair IN PLACE and return the same object. A copy here used to replace
  // trainerData[userId], so any code still holding the old object (open
  // collectors, queued rewards) wrote CC/TP/cooldowns to a detached record.
  const out = user;

  // Basic identity
  if (out.id == null) out.id = userId;
  if (!out.name || out.name === "Trainer") out.name = username || "Unknown";

  // Currency
  if (out.cc == null) out.cc = 0;
  if (out.tp == null) out.tp = 0;
  if (!out.rank) out.rank = "Novice Trainer";

  // Onboarding
  if (out.onboardingComplete == null) out.onboardingComplete = false;
  if (!out.onboardingStage) out.onboardingStage = "starter_selection";
  if (out.onboardingDate == null) out.onboardingDate = null;

  // Starter
  if (out.starterPokemon == null) out.starterPokemon = null;

  // Collections
  if (!out.pokemon || typeof out.pokemon !== "object") out.pokemon = {};
  normalizeTrainers(out); // always an array of sprite keys

  // Display
  if (!Array.isArray(out.displayedPokemon)) out.displayedPokemon = [];
  if (out.displayedTrainer === undefined) out.displayedTrainer = null;

  // Cooldowns
  if (out.lastDaily == null) out.lastDaily = 0;
  if (out.lastRecruit == null) out.lastRecruit = 0;
  if (out.lastQuest == null) out.lastQuest = 0;
  if (out.lastWeeklyPack === undefined) out.lastWeeklyPack = null;
  out.weeklyPackClaimed = !!out.weeklyPackClaimed;

  // Inventory
  // Shared, idempotent inventory normalizer (Release B): integers only,
  // evolution_stone always present, nothing dropped silently.
  normalizeInventory(out);
  normalizeProgression(out); // Release C achievement fields
  normalizeMegaUnlocks(out); // Mega Evolution: repairs megaUnlocks if present; never creates it
  normalizeCustomPokemon(out); // TM system: repairs customPokemon if present; never creates it
  normalizeAuras(out); // Auras: repairs auras if present
  syncTierAuras(out); // …and stores the tier Aura of every Epic+ trainer owned (backfill; only writes when one is missing)

  // Permanent shop purchases
  if (!Array.isArray(out.purchases)) out.purchases = [];

// Luck / Pity corrections
if (out.luck == null) out.luck = 0;
if (out.luckTimestamp == null) out.luckTimestamp = 0;

  // DEPRECATED: ownedPokemon → pokemon
  if (out.ownedPokemon) {
    if (Object.keys(out.pokemon).length === 0) {
      out.pokemon = out.ownedPokemon;
    }
    delete out.ownedPokemon;
  }

  return out;
}
