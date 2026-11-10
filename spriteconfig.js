/**
 * spriteConfig.js
 * Centralized sprite URL map and rarity emoji set for CoopBot v1.2
 * Used by trainercard.js, showtrainers.js, and pokedex.js
 */

export const rarityEmojis = {
  common: '⚬',
  uncommon: '✦︎',
  rare: '☆',
  epic: '✮✮',
  legendary: '✮✮✮',
  mythic: '✮✮✮✮'
};

export const rarityColors = {
  common: "#9ca3af",     // gray
  uncommon: "#10b981",   // green
  rare: "#3b82f6",       // blue
  epic: "#a855f7",       // purple
  legendary: "#facc15",  // gold
  mythic: "#ef4444",     // red
};

// Fly.io host (utils/publicUrl.js); the old Render hosts are retired.
import { publicBaseUrl } from './utils/publicUrl.js';
const BASE = publicBaseUrl();

export const spritePaths = {
  // Pokémon sprites (all generations). Prefer utils/sprites.js (manifest-checked).
  pokemon: `${BASE}/public/sprites/pokemon/normal/`,
  shiny: `${BASE}/public/sprites/pokemon/shiny/`,
  grayscale: `${BASE}/public/sprites/pokemon/grayscale/`,

  // Trainer sprites
  trainers: `${BASE}/public/sprites/trainers_2/`,
  trainersGray: `${BASE}/public/sprites/trainers_2/grayscale/`,
  // Breathing idle GIFs (tools/generate-trainer-idles.mjs); use utils/trainerAssets.js.
  trainersIdle: `${BASE}/public/sprites/trainers_idle/`,

  // Type icons (1–18; 18 = Fairy)
  types: `${BASE}/public/sprites/types/`,

  // NEW: item icons (e.g. Poké Ball placeholder)
  items: `${BASE}/public/sprites/items/`
};
