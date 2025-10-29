import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('adminsave')
    .setDescription('Admin: Force manual backup to Discord storage channel.')
    .setDefaultMemberPermissions(0),
  async execute(interaction, trainerData, saveTrainerData, saveDataToDiscord) {
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
      return;
    }
    await saveTrainerData();
    await saveDataToDiscord(interaction);
  }
};