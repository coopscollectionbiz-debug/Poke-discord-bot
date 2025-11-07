// ==========================================================
// weightedRandom.js
// Shared weighted random selection logic (Rank-Aware Version)
// ==========================================================

import { getRank } from "./rankSystem.js";

// ==========================================================
// ⚖️ Rarity weight distributions
// ==========================================================
export const POKEMON_RARITY_WEIGHTS = {
  common: 60,
  uncommon: 24,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5
};

export const TRAINER_RARITY_WEIGHTS = {
  common: 65,
  uncommon: 22,
  rare: 8,
  epic: 3,
  legendary: 1,
  mythic: 1
};

// ==========================================================
// 💪 Rank-based Weight Multipliers
// Matches rank names from rankSystem.js
// ==========================================================
export const RANK_WEIGHT_MULTIPLIERS = {
  "Novice Trainer":       { rare: 1.0, epic: 1.0, legendary: 1.0, mythic: 1.0 },
  "Junior Trainer":       { rare: 1.05, epic: 1.05, legendary: 1.0, mythic: 1.0 },
  "Skilled Trainer":      { rare: 1.1,  epic: 1.1,  legendary: 1.05, mythic: 1.0 },
  "Experienced Trainer":  { rare: 1.15, epic: 1.15, legendary: 1.1,  mythic: 1.0 },
  "Advanced Trainer":     { rare: 1.2,  epic: 1.25, legendary: 1.1,  mythic: 1.0 },
  "Expert Trainer":       { rare: 1.25, epic: 1.3,  legendary: 1.15, mythic: 1.0 },
  "Veteran Trainer":      { rare: 1.3,  epic: 1.35, legendary: 1.2,  mythic: 1.05 },
  "Elite Trainer":        { rare: 1.35, epic: 1.4,  legendary: 1.25, mythic: 1.05 },
  "Master Trainer":       { rare: 1.4,  epic: 1.45, legendary: 1.3,  mythic: 1.1 },
  "Gym Leader":           { rare: 1.45, epic: 1.5,  legendary: 1.35, mythic: 1.1 },
  "Elite Four Member":    { rare: 1.5,  epic: 1.6,  legendary: 1.4,  mythic: 1.15 },
  "Champion":             { rare: 1.55, epic: 1.7,  legendary: 1.45, mythic: 1.2 },
  "Legend":               { rare: 1.6,  epic: 1.8,  legendary: 1.5,  mythic: 1.25 }
};

// ==========================================================
// 🎲 Base Weighted Random Choice
// ==========================================================
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

// ==========================================================
// 🧮 Rank-Aware Weighted Random Choice
// Applies multipliers based on user rank
// ==========================================================
export function weightedRandomChoiceWithRank(list, weights, user) {
  const rank = getRank(user.tp || 0);
  const buffs = RANK_WEIGHT_MULTIPLIERS[rank] || {};
  const bag = [];

  for (const item of list) {
    const rarity = item.rarity?.toLowerCase() || "common";
    let weight = weights[rarity] || 1;

    // Apply rank buff multiplier if available
    if (buffs[rarity]) weight *= buffs[rarity];

    for (let n = 0; n < Math.round(weight); n++) {
      bag.push(item);
    }
  }

  if (!bag.length) return list[Math.floor(Math.random() * list.length)];

  return bag[Math.floor(Math.random() * bag.length)];
}

// ==========================================================
// 🧩 Convenience Wrappers
// ==========================================================
/**
 * Select a random Pokémon based on rarity + rank buffs
 * @param {Array} pokemonPool - Array of Pokémon objects
 * @param {Object} user - TrainerData user (includes TP)
 * @returns {Object} Selected Pokémon
 */
export function selectRandomPokemonForUser(pokemonPool, user) {
  return weightedRandomChoiceWithRank(pokemonPool, POKEMON_RARITY_WEIGHTS, user);
}

/**
 * Select a random Trainer based on rarity + rank buffs
 * @param {Array} trainerPool - Array of Trainer objects
 * @param {Object} user - TrainerData user (includes TP)
 * @returns {Object} Selected Trainer
 */
export function selectRandomTrainerForUser(trainerPool, user) {
  return weightedRandomChoiceWithRank(trainerPool, TRAINER_RARITY_WEIGHTS, user);
}
