// ==========================================================
// 💸 /gift — send CC to another user
// ==========================================================
import { SlashCommandBuilder } from "discord.js";

const LARGE_GIFT_THRESHOLD = 1000;

export default {
  data: new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Gift CC to another user.")
    .addUserOption(o => o.setName("target").setDescription("Recipient").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount of CC").setRequired(true)),

  async execute(interaction, trainerData, saveTrainerData) {
    const sender = interaction.user;
    const recipient = interaction.options.getUser("target");
    const amount = interaction.options.getInteger("amount");

    // sanity checks
    if (sender.id === recipient.id)
      return interaction.reply({ content: "❌ You can’t gift yourself.", flags: 64 });
    if (amount <= 0)
      return interaction.reply({ content: "❌ Amount must be positive.", flags: 64 });
    if (!trainerData[sender.id] || trainerData[sender.id].cc < amount)
      return interaction.reply({ content: "💰 Insufficient CC.", flags: 64 });

    // ensure recipient exists
    trainerData[recipient.id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {} };

    // log large transfers
    if (amount >= LARGE_GIFT_THRESHOLD)
      console.log(`[Gift] ${sender.username} → ${recipient.username} : ${amount} CC`);

    // transfer
    trainerData[sender.id].cc -= amount;
    trainerData[recipient.id].cc += amount;
    await saveTrainerData();

    await interaction.reply({
      content: `🎁 **${sender.username}** gifted **${amount} CC** to **${recipient.username}**!`
    });
  }
};
