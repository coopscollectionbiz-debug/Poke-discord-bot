import zlib from 'zlib';
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { autosaveTrainerData } from '../bot_final.js'; // optional, if exported

export default {
  data: new SlashCommandBuilder()
    .setName('migrate-old-tp')
    .setDescription('Admin: import TP values from the most recent COMPRESSED_BACKUP in storage channel.')
    .setDefaultMemberPermissions(0),
  async execute(interaction, trainerData) {
    await interaction.reply({ content: '⏳ Fetching old trainer data from storage...', ephemeral: true });

    const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID || '1242750037109248093';
    const channel = await interaction.client.channels.fetch(STORAGE_CHANNEL_ID);
    if (!channel)
      return interaction.followUp({ content: '❌ Storage channel not found.', ephemeral: true });

    const messages = await channel.messages.fetch({ limit: 10 });
    const backup = messages
      .filter(m => m.author.id === interaction.client.user.id && m.content.startsWith('COMPRESSED_BACKUP:'))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .first();

    if (!backup)
      return interaction.followUp({ content: '❌ No COMPRESSED_BACKUP found.', ephemeral: true });

    // === Decompress and parse old data ===
    const encoded = backup.content.replace('COMPRESSED_BACKUP:', '').trim();
    const buf = Buffer.from(encoded, 'base64');
    let oldData = {};
    try {
      const json = zlib.inflateSync(buf).toString();
      oldData = JSON.parse(json);
    } catch (err) {
      return interaction.followUp({ content: `❌ Failed to decompress data: ${err.message}`, ephemeral: true });
    }

    let migrated = 0, skipped = 0;
    for (const [userId, oldUser] of Object.entries(oldData)) {
      const oldTP = oldUser.tp ?? oldUser.migratedFrom ?? 0;
      if (!oldTP) { skipped++; continue; }

      if (!trainerData[userId]) trainerData[userId] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };
      trainerData[userId].tp = oldTP;
      migrated++;
    }

    // Optional: autosave after migration
    // await autosaveTrainerData();

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle('🧭 TP Migration Complete')
      .setDescription(`✅ Migrated **${migrated}** users\n⏭️ Skipped **${skipped}** users`)
      .setFooter({ text: `Executed by ${interaction.user.username}` });

    await interaction.followUp({ embeds: [embed], ephemeral: true });
  }
};
