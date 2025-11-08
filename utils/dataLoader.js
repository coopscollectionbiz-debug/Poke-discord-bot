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
  if (cache.pokemonData) return cache.pokemonData;

  try {
    const data = JSON.parse(
      await fs.readFile(new URL("../pokemonData.json", import.meta.url))
    );
    console.log("✅ Successfully loaded Pokémon data:", Object.keys(data).length, "Pokémon");
    cache.pokemonData = data;
    return data;
  } catch (error) {
    console.error("❌ Error loading Pokémon data:", error);
    return {}; // ✅ return empty object instead of throwing
  }
}

/**
 * Get all Pokemon as an iterable array with normalized IDs
 * @returns {Promise<Array>} Array of Pokemon objects with consistent ID types
 */
export async function getAllPokemon() {
  const data = await loadPokemonData();
  if (!data || typeof data !== "object") {
    console.warn("⚠️ getAllPokemon: invalid data, returning empty array.");
    return [];
  }
  return Object.values(data).map(pokemon => ({
    ...pokemon,
    id: Number(pokemon.id) // Ensure ID is always a number
  }));
}

/**
 * Load and cache trainer sprites data
 * @returns {Promise<object>} Trainer sprites object
 */
export async function loadTrainerSprites() {
  if (cache.trainerSprites) return cache.trainerSprites;

  try {
    const data = JSON.parse(
      await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
    );
    cache.trainerSprites = data;
    return data;
  } catch (err) {
    console.error("❌ Error loading trainerSprites.json:", err);
    return {}; // ✅ safe default
  }
}

/**
 * Get all trainers as an iterable array
 * @returns {Promise<Array>} Array of trainer objects
 */
export async function getAllTrainers() {
  let data;
  try {
    data = await loadTrainerSprites();
  } catch (err) {
    console.error("❌ getAllTrainers: failed to load trainerSprites.json:", err);
    return [];
  }

  // 🧱 Guard: ensure we always return an array
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.warn("⚠️ getAllTrainers: invalid trainer data format, returning empty array.");
    return [];
  }

  return Object.values(data);
}

/**
 * Flatten trainer sprites structure for easy filtering
 * @param {object} trainerSprites - Nested trainer sprites object
 * @returns {Array} Flattened array of trainer objects
 */
export function flattenTrainerSprites(trainerSprites) {
  const flat = [];

  // 🧱 Guard clause to avoid "entries is not iterable"
  if (!trainerSprites || typeof trainerSprites !== "object" || Array.isArray(trainerSprites)) {
    console.warn("⚠️ flattenTrainerSprites: invalid trainerSprites input. Returning empty array.");
    return flat;
  }

  for (const [className, entries] of Object.entries(trainerSprites)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (typeof entry === "string") {
        flat.push({
          name: className,
          sprite: entry,
          rarity: "common",
          filename: entry
        });
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
  let sprites;
  try {
    sprites = await loadTrainerSprites();
  } catch (err) {
    console.error("❌ getFlattenedTrainers: failed to load trainerSprites.json:", err);
    return [];
  }

  // 🧱 Guard before flattening
  if (!sprites || typeof sprites !== "object" || Array.isArray(sprites)) {
    console.warn("⚠️ getFlattenedTrainers: invalid trainerSprites format, returning empty array.");
    return [];
  }

  return flattenTrainerSprites(sprites);
}

/**
 * Find Pokemon by name or ID (case-insensitive)
 * @param {string|number} query - Pokemon name or ID
 * @returns {Promise<object|null>} Pokemon object or null
 */
export async function findPokemonByName(query) {
  const allPokemon = await getAllPokemon();
  const input = String(query).toLowerCase();
  return (
    allPokemon.find(
      (p) =>
        p.name.toLowerCase() === input ||
        String(p.id) === input ||
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
