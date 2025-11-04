// ==========================================================
// dataLoader.js
// Centralized JSON data loading with caching for performance
// ==========================================================

import fs from "fs/promises";

// Cache for loaded JSON data
const cache = {
  pokemonData: null,
  trainerSprites: null
};

/**
 * Load and cache Pokemon data
 * @returns {Promise<object>} Pokemon data object
 */
export async function loadPokemonData() {
  if (cache.pokemonData) {
    return cache.pokemonData;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(new URL("../pokemonData.json", import.meta.url))
    );
    console.log("Successfully loaded Pokémon data:", Object.keys(data).length, "Pokémon"); // Log the successful load
    cache.pokemonData = data;
    return data;
  } catch (error) {
    console.error("Error loading Pokémon data:", error); // Log the error
    throw error; // Re-throw the error for calling functions to handle
  }
}

/**
 * Get all Pokemon as an iterable array
 * @returns {Promise<Array>} Array of Pokemon objects
 */
export async function getAllPokemon() {
  const data = await loadPokemonData();
  return Object.values(data);
}

/**
 * Load and cache trainer sprites data
 * @returns {Promise<object>} Trainer sprites object
 */
export async function loadTrainerSprites() {
  if (cache.trainerSprites) {
    return cache.trainerSprites;
  }
  
  const data = JSON.parse(
    await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
  );
  cache.trainerSprites = data;
  return data;
}

/**
 * Get all trainers as an iterable array
 * @returns {Promise<Array>} Array of trainer objects
 */
export async function getAllTrainers() {
  const data = await loadTrainerSprites();
  return Object.values(data);
}

/**
 * Flatten trainer sprites structure for easy filtering
 * @param {object} trainerSprites - Nested trainer sprites object
 * @returns {Array} Flattened array of trainer objects
 */
export function flattenTrainerSprites(trainerSprites) {
  const flat = [];
  for (const [className, entries] of Object.entries(trainerSprites)) {
    for (const entry of entries) {
      if (typeof entry === "string") {
        flat.push({ name: className, sprite: entry, rarity: "common", filename: entry });
      } else if (entry?.file && !entry.disabled) {
        flat.push({
          name: className,
          sprite: entry.file,
          filename: entry.file,
          rarity: entry.rarity || "common"
        });
      }
    }
  }
  return flat;
}

/**
 * Get flattened trainers with caching
 * @returns {Promise<Array>} Flattened trainer array
 */
export async function getFlattenedTrainers() {
  const sprites = await loadTrainerSprites();
  return flattenTrainerSprites(sprites);
}

/**
 * Find Pokemon by name or ID (case-insensitive)
 * @param {string} query - Pokemon name or ID
 * @returns {Promise<object|null>} Pokemon object or null
 */
export async function findPokemonByName(query) {
  const allPokemon = await getAllPokemon();
  const input = query.toLowerCase();
  return (
    allPokemon.find(
      (p) =>
        p.name.toLowerCase() === input ||
        p.id.toString() === input ||
        (p.aliases && p.aliases.map((a) => a.toLowerCase()).includes(input))
    ) || null
  );
}

/**
 * Clear the data cache (useful for testing or reloading)
 */
export function clearCache() {
  cache.pokemonData = null;
  cache.trainerSprites = null;
}
