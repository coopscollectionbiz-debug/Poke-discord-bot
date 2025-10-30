import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import fs from 'fs/promises';
import { spritePaths } from '../spriteconfig.js';
import { rollForShiny } from '../helpers/shinyOdds.js';

// Dynamic JSON loading for Node.js 20+/25+ and Discord.js v14.14.1
const pokemonData = JSON.parse(await fs.readFile(new URL('../pokemonData.json', import.meta.url)));
const trainerSprites = JSON.parse(await fs.readFile(new URL('../trainerSprites.json', import.meta.url)));

const PAGE_SIZE = 25; // Discord select menu option limit

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

    // Discord.js v14: ephemeral is supported but deprecated in v15. Use flags instead if you upgrade.
    return interaction.reply({ embeds: [embed], ephemeral: false });
  },
};

async function startOnboardingFlow(interaction, trainerData, saveTrainerData) {
  const userId = interaction.user.id;
  const user = trainerData[userId] || { tp: 0, cc: 0, pokemon: {}, trainers: {} };
  trainerData[userId] = user;

  // Paginated starter picker
  // FIX: Use correct filter for Gen 1-5 starters (most Pokémon have no 'generation', so let's fallback to region)
  const starters = Object.values(pokemonData).filter(
    p => ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova'].includes(p.region)
  );
  const starterNames = Array.from(new Set(starters.map(p => p.name))).sort();
  let page = 0;
  const totalPages = Math.ceil(starterNames.length / PAGE_SIZE);

  // Robust error handling: If no starters, show error and abort
  if (starterNames.length === 0) {
    await interaction.reply({
      content: '❌ No starter Pokémon found! Please check your pokemonData.json for valid entries.',
      ephemeral: true
    });
    return;
  }

  async function renderStarterMenu() {
    const options = starterNames.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(pname => {
      const p = pokemonData[Object.keys(pokemonData).find(
        k => pokemonData[k].name === pname
      )];
      return {
        label: p.name,
        value: p.name,
        emoji: p.emoji || undefined,
      };
    });

    const starterMenu = new StringSelectMenuBuilder()
      .setCustomId('select_starter')
      .setPlaceholder('Choose your starter Pokémon!')
      .addOptions(options);

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_starter_page')
        .setLabel('⬅️ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('next_starter_page')
        .setLabel('Next ➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cancel_onboard')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle("🎉 Welcome to Coop’s Collection!")
          .setDescription(`Page ${page + 1} of ${totalPages}\nChoose your **Starter Pokémon** to begin your journey.`),
      ],
      components: [new ActionRowBuilder().addComponents(starterMenu), navRow, cancelRow],
      ephemeral: true,
    });
  }

  // First message
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle("🎉 Welcome to Coop’s Collection!")
        .setDescription(`Page ${page + 1} of ${totalPages}\nChoose your **Starter Pokémon** to begin your journey.`),
    ],
    components: [],
    ephemeral: true,
  });
  await renderStarterMenu();

  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({ time: 300000 });

  collector.on('collect', async (i) => {
    if (i.user.id !== userId) return i.reply({ content: 'Not your session.', ephemeral: true });

    if (i.customId === 'next_starter_page' && page < totalPages - 1) {
      page++;
      await i.deferUpdate();
      await renderStarterMenu();
    } else if (i.customId === 'prev_starter_page' && page > 0) {
      page--;
      await i.deferUpdate();
      await renderStarterMenu();
    } else if (i.customId === 'select_starter') {
      collector.stop();
      await chooseTrainerSprite(i, trainerData, saveTrainerData, i.values[0]);
    } else if (i.customId === 'cancel_onboard') {
      collector.stop();
      await i.update({ content: '❌ Onboarding cancelled.', embeds: [], components: [] });
    }
  });

  collector.on('end', (collected, reason) => {
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

  const starterId = pokemonData[Object.keys(pokemonData).find(k => pokemonData[k].name === starter)]?.id;
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