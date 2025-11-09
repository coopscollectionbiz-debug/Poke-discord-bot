// ==========================================================
// 🕐 /resetdaily – Admin Tool
// ==========================================================
// Allows authorized users (admins) to reset another user's daily cooldown.
// Useful for testing or manual corrections.
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";

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
      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser("user");
      const resetStreak = interaction.options.getBoolean("resetstreak") || false;

      if (!targetUser) {
        return safeReply(interaction, {
          content: "❌ Invalid user specified.",
          ephemeral: true,
        });
      }

      const userId = targetUser.id;
      const user = trainerData[userId];

      if (!user) {
        return safeReply(interaction, {
          content: `❌ No trainer data found for <@${userId}>.`,
          ephemeral: true,
        });
      }

      // ✅ Reset their daily cooldown
      user.lastDaily = 0;
      if (resetStreak && user.daily) {
        user.daily.streak = 0;
      }

      // 💾 Save changes
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      await safeReply(interaction, {
        content: `✅ Daily reset for **${targetUser.username}** ${
          resetStreak ? "and streak cleared." : "successfully."
        }`,
        ephemeral: true,
      });

      console.log(`🧭 /resetdaily used by ${interaction.user.tag} on ${targetUser.tag}`);
    } catch (err) {
      console.error("❌ /resetdaily error:", err);
      return safeReply(interaction, {
        content: `❌ Failed to reset daily: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
