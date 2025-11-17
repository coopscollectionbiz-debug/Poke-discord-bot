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
  trainers: "object { [trainerKey]: boolean }",

  // Display
  displayedPokemon: "array",
  displayedTrainer: "string or null",

  // Cooldowns
  lastDaily: "timestamp",
  lastRecruit: "timestamp",
  lastQuest: "timestamp",
  lastWeeklyPack: "timestamp or null",

  // Inventory + shop
  items: "object { evolution_stone: number }",
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
    trainers: {},

    // Display
    displayedPokemon: [],
    displayedTrainer: null,

    // Cooldowns
    lastDaily: 0,
    lastRecruit: 0,
    lastQuest: 0,
    lastWeeklyPack: 0,

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

  const out = { ...user };

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
  if (!out.trainers || typeof out.trainers !== "object") out.trainers = {};

  // Display
  if (!Array.isArray(out.displayedPokemon)) out.displayedPokemon = [];
  if (out.displayedTrainer === undefined) out.displayedTrainer = null;

  // Cooldowns
  if (out.lastDaily == null) out.lastDaily = 0;
  if (out.lastRecruit == null) out.lastRecruit = 0;
  if (out.lastQuest == null) out.lastQuest = 0;
  if (out.lastWeeklyPack == null) out.lastWeeklyPack = 0;

  // Inventory
  if (!out.items || typeof out.items !== "object") {
    out.items = { evolution_stone: 0 };
  }
  if (out.items.evolution_stone == null) {
    out.items.evolution_stone = 0;
  }

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
