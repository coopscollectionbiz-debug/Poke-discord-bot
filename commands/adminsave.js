import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('adminsave')
    .setDescription('Admin: Force manual backup to Discord storage channel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ADMINISTRATOR),
  async execute(interaction, trainerData, saveTrainerData, saveDataToDiscord) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ADMINISTRATOR)) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
      return;
    }
    await saveTrainerData();
    await saveDataToDiscord(interaction);
  }
};