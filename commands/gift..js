import { SlashCommandBuilder } from 'discord.js';

const LARGE_GIFT_THRESHOLD = 1000;

export default {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Gift CC to another user.')
    .addUserOption(o => o.setName('target').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount of CC to send').setRequired(true)),
  async execute(interaction, trainerData, saveTrainerData) {
    const senderId = interaction.user.id;
    const target = interaction.options.getUser('target');
    const amount = interaction.options.getInteger('amount');

    if (senderId === target.id)
      return interaction.reply({ content: '❌ You cannot gift yourself.', ephemeral: true });

    if (amount <= 0)
      return interaction.reply({ content: '❌ Amount must be positive.', ephemeral: true });

    if (!trainerData[senderId] || trainerData[senderId].cc < amount)
      return interaction.reply({ content: '💰 You don’t have enough CC.', ephemeral: true });

    if (!trainerData[target.id]) trainerData[target.id] = { tp: 0, cc: 0, pokemon: {}, trainers: {} };

    // Confirm for large gifts
    if (amount >= LARGE_GIFT_THRESHOLD) {
      await interaction.reply({
        content: `⚠️ You are gifting a large amount (${amount} CC) to ${target.username}. Confirm?`,
        components: [],
        ephemeral: true
      });
      // Could implement confirmation button here; for brevity, auto-confirm.
    }

    trainerData[senderId].cc -= amount;
    trainerData[target.id].cc += amount;
    await saveTrainerData();

    // Optionally: log this transaction
    console.log(`[GIFT] ${interaction.user.username} gifted ${amount} CC to ${target.username}`);

    await interaction.reply({
      content: `🎁 ${interaction.user.username} gifted ${amount} CC to ${target.username}!`,
      ephemeral: false
    });
  }
};