// ==========================================================
// /adminsave — Force save trainerData to disk + Discord storage (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { handleCommandError } from "../utils/errorHandler.js";
import { safeReply } from "../utils/safeReply.js";

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("adminsave")
    .setDescription("Force-save all trainer data to disk and Discord storage.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ==========================================================
  // ⚙️ Command Execution (SafeReply Refactor)
  // ==========================================================
  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    await safeReply(interaction, {
      content: "💾 Initiating manual save...",
      ephemeral: true,
    });

    try {
      // Run both save systems (local + Discord storage channel)
      if (typeof saveTrainerDataLocal === "function") {
        await saveTrainerDataLocal(trainerData);
      }

      if (typeof saveDataToDiscord === "function") {
        await saveDataToDiscord(trainerData);
      }

      const embed = new EmbedBuilder()
        .setTitle("💾 Manual Save Complete")
        .setDescription("✅ Trainer data successfully saved to both local and cloud storage.")
        .setColor(0x00ae86)
        .setTimestamp();

      await safeReply(interaction, { embeds: [embed], ephemeral: true });

      console.log(`✅ Admin save executed by ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ Admin save failed:", err);
      await handleCommandError(err, interaction, "adminsave");
      await safeReply(interaction, {
        content: "❌ An error occurred while saving trainer data.",
        ephemeral: true,
      });
    }
  },
};