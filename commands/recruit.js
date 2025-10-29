// commands/recruit.js
// ==========================================================
// 🎯 Recruit Command with Selection (Pokémon or Trainer) + Shiny Integration
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import pokemonData from '../pokemonData.json' assert { type: 'json' };
import trainerSprites from '../trainerSprites.json' assert { type: 'json' };
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';

// Helper for dynamic Pokémon sprites
const getPokemonSprite = (id, shiny = false) =>
  shiny
    ? `${spritePaths.shiny}${id}.gif`
    : `${spritePaths.pokemon}${id}.png`;

export default {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Recruit a Pokémon or Trainer to your collection!'),

  async execute(interaction, trainerData) {
    const userId = interaction.user.id;
    if (!trainerData[userId]) {
      trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    }

    const typeMenu = new StringSelectMenuBuilder()
      .setCustomId('recruit_type')
      .setPlaceholder('Choose what to recruit!')
      .addOptions([
        { label: 'Recruit Pokémon', value: 'pokemon', emoji: '🐾' },
        { label: 'Recruit Trainer', value: 'trainer', emoji: '🎓' },
      ]);

    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_recruit')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(typeMenu);
    const cancelRow = new ActionRowBuilder().addComponents(cancelButton);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle('🎯 Recruitment Time!')
          .setDescription('What would you like to recruit today?'),
      ],
      components: [row, cancelRow],
      ephemeral: true,
    });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: 120000, // 2 minutes
    });

    collector.on('collect', async (i) => {
      if (i.customId === 'cancel_recruit') {
        collector.stop();
        return i.update({
          content: '❌ Recruitment cancelled.',
          embeds: [],
          components: [],
        });
      }

      if (i.customId === 'recruit_type') {
        const choice = i.values[0];
        collector.stop();

        if (choice === 'pokemon') {
          await handlePokemonRecruit(i, trainerData, userId);
        } else if (choice === 'trainer') {
          await handleTrainerRecruit(i, trainerData, userId);
        }
      }
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        interaction.editReply({
          content: '⏳ Time’s up! Run `/recruit` again to try recruiting.',
          components: [],
          embeds: [],
        });
      }
    });
  },
};

// ==========================================================
// 🐾 Pokémon Recruit Flow
// ==========================================================
async function handlePokemonRecruit(interaction, trainerData, userId) {
  const user = trainerData[userId];
  const randomPokemon = getRandomPokemon();
  const pokemonInfo = pokemonData[randomPokemon];
  const id = pokemonInfo.id;
  const isShiny = rollForShiny(user.tp);

  trainerData[userId].pokemon[randomPokemon] = { owned: true, shiny: isShiny };

  const sprite = getPokemonSprite(id, isShiny);
  const embed = new EmbedBuilder()
    .setColor(isShiny ? 0xffd700 : 0x00ae86)
    .setTitle('🎯 Pokémon Recruited!')
    .setDescription(
      isShiny
        ? `✨ You successfully recruited a **Shiny ${randomPokemon}!**`
        : `You recruited a **${randomPokemon}!**`
    )
    .setThumbnail(sprite)
    .setFooter({ text: 'Keep building your team!' });

  await interaction.update({
    embeds: [embed],
    components: [],
    ephemeral: !isShiny, // shiny = public, normal = ephemeral
  });
}

// ==========================================================
// 🎓 Trainer Recruit Flow
// ==========================================================
async function handleTrainerRecruit(interaction, trainerData, userId) {
  const allTrainerSprites = Object.values(trainerSprites)
    .flatMap((t) => t.sprites || [])
    .filter((f) => f.endsWith('.png'));

  const randomTrainer =
    allTrainerSprites[Math.floor(Math.random() * allTrainerSprites.length)];
  trainerData[userId].trainers[randomTrainer] = true;

  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle('🎓 Trainer Recruited!')
    .setDescription(`You recruited a new **Trainer Sprite**: ${randomTrainer}`)
    .setThumbnail(`${spritePaths.trainers}${randomTrainer}`)
    .setFooter({ text: 'View it later with /showtrainers!' });

  await interaction.update({
    embeds: [embed],
    components: [],
    ephemeral: true,
  });
}

// ==========================================================
// 🎲 Helpers
// ==========================================================
function getRandomPokemon() {
  const candidates = Object.values(pokemonData).filter((p) => p.generation <= 5);
  const random = Math.floor(Math.random() * candidates.length);
  return candidates[random].name;
}
