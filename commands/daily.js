import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField
} from 'discord.js';
import fs from 'fs/promises';
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';

const pokemonData = JSON.parse(await fs.readFile(new URL('../pokemonData.json', import.meta.url)));
const trainerSprites = JSON.parse(await fs.readFile(new URL('../trainerSprites.json', import.meta.url)));

const POKEMON_RARITY_WEIGHTS = {
  common: 60,
  uncommon: 24,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5
};
const TRAINER_RARITY_WEIGHTS = {
  common: 65,
  uncommon: 22,
  rare: 8,
  epic: 3,
  legendary: 1,
  mythic: 1
};

const DAILY_COOLDOWN_MS = 1000 * 60 * 60 * 24;
const DAILY_TP_REWARD = 50;
const DAILY_CC_REWARD = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily TP, CC, and choose a reward (Pokémon or Trainer)!'),

  async execute(interaction, trainerData, saveTrainerData) {
    const userId = interaction.user.id;
    if (!trainerData[userId]) {
      trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {}, lastDaily: 0 };
    }
    const user = trainerData[userId];

    // Cooldown check
    const now = Date.now();
    const lastDaily = user.lastDaily || 0;
    if (now - lastDaily < DAILY_COOLDOWN_MS) {
      const resetTime = new Date(lastDaily + DAILY_COOLDOWN_MS);
      const remainingMs = resetTime - now;
      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

      return interaction.reply({
        content:
          `⏰ Daily already claimed!\nNext available in **${hours}h ${minutes}m ${seconds}s** (${resetTime.toLocaleString()})`,
        ephemeral: true
      });
    }

    // Award TP/CC and set cooldown
    user.tp = (user.tp || 0) + DAILY_TP_REWARD;
    user.cc = (user.cc || 0) + DAILY_CC_REWARD;
    user.lastDaily = now;
    await saveTrainerData();

    // Choice: Pokémon or Trainer
    const typeMenu = new StringSelectMenuBuilder()
      .setCustomId('daily_type')
      .setPlaceholder('Choose your daily reward!')
      .addOptions([
        { label: 'Random Pokémon', value: 'pokemon', emoji: '🐾' },
        { label: 'Random Trainer', value: 'trainer', emoji: '🎓' },
      ]);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle('🎁 Daily Reward!')
          .setDescription(
            `You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**!\nChoose your bonus reward:`
          )
      ],
      components: [new ActionRowBuilder().addComponents(typeMenu)],
      ephemeral: true
    });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: 120000
    });

    collector.on('collect', async (i) => {
      if (i.customId === 'daily_type') {
        collector.stop();
        const choice = i.values[0];
        if (choice === 'pokemon') {
          await awardRandomPokemon(i, user, saveTrainerData);
        } else {
          await awardRandomTrainer(i, user, saveTrainerData);
        }
      }
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        interaction.editReply({
          content: '⏳ Time’s up! Run `/daily` again to claim your reward.',
          components: [],
          embeds: []
        });
      }
    });
  }
};

function weightedRandomChoice(items, weights) {
  const weighted = [];
  for (const item of items) {
    weighted.push(...Array(Math.round(weights[item.rarity.toLowerCase()] || 1)).fill(item));
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}

async function awardRandomPokemon(interaction, user, saveTrainerData) {
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
        .setTitle('🎁 Daily Pokémon Reward!')
        .setDescription(
          isShiny
            ? `✨ You found a **Shiny ${pokemon.name}!**`
            : `You received a **${pokemon.name}!**`
        )
        .setThumbnail(sprite)
        .setFooter({ text: 'Come back tomorrow for another reward!' })
    ],
    components: [],
    ephemeral: false
  });
}

async function awardRandomTrainer(interaction, user, saveTrainerData) {
  const candidates = Object.values(trainerSprites);
  const trainer = weightedRandomChoice(candidates, TRAINER_RARITY_WEIGHTS);
  user.trainers[trainer.filename] = true;
  await saveTrainerData();

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('🎁 Daily Trainer Reward!')
        .setDescription(`You received a **${trainer.name}!**`)
        .setThumbnail(`${spritePaths.trainers}${trainer.filename}`)
        .setFooter({ text: 'Come back tomorrow for another reward!' })
    ],
    components: [],
    ephemeral: false
  });
}