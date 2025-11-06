// ==========================================================
// utils/pokemonCache.js
// Centralized Pokemon data caching to avoid repeated slow loads
// ==========================================================

import { getAllPokemon } from "./dataLoader.js";

let pokemonCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Get Pokemon data from cache, or load fresh if expired
 * @returns {Promise<Array>} Array of Pokemon objects
 */
export async function getPokemonCached() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (pokemonCache && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log(`📦 Using cached Pokemon data (${Math.round((now - cacheTimestamp) / 1000)}s old)`);
    return pokemonCache;
  }
  
  // Load fresh data
  console.log(`📦 Loading Pokemon data (cache miss or expired)`);
  pokemonCache = await getAllPokemon();
  cacheTimestamp = now;
  
  return pokemonCache;
}

/**
 * Manually clear the cache (useful after data updates)
 */
export function clearPokemonCache() {
  pokemonCache = null;
  cacheTimestamp = 0;
  console.log(`🧹 Pokemon cache cleared`);
}

/**
 * Get cache age in seconds
 * @returns {number} Age of cache in seconds, or 0 if expired/empty
 */
export function getCacheAge() {
  if (!pokemonCache) return 0;
  return Math.round((Date.now() - cacheTimestamp) / 1000);
}

/**
 * Check if cache is valid
 * @returns {boolean} True if cache exists and is not expired
 */
export function isCacheValid() {
  if (!pokemonCache) return false;
  return (Date.now() - cacheTimestamp) < CACHE_DURATION;
}