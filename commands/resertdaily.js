// ==========================================================
// 🕐 /resetdaily – Admin Tool (Race-Safe v3.2)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";
import { lockUser } from "../utils/userLocks.js";
import { normalizeUserSchema } from "../utils/sanitizeTrainerData.js";

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
      // Prevent Discord timeout
      await interaction.deferReply({ ephemeral: true });

      // Permission check
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return safeReply(interaction, {
          content: "⛔ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser("user");
      const resetStreak = interaction.options.getBoolean("resetstreak") || false;

      if (!targetUser) {
        return safeReply(interaction, {
          content: "❌ Invalid user specified.",
          ephemeral: true,
        });
      }

      const userId = targetUser.id;

      // ======================================================
      // 🔒 ATOMIC LOCK (ALL operations inside this block)
      // ======================================================
      return lockUser(userId, async () => {
        let user = trainerData[userId];

        if (!user) {
          return safeReply(interaction, {
            content: `❌ No trainer data found for <@${userId}>.`,
            ephemeral: true,
          });
        }

        // Normalize BEFORE making changes
        user = normalizeUserSchema(userId, user);
        trainerData[userId] = user;

        // ======================================================
        // 🌀 RESET DAILY
        // ======================================================
        user.lastDaily = 0;

        if (resetStreak) {
          // Don’t assume a streak object exists
          user.dailyStreak = 0;
        }

        // ======================================================
        // 💾 SAVE (atomic local + Discord)
        // ======================================================
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        // ======================================================
        // 🟢 REPLY TO ADMIN
        // ======================================================
        await safeReply(interaction, {
          content: `✅ Daily reset for **${targetUser.username}** ${
            resetStreak ? "and streak cleared." : "successfully."
          }`,
          ephemeral: true,
        });

        console.log(
          `🧭 /resetdaily used by ${interaction.user.tag} on ${targetUser.tag}`
        );
      });

    } catch (err) {
      console.error("❌ /resetdaily error:", err);
      return safeReply(interaction, {
        content: `❌ Failed to reset daily: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
