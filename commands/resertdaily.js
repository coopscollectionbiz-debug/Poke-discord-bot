// ==========================================================
// 🕐 /resetdaily – Admin Tool (Race-Safe, v5.0)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { atomicSave } from "../utils/saveManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetdaily")
    .setDescription("Admin: Reset a user's daily cooldown.")
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("User whose daily cooldown to reset.")
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt
        .setName("resetstreak")
        .setDescription("Reset daily streak as well?")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // *** IMPORTANT ***
  // Your commands must use the SAME argument signature that bot_final.js injects:
  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    lockUser,        // 5
    enqueueSave,     // 6
    client           // 7
  ) {

    try {
      // always defer first
      await interaction.deferReply({ ephemeral: true });

      // permission check
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("⛔ You do not have permission.");
      }

      const targetUser = interaction.options.getUser("user");
      const resetStreak = interaction.options.getBoolean("resetstreak") || false;

      if (!targetUser) {
        return interaction.editReply("❌ Invalid user.");
      }

      const userId = targetUser.id;

      // ======================================================
      // 🔒 ATOMIC LOCK — required for all mutations
      // ======================================================
      await lockUser(userId, async () => {
        const user = trainerData[userId];

        if (!user) {
          return interaction.editReply(
            `❌ <@${userId}> has no trainer data.`
          );
        }

        // -----------------------------
        // RESET FIELDS (no schema call)
        // -----------------------------
        user.lastDaily = 0;

        if (resetStreak) {
          user.dailyStreak = 0;
        }

        // -----------------------------
        // SAVE
        // -----------------------------
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        // -----------------------------
        // REPLY
        // -----------------------------
        await interaction.editReply(
          `✅ Daily reset for **${targetUser.username}**${
            resetStreak ? " (streak cleared)." : "."
          }`
        );
      });

      console.log(
        `🧭 /resetdaily used by ${interaction.user.tag} → ${targetUser.tag}`
      );

    } catch (err) {
      console.error("❌ /resetdaily error:", err);

      try {
        await interaction.editReply(`❌ Failed: ${err.message}`);
      } catch {
        console.warn("⚠ EditReply failed — interaction likely already resolved.");
      }
    }
  }
};
