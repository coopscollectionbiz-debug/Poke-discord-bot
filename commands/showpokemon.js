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
import fs from 'fs/promises';
import { spritePaths, rarityEmojis } from '../spriteconfig.js';

const pokemonData = JSON.parse(await fs.readFile(new URL('../pokemonData.json', import.meta.url)));
const PAGE_SIZE = 12;

export default {
  data: new SlashCommandBuilder()
    .setName('showpokemon')
    .setDescription('View your Pokémon collection with filters and search.')
    .addStringOption(opt =>
      opt.setName('type').setDescription('Filter by Pokémon type')
    )
    .addStringOption(opt =>
      opt.setName('rarity')
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
    .addBooleanOption(opt =>
      opt.setName('shiny').setDescription('Show shiny variants only')
    )
    .addStringOption(opt =>
      opt.setName('ownership')
        .setDescription('Filter by owned/unowned')
        .addChoices(
          { name: 'Owned only', value: 'owned' },
          { name: 'Unowned only', value: 'unowned' }
        )
    ),
  async execute(interaction, trainerData) {
    const userId = interaction.user.id;
    const user = trainerData[userId] || { pokemon: {} };
    const owned = user.pokemon || {};

    // Filters
    const typeFilter = interaction.options.getString('type');
    const rarityFilter = interaction.options.getString('rarity');
    const shiny = interaction.options.getBoolean('shiny') || false;
    const ownershipFilter = interaction.options.getString('ownership');

    let filtered = Object.entries(pokemonData);
    if (typeFilter) {
      filtered = filtered.filter(([_, data]) =>
        data.type.some(t => t.toLowerCase() === typeFilter.toLowerCase())
      );
    }
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

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    let page = 0;
    let highlightId = null;

    const renderPage = async () => {
      const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`${interaction.user.username}'s Pokémon Collection`)
        .setFooter({ text: `Page ${page + 1}/${totalPages}` });

      let desc = '';
      slice.forEach(([id, data]) => {
        const isOwned = !!owned[id];
        const spriteBase = shiny
          ? spritePaths.shiny
          : isOwned
            ? spritePaths.pokemon
            : spritePaths.grayscale;
        const sprite = `${spriteBase}${id}.gif`;
        const rarity = rarityEmojis[data.rarity.toLowerCase()] || '⚪';
        const highlight = id === highlightId ? '⭐ ' : '';
        desc += `${highlight}${rarity} **${data.name}**\n[‎](${sprite})\n\n`;
      });

      embed.setDescription(desc || 'No Pokémon match your filters.');

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
          .setDisabled(page === totalPages - 1 || totalPages <= 1),
        new ButtonBuilder()
          .setCustomId('search')
          .setLabel('🔍 Search Pokémon')
          .setStyle(ButtonStyle.Primary)
      );

      // Inspect buttons for the slice
      const inspectRows = [];
      for (const [id, data] of slice) {
        inspectRows.push(
          new ButtonBuilder()
            .setCustomId(`inspect_${id}`)
            .setLabel(`📖 ${data.name}`)
            .setStyle(ButtonStyle.Secondary)
        );
      }
      const buttonRows = [];
      for (let i = 0; i < inspectRows.length; i += 5) {
        buttonRows.push(new ActionRowBuilder().addComponents(inspectRows.slice(i, i + 5)));
      }

      await interaction.editReply({
        embeds: [embed],
        components: [...buttonRows, navRow],
      }).catch(async () => {
        await interaction.reply({
          embeds: [embed],
          components: [...buttonRows, navRow],
          ephemeral: true
        });
      });
    };

    // initial render
    await interaction.deferReply({ ephemeral: true });
    await renderPage();

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 180_000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: '❌ This is not your collection.', ephemeral: true });

      if (i.customId === 'prev' && page > 0) page--;
      else if (i.customId === 'next' && page < totalPages - 1) page++;

      if (i.customId === 'search') {
        const modal = new ModalBuilder()
          .setCustomId('search_modal')
          .setTitle('Search Pokémon');
        const searchInput = new TextInputBuilder()
          .setCustomId('search_name')
          .setLabel('Enter Pokémon name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., Charizard, Eevee, Pikachu')
          .setRequired(true);

        const modalRow = new ActionRowBuilder().addComponents(searchInput);
        modal.addComponents(modalRow);
        await i.showModal(modal);

        try {
          const submitted = await i.awaitModalSubmit({
            filter: (m) => m.user.id === userId,
            time: 30000
          });
          const searchName = submitted.fields.getTextInputValue('search_name').trim().toLowerCase();

          // find matching Pokémon (case-insensitive)
          const match = filtered.find(([_, data]) => data.name.toLowerCase() === searchName);
          if (match) {
            const matchIndex = filtered.findIndex(([id]) => id === match[0]);
            page = Math.floor(matchIndex / PAGE_SIZE);
            highlightId = match[0];
            await submitted.reply({ content: `⭐ Found ${match[1].name}!`, ephemeral: true });
            await renderPage();
          } else {
            await submitted.reply({ content: '❌ No Pokémon found by that name.', ephemeral: true });
          }
        } catch {
          await i.followUp({ content: '⏱️ Search timed out.', ephemeral: true });
        }
        return;
      }

      if (i.customId.startsWith('inspect_')) {
        const pokeId = i.customId.split('_')[1];
        const data = pokemonData[pokeId];
        if (!data)
          return i.reply({ content: 'Pokémon not found.', ephemeral: true });

        return i.reply({
          content: `📖 Opening Pokédex entry for **${data.name}**... (placeholder)`,
          ephemeral: true
        });
      }

      await i.deferUpdate();
      await renderPage();
    });

    collector.on('end', async () => {
      try { await msg.edit({ components: [] }); } catch {}
    });
  }
};