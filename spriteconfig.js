/**
 * spriteConfig.js
 * Centralized sprite URL map and rarity emoji set for CoopBot v1.2
 * Used by trainercard.js, showpokemon.js, showtrainers.js, and pokedex.js
 */

export const rarityEmojis = {
  common: '✰',
  uncommon: '✰✰',
  rare: '⭐',
  epic: '⭐⭐',
  legendary: '🌟',
  mythic: '🌟🌟'
};

export const spritePaths = {
  // Pokémon sprites (Gen 1–5)
  pokemon: 'https://poke-discord-bot.onrender.com/public/sprites/pokemon/normal/',
  shiny: 'https://poke-discord-bot.onrender.com/public/sprites/pokemon/shiny/',
  grayscale: 'https://poke-discord-bot.onrender.com/public/sprites/pokemon/grayscale/',

  // Trainer sprites
  trainers: 'https://poke-discord-bot.onrender.com/public/sprites/trainers_2/',
  trainersGray: 'https://poke-discord-bot.onrender.com/public/sprites/trainers_2/grayscale/',

  // Type icons (1–17)
  types: 'https://poke-discord-bot.onrender.com/public/sprites/types/',

  // NEW: item icons (e.g. Poké Ball placeholder)
  items: 'https://poke-discord-bot.onrender.com/public/sprites/items/'
};
