// ==========================================================
// trainerDataHelper.js
// Centralized helper for trainer data schema initialization
// and management
// ==========================================================

/**
 * Initialize or normalize a user's trainer data with default values
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @returns {object} Normalized user data object
 */
export function initializeUserSchema(userId, username = "Trainer") {
  return {
    id: userId,
    name: username,
    tp: 0,
    cc: 0,
    rank: "Novice Trainer",
    pokemon: {},
    trainers: {},
    displayedPokemon: [],
    displayedTrainer: null,
    lastDaily: 0
  };
}

/**
 * Ensure user data exists and has all required fields
 * @param {object} trainerData - Global trainer data object
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username (optional)
 * @returns {object} User data with guaranteed schema
 */
export function ensureUserData(trainerData, userId, username = "Trainer") {
  if (!trainerData[userId]) {
    trainerData[userId] = initializeUserSchema(userId, username);
  } else {
    // Normalize existing data
    const user = trainerData[userId];
    user.id ??= userId;
    user.name ??= username;
    user.tp ??= 0;
    user.cc ??= 0;
    user.rank ??= "Novice Trainer";
    user.pokemon ??= {};
    user.trainers ??= {};
    user.displayedPokemon ??= [];
    user.displayedTrainer ??= null;
    user.lastDaily ??= 0;
  }
  return trainerData[userId];
}

/**
 * Normalize all users in trainer data
 * @param {object} trainerData - Global trainer data object
 * @returns {object} Normalized trainer data
 */
export function normalizeAllUsers(trainerData) {
  for (const [id, user] of Object.entries(trainerData)) {
    user.id ??= id;
    user.name ??= "Trainer";
    user.tp ??= 0;
    user.cc ??= 0;
    user.rank ??= "Novice Trainer";
    user.pokemon ??= {};
    user.trainers ??= {};
    user.displayedPokemon ??= [];
    user.displayedTrainer ??= null;
    user.lastDaily ??= 0;
  }
  return trainerData;
}
