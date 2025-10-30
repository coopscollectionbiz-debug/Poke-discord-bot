import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs/promises';
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';

const pokemonData = JSON.parse(await fs.readFile(new URL('../pokemonData.json', import.meta.url)));

const getPokemonSprite = (id, shiny = false) =>
  shiny
    ? `${spritePaths.shiny}${id}.gif`
    : `${spritePaths.pokemon}${id}.png`;

export default {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Complete a quest and earn a Pokémon or trainer reward!'),

  async execute(interaction, trainerData) {
  await interaction.deferReply({ flags: 64 });  
  const userId = interaction.user.id;
    if (!trainerData[userId]) {
      trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    }

    const user = trainerData[userId];
    const rewardType = Math.random() < 0.7 ? 'pokemon' : 'trainer';

    if (rewardType === 'pokemon') {
      const randomPokemon = getRandomPokemon();
      const pokemonInfo = pokemonData[randomPokemon];
      const id = pokemonInfo.id;
      const isShiny = rollForShiny(user.tp);
      trainerData[userId].pokemon[randomPokemon] = { owned: true, shiny: isShiny };

      const sprite = getPokemonSprite(id, isShiny);
      const displayName = isShiny ? `✨ Shiny ${randomPokemon}` : randomPokemon;

      const embed = new EmbedBuilder()
        .setColor(isShiny ? 0xffd700 : 0x00ae86)
        .setTitle('🏆 Quest Complete!')
        .setDescription(
          isShiny
            ? `✨ Incredible! You earned a **Shiny ${randomPokemon}** as your quest reward!`
            : `You earned a **${randomPokemon}** as your quest reward!`
        )
        .setThumbnail(sprite)
        .setFooter({ text: 'Keep completing quests for rare rewards!' });

      await interaction.reply({ embeds: [embed] });
    } else {
      const trainerReward = getRandomTrainerSprite();
      trainerData[userId].trainers[trainerReward] = true;

      const embed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('🏆 Quest Complete!')
        .setDescription(`You unlocked a new **Trainer Sprite**: ${trainerReward}`)
        .setThumbnail(`${spritePaths.trainers}${trainerReward}`)
        .setFooter({ text: 'Try equipping it with /trainercard!' });

      await interaction.reply({ embeds: [embed] });
    }
  },
};

function getRandomPokemon() {
  const candidates = Object.values(pokemonData).filter(p => p.generation <= 5);
  const random = Math.floor(Math.random() * candidates.length);
  return candidates[random].name;
}

function getRandomTrainerSprite() {
  // You may want to load this from trainerSprites.json instead
  const sprites = ['youngster-gen4.png', 'lass-gen4.png'];
  const random = Math.floor(Math.random() * sprites.length);
  return sprites[random];
}