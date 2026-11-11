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

export const spritePaths = {
  // Pokémon sprites (Gen 1–5)
  pokemon: '/public/sprites/pokemon/normal/',
  shiny: '/public/sprites/pokemon/shiny/',
  grayscale: '/public/sprites/pokemon/grayscale/',

  // Trainer sprites
  trainers: '/public/sprites/trainers_2/',
  trainersGray: '/public/sprites/trainers_2/grayscale/',
  trainersIdle: '/public/sprites/trainers_idle/',

  // Type icons (1–17)
  types: '/public/sprites/types/',

  // NEW: item icons (e.g. Poké Ball placeholder)
  items: '/public/sprites/items/'
};
