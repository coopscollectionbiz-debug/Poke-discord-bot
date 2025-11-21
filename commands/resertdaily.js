// ==========================================================
// 🕐 /resetdaily – Admin Tool (Race-Safe, No Unknown Interaction v4.0)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { atomicSave } from "../utils/saveManager.js";
import { lockUser } from "../utils/userLocks.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetdaily")
    .setDescription("Admin: Reset a user's daily cooldown.")
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("The user whose daily cooldown to reset.")
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt
        .setName("resetstreak")
        .setDescription("Also reset the user's daily streak count.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    try {
      // IMPORTANT: Only ONE reply path → ALWAYS defer first
      await interaction.deferReply({ ephemeral: true });

      // Permission check AFTER defer (safe)
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("⛔ You do not have permission to use this command.");
      }

      const targetUser = interaction.options.getUser("user");
      const resetStreak = interaction.options.getBoolean("resetstreak") || false;

      if (!targetUser) {
        return interaction.editReply("❌ Invalid user specified.");
      }

      const userId = targetUser.id;

      // ======================================================
      // 🔒 ATOMIC LOCK — All mutations must occur inside here
      // ======================================================
      await lockUser(userId, async () => {
        let user = trainerData[userId];

        if (!user) {
          return interaction.editReply(`❌ No trainer data found for <@${userId}>.`);
        }

        // Ensure schema is valid
        user = normalizeUserSchema(userId, user);
        trainerData[userId] = user;

        // ======================================================
        // 🌀 RESET DAILY
        // ======================================================
        user.lastDaily = 0;

        if (resetStreak) {
          user.dailyStreak = 0; // safe even if field never existed
        }

        // ======================================================
        // 💾 SAVE (atomic + Discord)
        // ======================================================
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        // ======================================================
        // 🟢 SINGLE FINAL REPLY
        // ======================================================
        await interaction.editReply(
          `✅ Daily reset for **${targetUser.username}**${
            resetStreak ? " (streak cleared)." : "."
          }`
        );
      });

      console.log(`🧭 /resetdaily used by ${interaction.user.tag} on ${targetUser.tag}`);

    } catch (err) {
      console.error("❌ /resetdaily error:", err);
      try {
        await interaction.editReply(`❌ Failed to reset daily: ${err.message}`);
      } catch {
        // fallback only if reply was somehow already handled
        console.warn("⚠️ Failed to editReply; interaction likely expired.");
      }
    }
  },
};
