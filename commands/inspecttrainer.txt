/**
 * /inspecttrainer — View a detailed Trainer card with rarity and ownership status.
 * Standalone command that mirrors the inspect view in /showtrainers.
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { spritePaths, rarityEmojis } from '../spriteConfig.js';
import trainerSprites from '../data/trainerSprites.json' assert { type: 'json' };

export default {
  data: new SlashCommandBuilder()
    .setName('inspecttrainer')
    .setDescription('Inspect a specific Trainer in full size.')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Enter the Trainer name')
        .setRequired(true)
    ),

  async execute(interaction, trainerData) {
    const userId = interaction.user.id;
    const user = trainerData[userId] || { trainers: {} };
    const owned = user.trainers || {};

    const input = interaction.options.getString('name').trim().toLowerCase();

    const match = Object.entries(trainerSprites).find(
      ([, data]) => data.name.toLowerCase() === input
    );

    if (!match)
      return interaction.reply({
        content: '❌ Trainer not found.',
        ephemeral: true
      });

    const [id, data] = match;
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
      .setImage(sprite)
      .setFooter({ text: `Rarity: ${data.rarity}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_trainer_inspect')
        .setLabel('❌ Close')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId)
        return i.reply({ content: '❌ Not your session.', ephemeral: true });

      if (i.customId === 'close_trainer_inspect') {
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
