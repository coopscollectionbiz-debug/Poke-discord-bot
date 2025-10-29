import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';
import pokemonData from '../pokemonData.json' assert { type: 'json' };
import trainerSprites from '../trainerSprites.json' assert { type: 'json' };

export default {
  data: new SlashCommandBuilder()
    .setName('trainercard')
    .setDescription('View your trainer card or start your journey if new!'),

  async execute(interaction, trainerData, saveTrainerData) {
    const userId = interaction.user.id;
    const user = trainerData[userId];

    // Onboarding flow for new users
    if (!user || !user.starter || !user.trainerSprite) {
      return startOnboardingFlow(interaction, trainerData, saveTrainerData);
    }

    // Existing user display
    const tp = user.tp || 0;
    const cc = user.cc || 0;
    const starter = user.starter || 'Unknown';
    const sprite = user.trainerSprite || 'Unknown';
    const starterId = pokemonData[starter]?.id || 0;
    const starterIsShiny = user.pokemon?.[starter]?.shiny;

    const starterSprite = starterId
      ? (starterIsShiny
        ? `${spritePaths.shiny}${starterId}.gif`
        : `${spritePaths.pokemon}${starterId}.png`)
      : null;
    const trainerSprite = sprite !== 'Unknown'
      ? `${spritePaths.trainers}${sprite}`
      : null;

    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle(`${interaction.user.username}’s Trainer Card`)
      .setDescription(
        `**Starter Pokémon:** ${starterIsShiny ? '✨ Shiny ' : ''}${starter}\n` +
        `**Trainer Sprite:** ${sprite}\n**TP:** ${tp}\n**CC:** ${cc}`
      )
      .setThumbnail(starterSprite)
      .setImage(trainerSprite)
      .setFooter({ text: "Use /showpokemon or /showtrainers to view your collection!" });

    return interaction.reply({ embeds: [embed], ephemeral: false });
  },
};

async function startOnboardingFlow(interaction, trainerData, saveTrainerData) {
  const userId = interaction.user.id;
  const user = trainerData[userId] || { tp: 0, cc: 0, pokemon: {}, trainers: {} };
  trainerData[userId] = user;

  // Step 1: Choose Starter Pokémon (Gen 1–5, rarity-weighted)
  const starters = Object.values(pokemonData).filter(p => p.generation <= 5);
  const weightedStarters = weightedRandomArray(starters, {
    common: 60, uncommon: 24, rare: 10, epic: 4, legendary: 1.5, mythic: 0.5
  });
  const starterOptions = Array.from(new Set(weightedStarters.map(p => p.name))).slice(0, 25).map(pname => {
    const p = pokemonData[pname];
    return { label: p.name, value: p.name, emoji: p.emoji || '✨' };
  });

  const starterMenu = new StringSelectMenuBuilder()
    .setCustomId('select_starter')
    .setPlaceholder('Choose your starter Pokémon (Gen 1–5)!')
    .addOptions(starterOptions);

  const starterRow = new ActionRowBuilder().addComponents(starterMenu);
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cancel_onboard').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle("🎉 Welcome to Coop’s Collection!")
        .setDescription("Let's get started!\n\nChoose your **Starter Pokémon** to begin your journey."),
    ],
    components: [starterRow, cancelRow],
    ephemeral: true,
  });

  const starterCollector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 300000,
  });

  starterCollector.on('collect', async (i) => {
    if (i.customId === 'cancel_onboard') {
      starterCollector.stop();
      return i.update({ content: '❌ Onboarding cancelled.', embeds: [], components: [] });
    }
    if (i.customId === 'select_starter') {
      const starter = i.values[0];
      starterCollector.stop();
      await chooseTrainerSprite(i, trainerData, saveTrainerData, starter);
    }
  });

  starterCollector.on('end', (collected, reason) => {
    if (reason === 'time') {
      interaction.editReply({ content: '⏳ Time’s up! Run `/trainercard` again to restart onboarding.', components: [], embeds: [] });
    }
  });
}

