// ==========================================================
// utils/userSchema.js
// Unified user data schema and initialization
// ==========================================================

export const USER_SCHEMA_TEMPLATE = {
  id: "string (Discord user ID)",
  name: "string (Username)",
  cc: "number (Collection Coins, default 0)",
  tp: "number (Trainer Points, default 0)",
  rank: "string (Trainer rank, default 'Novice Trainer')",
  onboardingComplete: "boolean (default false)",
  onboardingDate: "string ISO or null (default null)",
  starterPokemon: "number or null (default null)",
  pokemon: "object { [id: string]: { normal: number, shiny: number } }",
  trainers: "object { [trainerKey: string]: boolean }",
  displayedPokemon: "array of pokemon IDs (default [])",
  displayedTrainer: "string or null (trainer key)",
  lastDaily: "number (timestamp, default 0)",
  lastRecruit: "number (timestamp, default 0)",
  lastQuest: "number (timestamp, default 0)"
};

/**
 * Creates a new user object with all required fields initialized
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @returns {Object} Complete user object
 */
export function createNewUser(userId, username) {
  return {
    id: userId,
    name: username,
    cc: 0,
    tp: 0,
    rank: "Novice Trainer",
    onboardingComplete: false,
    onboardingStage: "starter_selection",
    onboardingDate: null,
    starterPokemon: null,
    pokemon: {},
    trainers: {},
    displayedPokemon: [],
    displayedTrainer: null,
    lastDaily: 0,
    lastRecruit: 0,
    lastQuest: 0
  };
}

/**
 * Ensures user has all required fields, adding missing ones
 * @param {Object} user - User object to validate
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @returns {Object} User object with all required fields
 */
export function validateUserSchema(user, userId, username) {
  if (!user) {
    return createNewUser(userId, username);
  }

  // Ensure all required fields exist
  const validated = { ...user };

  // Core fields
  if (validated.id === undefined) validated.id = userId;
  if (validated.name === undefined) validated.name = username;
  if (validated.cc === undefined) validated.cc = 0;
  if (validated.tp === undefined) validated.tp = 0;
  if (validated.rank === undefined) validated.rank = "Novice Trainer";

  // Onboarding fields
  if (validated.onboardingComplete === undefined) validated.onboardingComplete = false;
  if (validated.onboardingStage === undefined) validated.onboardingStage = "starter_selection";
  if (validated.onboardingDate === undefined) validated.onboardingDate = null;
  if (validated.starterPokemon === undefined) validated.starterPokemon = null;

  // Collection fields
  if (!validated.pokemon || typeof validated.pokemon !== "object") validated.pokemon = {};
  if (!validated.trainers || typeof validated.trainers !== "object") validated.trainers = {};

  // Display fields
  if (!Array.isArray(validated.displayedPokemon)) validated.displayedPokemon = [];
  if (validated.displayedTrainer === undefined) validated.displayedTrainer = null;

  // Cooldown fields
  if (validated.lastDaily === undefined) validated.lastDaily = 0;
  if (validated.lastRecruit === undefined) validated.lastRecruit = 0;
  if (validated.lastQuest === undefined) validated.lastQuest = 0;

  // Remove deprecated ownedPokemon if it exists
  if (validated.ownedPokemon !== undefined) {
    // Migrate data if needed
    if (Object.keys(validated.ownedPokemon).length > 0 && Object.keys(validated.pokemon).length === 0) {
      validated.pokemon = validated.ownedPokemon;
    }
    delete validated.ownedPokemon;
  }

  return validated;
}