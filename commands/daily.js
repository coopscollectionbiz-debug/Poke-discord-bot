// commands/daily.js
// ==========================================================
// 🎁 Daily Pokémon Command with Shiny System Integration
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import pokemonData from '../pokemonData.json' assert { type: 'json' };
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';

// Helper for dynamic Pokémon sprites
const getPokemonSprite = (id, shiny = false) =>
  shiny
    ? `${spritePaths.shiny}${id}.gif`
    : `${spritePaths.pokemon}${id}.png`;

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily Pokémon reward!'),

  async execute(interaction, trainerData) {
    const userId = interaction.user.id;
    if (!trainerData[userId]) {
      trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    }

    const user = trainerData[userId];
    const randomPokemon = getRandomPokemon();
    const pokemonInfo = pokemonData[randomPokemon];
    const id = pokemonInfo.id;
    const isShiny = rollForShiny(user.tp);

    trainerData[userId].pokemon[randomPokemon] = { owned: true, shiny: isShiny };

    const sprite = getPokemonSprite(id, isShiny);
    const displayName = isShiny ? `✨ Shiny ${randomPokemon}` : randomPokemon;

    const embed = new EmbedBuilder()
      .setColor(isShiny ? 0xffd700 : 0x00ae86)
      .setTitle('🎁 Daily Pokémon Reward!')
      .setDescription(
        isShiny
          ? `✨ You found a **Shiny ${randomPokemon}!**`
          : `You received a **${randomPokemon}!**`
      )
      .setThumbnail(sprite)
      .setFooter({ text: 'Come back tomorrow for another reward!' });

    await interaction.reply({ embeds: [embed] });
  },
};

// ==========================================================
// 🎲 Helper: Random Pokémon (Gen 1–5)
// ==========================================================
function getRandomPokemon() {
  const candidates = Object.values(pokemonData).filter(p => p.generation <= 5);
  const random = Math.floor(Math.random() * candidates.length);
  return candidates[random].name;
}
