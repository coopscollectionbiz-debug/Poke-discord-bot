// ==========================================================
// weightedRandom.js
// Shared weighted random selection logic
// ==========================================================

/**
 * Rarity weight distributions for Pokemon
 */
export const POKEMON_RARITY_WEIGHTS = {
  common: 60,
  uncommon: 24,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5
};

/**
 * Rarity weight distributions for Trainers
 */
export const TRAINER_RARITY_WEIGHTS = {
  common: 65,
  uncommon: 22,
  rare: 8,
  epic: 3,
  legendary: 1,
  mythic: 1
};

/**
 * Select a random item from a list based on rarity weights
 * @param {Array} list - Array of items with rarity property
 * @param {object} weights - Weight mapping for rarities
 * @returns {object} Selected item
 */
export function weightedRandomChoice(list, weights) {
  const bag = [];
  for (const item of list) {
    const rarity = item.rarity?.toLowerCase() || "common";
    const weight = weights[rarity] || 1;
    for (let n = 0; n < Math.round(weight); n++) {
      bag.push(item);
    }
  }
  return bag[Math.floor(Math.random() * bag.length)];
}

/**
 * Select a random Pokemon from a pool based on rarity
 * @param {Array} pokemonPool - Array of Pokemon objects
 * @returns {object} Selected Pokemon
 */
export function selectRandomPokemon(pokemonPool) {
  return weightedRandomChoice(pokemonPool, POKEMON_RARITY_WEIGHTS);
}

/**
 * Select a random Trainer from a pool based on rarity
 * @param {Array} trainerPool - Array of Trainer objects
 * @returns {object} Selected Trainer
 */
export function selectRandomTrainer(trainerPool) {
  return weightedRandomChoice(trainerPool, TRAINER_RARITY_WEIGHTS);
}