async function chooseTrainerSprite(interaction, trainerData, saveTrainerData, starter) {
  const userId = interaction.user.id;
  const spriteMenu = new StringSelectMenuBuilder()
    .setCustomId('select_trainer_sprite')
    .setPlaceholder('Choose your trainer appearance!')
    .addOptions(Object.values(trainerSprites).slice(0, 10).map(t =>
      ({ label: t.name, value: t.filename, emoji: t.emoji || '🧑' })
    ));

  const spriteRow = new ActionRowBuilder().addComponents(spriteMenu);
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cancel_onboard').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('🎨 Choose Your Trainer Sprite')
        .setDescription('Pick how you’d like to appear on your Trainer Card!'),
    ],
    components: [spriteRow, cancelRow],
  });

  const spriteCollector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 300000,
  });

  spriteCollector.on('collect', async (i) => {
    if (i.customId === 'cancel_onboard') {
      spriteCollector.stop();
      return i.update({ content: '❌ Onboarding cancelled.', embeds: [], components: [] });
    }
    if (i.customId === 'select_trainer_sprite') {
      const sprite = i.values[0];
      spriteCollector.stop();
      await confirmSetup(i, trainerData, saveTrainerData, starter, sprite);
    }
  });

  spriteCollector.on('end', (collected, reason) => {
    if (reason === 'time') {
      interaction.editReply({ content: '⏳ Time’s up! Run `/trainercard` again to restart onboarding.', components: [], embeds: [] });
    }
  });
}

async function confirmSetup(interaction, trainerData, saveTrainerData, starter, sprite) {
  const userId = interaction.user.id;
  const user = trainerData[userId] || { tp: 0, cc: 0, pokemon: {}, trainers: {} };

  const starterId = pokemonData[starter]?.id;
  const isShiny = rollForShiny(user.tp);
  const starterSprite = starterId ? (isShiny ? `${spritePaths.shiny}${starterId}.gif` : `${spritePaths.pokemon}${starterId}.png`) : null;
  const trainerSprite = `${spritePaths.trainers}${sprite}`;

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_start').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel_onboard').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('✅ Confirm Your Setup')
        .setDescription(`**Starter:** ${isShiny ? '✨ Shiny ' : ''}${starter}\n**Trainer Sprite:** ${sprite}`)
        .setThumbnail(starterSprite)
        .setImage(trainerSprite),
    ],
    components: [confirmRow],
  });

  const collector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 300000,
  });

  collector.on('collect', async (i) => {
    if (i.customId === 'cancel_onboard') {
      collector.stop();
      return i.update({ content: '❌ Onboarding cancelled.', embeds: [], components: [] });
    }
    if (i.customId === 'confirm_start') {
      user.starter = starter;
      user.trainerSprite = sprite;
      user.pokemon[starter] = { owned: true, shiny: isShiny };
      user.trainers[sprite] = true;
      trainerData[userId] = user;
      await saveTrainerData();

      const nickname = i.member?.nickname || i.user.username;
      await i.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00ae86)
            .setTitle(`🎉 Welcome ${nickname}!`)
            .setDescription(`Your journey begins with ${isShiny ? '✨ Shiny ' : ''}${starter}!`)
            .setThumbnail(starterSprite)
            .setImage(trainerSprite),
        ],
        components: [],
      });

      console.log(`[TRAINERCARD] Onboarded new user: ${i.user.username}`);
      collector.stop();
    }
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time') {
      interaction.editReply({ content: '⏳ Time’s up! Run `/trainercard` again to restart onboarding.', components: [], embeds: [] });
    }
  });
}

function weightedRandomArray(items, weights) {
  const weighted = [];
  for (const item of items) {
    weighted.push(...Array(Math.round(weights[item.rarity?.toLowerCase()] || 1)).fill(item));
  }
  return weighted;
}