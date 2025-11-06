// ==========================================================
// /adminsave – Force save trainerData to disk + Discord storage (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { handleCommandError } from "../utils/errorHandler.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";

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
    // ✅ Defer reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      // ✅ Use atomic save for consistency
      const result = await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      const embed = new EmbedBuilder()
        .setTitle("💾 Manual Save Complete")
        .setDescription("✅ Trainer data successfully saved to both local and cloud storage.")
        .setColor(0x00ae86)
        .setTimestamp();

      // Show any warnings
      if (result.errors.length > 0) {
        embed.addFields({
          name: "⚠️ Warnings",
          value: result.errors.join("\n")
        });
      }

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
