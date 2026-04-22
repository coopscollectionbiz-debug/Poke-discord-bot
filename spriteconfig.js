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

const BASE = process.env.RENDER_EXTERNAL_URL || 'https://poke-discord-bot-2.onrender.com';

export const spritePaths = {
  // Pokémon sprites (Gen 1–5)
  pokemon: `${BASE}/public/sprites/pokemon/normal/`,
  shiny: `${BASE}/public/sprites/pokemon/shiny/`,
  grayscale: `${BASE}/public/sprites/pokemon/grayscale/`,

  // Trainer sprites
  trainers: `${BASE}/public/sprites/trainers_2/`,
  trainersGray: `${BASE}/public/sprites/trainers_2/grayscale/`,

  // Type icons (1–17)
  types: `${BASE}/public/sprites/types/`,

  // NEW: item icons (e.g. Poké Ball placeholder)
  items: `${BASE}/public/sprites/items/`
};
