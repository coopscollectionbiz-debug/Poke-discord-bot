/**
 * /showtrainers — View your Trainer collection
 * Features: 3x4 grid (12 per page), Inspect modal, Search modal, Pagination
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { spritePaths, rarityEmojis } from '../spriteConfig.js';
import trainerSprites from '../data/trainerSprites.json' assert { type: 'json' };

const PAGE_SIZE = 12;

export default {
  data: new SlashCommandBuilder()
    .setName('showtrainers')
    .setDescription('View your Trainer collection with filters and search.')
    .addStringOption(opt =>
      opt
        .setName('rarity')
        .setDescription('Filter by rarity')
        .addChoices(
          { name: 'Common', value: 'common' },
          { name: 'Uncommon', value: 'uncommon' },
          { name: 'Rare', value: 'rare' },
          { name: 'Epic', value: 'epic' },
          { name: 'Legendary', value: 'legendary' },
          { name: 'Mythic', value: 'mythic' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('ownership')
        .setDescription('Filter by owned/unowned')
        .addChoices(
          { name: 'Owned only', value: 'owned' },
          { name: 'Unowned only', value: 'unowned' }
        )
    ),

  async execute(interaction, trainerData) {
    const userId = interaction.user.id;
    const user = trainerData[userId] || { trainers: {} };
    const owned = user.trainers || {};

    // Filters
    const rarityFilter = interaction.options.getString('rarity');
    const ownershipFilter = interaction.options.getString('ownership');

    // Filter dataset
    let filtered = Object.entries(trainerSprites);
    if (rarityFilter) {
      filtered = filtered.filter(([_, data]) =>
        data.rarity.toLowerCase() === rarityFilter.toLowerCase()
      );
    }
    if (ownershipFilter === 'owned') {
      filtered = filtered.filter(([id]) => owned[id]);
    } else if (ownershipFilter === 'unowned') {
      filtered = filtered.filter(([id]) => !owned[id]);
    }

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    let page = 0;
    let highlightId = null;

    const renderPage = async () => {
      const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const embed = new EmbedBuilder()
        .setColor(0x6c43f3)
        .setTitle(`${interaction.user.username}'s Trainer Collection`)
        .setFooter({ text: `Page ${page + 1}/${totalPages}` });

      let desc = '';

      slice.forEach(([id, data]) => {
        const isOwned = !!owned[id];
        const spriteBase = isOwned
          ? spritePaths.trainers
          : spritePaths.trainersGray;
        const sprite = `${spriteBase}${data.filename}`;
        const rarity = rarityEmojis[data.rarity.toLowerCase()] || '⚪';
        const highlight = id === highlightId ? '⭐ ' : '';
        desc += `${highlight}${rarity} **${data.name}**\n[‎](${sprite})\n\n`;
      });

      embed.setDescription(desc || 'No Trainers match your filters.');

      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setEmoji('⬅️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('next')
          .setEmoji('➡️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages - 1),
        new ButtonBuilder()
          .setCustomId('search')
          .setLabel('🔍 Search Trainer')
          .setStyle(ButtonStyle.Primary)
      );

      // Inspect buttons
      const inspectRows = [];
      for (const [id, data] of slice) {
        inspectRows.push(
          new ButtonBuilder()
            .setCustomId(`inspect_${id}`)
            .setLabel(`👁️ ${data.name}`)
            .setStyle(ButtonStyle.Secondary)
        );
      }

      const buttonRows = [];
      for (let i = 0; i < inspectRows.length; i += 5) {
        buttonRows.push(
          new ActionRowBuilder().addComponents(inspectRows.slice(i, i + 5))
        );
      }

      await interaction.editReply({
        embeds: [embed],
        components: [...buttonRows, navRow]
      }).catch(async () => {
        await interaction.reply({
          embeds: [embed],
          components: [...buttonRows, navRow],
          ephemeral: true
        });
      });
    };

    await interaction.deferReply({ ephemeral: true });
    await renderPage();

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 180_000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId)
        return i.reply({ content: '❌ This is not your collection.', ephemeral: true });

      if (i.customId === 'prev' && page > 0) page--;
      else if (i.customId === 'next' && page < totalPages - 1) page++;

      if (i.customId === 'search') {
        const modal = new ModalBuilder()
          .setCustomId('search_modal')
          .setTitle('Search Trainer');

        const searchInput = new TextInputBuilder()
          .setCustomId('search_name')
          .setLabel('Enter Trainer name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., Red, Brock, Rocket Grunt')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
        await i.showModal(modal);

        try {
          const submitted = await i.awaitModalSubmit({
            filter: m => m.user.id === userId,
            time: 30000
          });
          const searchName = submitted.fields
            .getTextInputValue('search_name')
            .trim()
            .toLowerCase();

          const match = filtered.find(
            ([_, data]) => data.name.toLowerCase() === searchName
          );
          if (match) {
            const matchIndex = filtered.findIndex(([id]) => id === match[0]);
            page = Math.floor(matchIndex / PAGE_SIZE);
            highlightId = match[0];
            await submitted.reply({
              content: `⭐ Found ${match[1].name}!`,
              ephemeral: true
            });
            await renderPage();
          } else {
            await submitted.reply({
              content: '❌ No Trainer found by that name.',
              ephemeral: true
            });
          }
        } catch {
          await i.followUp({ content: '⏱️ Search timed out.', ephemeral: true });
        }
        return;
      }

      if (i.customId.startsWith('inspect_')) {
        const id = i.customId.split('_')[1];
        const data = trainerSprites[id];
        if (!data)
          return i.reply({ content: 'Trainer not found.', ephemeral: true });

        const isOwned = !!owned[id];
        const spriteBase = isOwned
          ? spritePaths.trainers
          : spritePaths.trainersGray;
        const sprite = `${spriteBase}${data.filename}`;
        const rarity = rarityEmojis[data.rarity.toLowerCase()] || '⚪';
        const ownedText = isOwned ? '✅ Owned' : '❌ Not Owned';

        const embed = new EmbedBuilder()
          .setColor(0x6c43f3)
          .setTitle(`${rarity} ${data.name}`)
          .setDescription(`${ownedText}`)
          .setImage(sprite);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('back_to_showtrainers')
            .setLabel('⬅️ Back')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('close_trainer_inspect')
            .setLabel('❌ Close')
            .setStyle(ButtonStyle.Danger)
        );

        await i.reply({ embeds: [embed], components: [row], ephemeral: true });

        const reply = await i.fetchReply();
        const subCollector = reply.createMessageComponentCollector({ time: 60000 });

        subCollector.on('collect', async j => {
          if (j.user.id !== userId)
            return j.reply({ content: '❌ Not your session.', ephemeral: true });

          if (j.customId === 'back_to_showtrainers') {
            await j.deferUpdate();
            await renderPage();
            subCollector.stop();
            return;
          }

          if (j.customId === 'close_trainer_inspect') {
            await j.update({ content: '❌ Closed.', embeds: [], components: [] });
            subCollector.stop();
            return;
          }
        });
        return;
      }

      await i.deferUpdate();
      await renderPage();
    });

    collector.on('end', async () => {
      try {
        await msg.edit({ components: [] });
      } catch {}
    });
  }
};
