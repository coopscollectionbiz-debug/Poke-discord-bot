/**
 * /inspectpokemon — View a Pokémon in detail (similar to Pokédex view)
 * Standalone command with shiny toggle, evolutions, and inline type icons.
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { spritePaths, rarityEmojis } from '../spriteConfig.js';
import pokemonData from '../data/pokemonData.json' assert { type: 'json' };

export default {
  data: new SlashCommandBuilder()
    .setName('inspectpokemon')
    .setDescription('Inspect a specific Pokémon in detail.')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Enter the Pokémon name')
        .setRequired(true)
    ),

  async execute(interaction, trainerData) {
    const userId = interaction.user.id;
    const user = trainerData[userId] || { pokemon: {} };
    const owned = user.pokemon || {};
    const input = interaction.options.getString('name').trim().toLowerCase();

    // find Pokémon (case-insensitive)
    const entry = Object.entries(pokemonData).find(
      ([, data]) => data.name.toLowerCase() === input
    );

    if (!entry)
      return interaction.reply({
        content: '❌ Pokémon not found.',
        ephemeral: true
      });

    const [id, data] = entry;
    let shinyMode = false;

    const renderEmbed = () => {
      const sprite = shinyMode
        ? `${spritePaths.shiny}${id}.gif`
        : `${spritePaths.pokemon}${id}.gif`;

      const rarityEmoji = rarityEmojis[data.rarity.toLowerCase()] || '⚪';
      const isOwned = !!owned[id];
      const ownedText = isOwned ? '✅ Owned' : '❌ Not Owned';
      const evoFrom = data.evolves_from
        ? `⬆️ Evolves from **${data.evolves_from}**`
        : '';
      const evoTo = data.evolves_to ? `⬇️ Evolves to **${data.evolves_to}**` : '';

      // Inline type icons
      const typeIcons = data.type
        .map(tid => `![${tid}](${spritePaths.types}${tid}.png)`)
        .join(' ');

      const embed = new EmbedBuilder()
        .setColor(shinyMode ? 0xffcc00 : 0x0099ff)
        .setTitle(`${rarityEmoji} ${data.name} — ${data.rarity}`)
        .setDescription(`${typeIcons}\n\n${data.entry}\n\n${evoFrom}\n${evoTo}`)
        .setImage(sprite)
        .setFooter({
          text: `${ownedText} • Region: ${data.region} • Click ✨ to view shiny form`
        });

      return embed;
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_shiny')
        .setLabel('✨ Toggle Shiny')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('close_inspect_pokemon')
        .setLabel('❌ Close')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [renderEmbed()],
      components: [row],
      ephemeral: true
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId)
        return i.reply({ content: '❌ Not your session.', ephemeral: true });

      if (i.customId === 'toggle_shiny') {
        shinyMode = !shinyMode;
        await i.update({ embeds: [renderEmbed()], components: [row] });
        return;
      }

      if (i.customId === 'close_inspect_pokemon') {
        await i.update({ content: '❌ Closed.', embeds: [], components: [] });
        collector.stop();
      }
    });

    collector.on('end', async () => {
      try {
        await msg.edit({ components: [] });
      } catch {}
    });
  }
};
