// ==========================================================
// dataLoader.js
// Centralized JSON data loading with caching for performance
// Supports Pokémon data and Trainer sprites (tier-based).
// ==========================================================

import fs from "fs/promises";

// Cache for loaded JSON data
const cache = {
  pokemonData: null,
  trainerSprites: null,
};

// ==========================================================
// 🧩 Helper: Normalize Tier / Rarity
// ==========================================================
function normalizeTier(value) {
  const t = String(value || "common").toLowerCase();
  const map = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    epic: "epic",
    legendary: "legendary",
    mythic: "mythic",
  };
  return map[t] || "common";
}

// ==========================================================
// 🐉 Load Pokémon Data
// ==========================================================
export async function loadPokemonData() {
  if (cache.pokemonData) return cache.pokemonData;

  try {
    const data = JSON.parse(
      await fs.readFile(new URL("../pokemonData.json", import.meta.url))
    );
    console.log("✅ Pokémon data loaded:", Object.keys(data).length, "entries");
    cache.pokemonData = data;
    return data;
  } catch (err) {
    console.error("❌ Error loading pokemonData.json:", err);
    return {}; // return empty object instead of throwing
  }
}

/**
 * Get all Pokémon as an iterable array with normalized IDs
 */
export async function getAllPokemon() {
  const data = await loadPokemonData();
  if (!data || typeof data !== "object") {
    console.warn("⚠️ getAllPokemon: invalid data, returning empty array.");
    return [];
  }
  return Object.values(data).map((pokemon) => ({
    ...pokemon,
    id: Number(pokemon.id),
  }));
}

// ==========================================================
// 🧍 Load Trainer Sprites Data
// ==========================================================
export async function loadTrainerSprites() {
  if (cache.trainerSprites) return cache.trainerSprites;

  try {
    const data = JSON.parse(
      await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
    );
    cache.trainerSprites = data;
    console.log(
      "✅ Trainer sprites loaded:",
      Object.keys(data).length,
      "trainer groups"
    );
    return data;
  } catch (err) {
    console.error("❌ Error loading trainerSprites.json:", err);
    return {}; // safe default
  }
}

/**
 * Get all trainers as an iterable array
 */
export async function getAllTrainers() {
  let data;
  try {
    data = await loadTrainerSprites();
  } catch (err) {
    console.error("❌ getAllTrainers: failed to load trainerSprites.json:", err);
    return [];
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.warn("⚠️ getAllTrainers: invalid trainer data format, returning empty array.");
    return [];
  }

  return Object.values(data);
}

// ==========================================================
// 🔄 Flatten Trainer Structure
// ==========================================================
export function flattenTrainerSprites(trainerSprites) {
  const flat = [];

  if (!trainerSprites || typeof trainerSprites !== "object" || Array.isArray(trainerSprites)) {
    console.warn("⚠️ flattenTrainerSprites: invalid input. Returning empty array.");
    return flat;
  }

  for (const [key, node] of Object.entries(trainerSprites)) {
    // Supports both legacy and new schema:
    // A) { "key": [ {file:"..."}, "sprite.png" ] }
    // B) { "key": { sprites:[...], tier:"Epic" } }

    const sprites = Array.isArray(node)
      ? node
      : Array.isArray(node?.sprites)
      ? node.sprites
      : [];
    const baseTier = normalizeTier(node?.tier);

    for (const entry of sprites) {
      // Simple string entry → "sprite.png"
      if (typeof entry === "string") {
        const tier = baseTier || "common";
        flat.push({
          id: key,
          name: key,
          filename: entry,
          sprite: entry,
          tier,
          rarity: tier, // keep for compatibility
        });
        continue;
      }

      // Object entry → { file, tier?, rarity?, disabled? }
      if (entry && !entry.disabled) {
        const tier = normalizeTier(entry.tier || entry.rarity || baseTier || "common");
        flat.push({
          id: key,
          name: key,
          filename: entry.file,
          sprite: entry.file,
          tier,
          rarity: tier,
        });
      }
    }
  }

  return flat;
}

// ==========================================================
// 📜 Get Flattened Trainers with Caching
// ==========================================================
export async function getFlattenedTrainers() {
  let sprites;
  try {
    sprites = await loadTrainerSprites();
  } catch (err) {
    console.error("❌ getFlattenedTrainers: failed to load trainerSprites.json:", err);
    return [];
  }

  if (!sprites || typeof sprites !== "object" || Array.isArray(sprites)) {
    console.warn("⚠️ getFlattenedTrainers: invalid format, returning empty array.");
    return [];
  }

  const flat = flattenTrainerSprites(sprites);
  console.log("🧩 Flattened trainers count:", flat.length);
  return flat;
}

// ==========================================================
// 🔍 Find Pokémon by name or ID
// ==========================================================
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

// ==========================================================
// 🧹 Clear Cache
// ==========================================================
export function clearCache() {
  cache.pokemonData = null;
  cache.trainerSprites = null;
  console.log("🧼 Data caches cleared.");
}
