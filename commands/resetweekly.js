// ==========================================================
// 🛠️ /resetweekly — Admin Only
// Resets a user's weekly pack cooldown for testing
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetweekly")
    .setDescription("Admin: Reset the weekly pack cooldown for a user.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to reset (defaults to yourself)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveLocal, saveDiscord) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Pick target user
      const target =
        interaction.options.getUser("user") || interaction.user;

      const id = target.id;

      // Ensure user exists
      if (!trainerData[id]) {
        trainerData[id] = {
          id,
          cc: 0,
          tp: 0,
          pokemon: {},
          trainers: {},
          displayedTrainer: null,
          displayedPokemon: [],
          onboardingComplete: false,
          onboardingDate: null,
          starterPokemon: null,
          lastDaily: 0,
          lastRecruit: 0,
          lastQuest: 0,
          lastWeeklyPack: null,
          items: { evolution_stone: 0 },
          purchases: [],
          luck: 0,
          luckTimestamp: 0,
        };
      }

      // Reset weekly pack
      trainerData[id].lastWeeklyPack = null;

      // Save
      await saveLocal(trainerData);
      await saveDiscord(trainerData);

      await interaction.editReply({
        content: `✅ Weekly pack reset for **${target.username}**`,
      });
    } catch (err) {
      console.error("❌ /resetweekly error:", err);
      await interaction.editReply({
        content: "❌ Failed to reset weekly pack.",
      });
    }
  },
};
