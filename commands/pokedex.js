import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { spritePaths, rarityEmojis } from '../spriteconfig.js';
import pokemonData from '../pokemonData.json' assert { type: 'json' };

export default {
  data: new SlashCommandBuilder()
    .setName('pokedex')
    .setDescription('View Pokédex details for a specific Pokémon.')
    .addStringOption(opt =>
      opt.setName('pokemon')
        .setDescription('Enter Pokémon name or ID')
        .setRequired(true)
    ),

  async execute(interaction, trainerData, context = {}) {
    const userId = interaction.user.id;
    const user = trainerData[userId] || { pokemon: {} };

    const input = interaction.options?.getString('pokemon') || context.pokemonName;
    if (!input) return interaction.reply({ content: '❌ No Pokémon specified.', ephemeral: true });

    const query = input.trim().toLowerCase();
    const entry = Object.entries(pokemonData).find(
      ([id, data]) => id === query || data.name.toLowerCase() === query
    );
    if (!entry)
      return interaction.reply({ content: '❌ Pokémon not found.', ephemeral: true });

    const [id, data] = entry;
    let shinyMode = false;

    const renderEmbed = () => {
      const sprite = shinyMode
        ? `${spritePaths.shiny}${id}.gif`
        : `${spritePaths.pokemon}${id}.png`;

      // Inline type icons
      const typeIcons = data.type
        .map(tid => `![${tid}](${spritePaths.types}${tid}.png)`)
        .join(' ');

      const rarityEmoji = rarityEmojis[data.rarity.toLowerCase()] || '⚪';
      const isOwned = !!user.pokemon[id];
      const ownedText = isOwned ? '✅ Owned' : '❌ Not Owned';
      const evoFrom = data.evolves_from
        ? `⬆️ Evolves from **${data.evolves_from}**`
        : '';
      const evoTo = data.evolves_to
        ? `⬇️ Evolves to **${data.evolves_to}**`
        : '';

      return new EmbedBuilder()
        .setColor(shinyMode ? 0xffcc00 : 0x0099ff)
        .setTitle(`${rarityEmoji} ${data.name} — ${data.rarity}`)
        .setDescription(
          `${typeIcons}\n\n${data.entry}\n\n${evoFrom}\n${evoTo}`
        )
        .setImage(sprite)
        .setFooter({
          text: `${ownedText} • Region: ${data.region} • Click ✨ Toggle Shiny to view shiny form`
        });
    };

    const embed = renderEmbed();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_shiny')
        .setLabel('✨ Toggle Shiny')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('back_to_showpokemon')
        .setLabel('⬅️ Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('close_pokedex')
        .setLabel('❌ Close')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({ time: 120_000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: '❌ Not your Pokédex session.', ephemeral: true });

      if (i.customId === 'toggle_shiny') {
        shinyMode = !shinyMode;
        await i.update({ embeds: [renderEmbed()], components: [row] });
        return;
      }

      if (i.customId === 'back_to_showpokemon') {
        if (context.showPokemonRenderer) {
          await i.deferUpdate();
          await context.showPokemonRenderer();
        } else {
          await i.update({
            content: '⬅️ Returning to your Pokémon list...',
            embeds: [],
            components: []
          });
        }
        collector.stop();
        return;
      }

      if (i.customId === 'close_pokedex') {
        await i.update({ content: '❌ Pokédex closed.', embeds: [], components: [] });
        collector.stop();
        return;
      }
    });

    collector.on('end', async () => {
      try { await msg.edit({ components: [] }); } catch {}
    });
  }
};