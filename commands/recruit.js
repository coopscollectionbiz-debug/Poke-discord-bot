import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import fs from 'fs/promises';
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';

const pokemonData = JSON.parse(await fs.readFile(new URL('../pokemonData.json', import.meta.url)));
const trainerSprites = JSON.parse(await fs.readFile(new URL('../trainerSprites.json', import.meta.url)));

const POKEMON_RARITY_WEIGHTS = { common: 60, uncommon: 24, rare: 10, epic: 4, legendary: 1.5, mythic: 0.5 };
const TRAINER_RARITY_WEIGHTS = { common: 65, uncommon: 22, rare: 8, epic: 3, legendary: 1, mythic: 1 };

export default {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Recruit a Pokémon or Trainer to your collection!'),

  async execute(interaction, trainerData, saveTrainerData) {
    const userId = interaction.user.id;
    if (!trainerData[userId]) trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    const user = trainerData[userId];

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

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle('🎯 Recruitment Time!')
          .setDescription('What would you like to recruit today?'),
      ],
      components: [
        new ActionRowBuilder().addComponents(typeMenu),
        new ActionRowBuilder().addComponents(cancelButton)
      ],
      ephemeral: true,
    });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: 120000
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
          await handlePokemonRecruit(i, user, saveTrainerData);
        } else {
          await handleTrainerRecruit(i, user, saveTrainerData);
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
  }
};

async function handlePokemonRecruit(interaction, user, saveTrainerData) {
  const candidates = Object.values(pokemonData).filter(p => p.generation <= 5);
  const pokemon = weightedRandomChoice(candidates, POKEMON_RARITY_WEIGHTS);
  const isShiny = rollForShiny(user.tp);
  user.pokemon[pokemon.name] = { owned: true, shiny: isShiny };
  await saveTrainerData();

  const sprite = isShiny
    ? `${spritePaths.shiny}${pokemon.id}.gif`
    : `${spritePaths.pokemon}${pokemon.id}.png`;

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(isShiny ? 0xffd700 : 0x00ae86)
        .setTitle('🎯 Pokémon Recruited!')
        .setDescription(isShiny
          ? `✨ You successfully recruited a **Shiny ${pokemon.name}!**`
          : `You recruited a **${pokemon.name}!**`)
        .setThumbnail(sprite)
        .setFooter({ text: 'Keep building your team!' })
    ],
    components: [],
    ephemeral: !isShiny,
  });
}

async function handleTrainerRecruit(interaction, user, saveTrainerData) {
  const trainer = weightedRandomChoice(Object.values(trainerSprites), TRAINER_RARITY_WEIGHTS);
  user.trainers[trainer.filename] = true;
  await saveTrainerData();

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('🎓 Trainer Recruited!')
        .setDescription(`You recruited a new **Trainer Sprite**: ${trainer.name}`)
        .setThumbnail(`${spritePaths.trainers}${trainer.filename}`)
        .setFooter({ text: 'View it later with /showtrainers!' })
    ],
    components: [],
    ephemeral: true,
  });
}

function weightedRandomChoice(items, weights) {
  const weighted = [];
  for (const item of items) {
    weighted.push(...Array(Math.round(weights[item.rarity?.toLowerCase()] || 1)).fill(item));
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}