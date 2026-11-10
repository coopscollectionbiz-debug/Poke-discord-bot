// ==========================================================
// dataLoader.js
// Centralized JSON data loading with caching for performance
// Supports Pokémon data and Trainer sprites (tier-based).
// ==========================================================

import { acquirablePokemon, nameKey } from "./speciesCatalog.js";
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

/**
 * Species that may be newly acquired right now (live generations only,
 * complete battle data/sprites/metadata). Use this for every encounter,
 * reward and shop pool; use getAllPokemon() for display and look-ups.
 */
export async function getAcquirablePokemon() {
  return acquirablePokemon(await getAllPokemon());
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
// 📜 Get Flattened Trainers with Normalization & Caching
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
// 🔧 Flatten and Normalize Trainer Sprites (Respects "disabled" flag)
// ==========================================================
export function flattenTrainerSprites(spritesObj) {
  const flat = [];

  for (const [key, info] of Object.entries(spritesObj)) {
    const lowerKey = key.toLowerCase();

    // Build sprite array from strings or {file}
    let spriteArray = [];

    if (Array.isArray(info.sprites)) {
      spriteArray = info.sprites
        .map(s => {
          if (typeof s === "string") return s.toLowerCase();
          if (typeof s === "object" && s?.file && !s.disabled)
            return String(s.file).toLowerCase();
          return null;
        })
        .filter(Boolean);
    }

    // A group whose sprites are all disabled has nothing to give or sell.
    // (This used to fall back to "<key>.png", a file that mostly doesn't
    // exist, so admin rolls and the Starter Pack could grant a sprite that
    // never renders.)
    if (spriteArray.length === 0) continue;

    const spriteFile = spriteArray[0];

    flat.push({
      id: lowerKey,
      name: lowerKey.charAt(0).toUpperCase() + lowerKey.slice(1),
      tier: info.tier || "Common",
      sprites: spriteArray,
      filename: spriteFile,
      spriteFile: spriteFile,
    });
  }

  return flat;
}


// ==========================================================
// 🔍 Find Pokémon by name or ID
// ==========================================================
export async function findPokemonByName(query) {
  const allPokemon = await getAllPokemon();
  const input = String(query).toLowerCase();
  const key = nameKey(query);
  return (
    allPokemon.find(
      (p) =>
        p.name.toLowerCase() === input ||
        nameKey(p.name) === key ||
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
