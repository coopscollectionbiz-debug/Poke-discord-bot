// ==========================================================
// /adminsave — Force save trainerData to disk + Discord storage
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { handleCommandError } from "../utils/errorHandler.js";

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("adminsave")
    .setDescription("Force-save all trainer data to disk and Discord storage.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ==========================================================
  // ⚙️ Command Execution
  // ==========================================================
  async execute(interaction, trainerData, saveTrainerData, saveDataToDiscord) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Run both save systems (local + Discord storage channel)
      if (typeof saveTrainerData === "function") {
        await saveTrainerData(trainerData);
      }

      if (typeof saveDataToDiscord === "function") {
        await saveDataToDiscord(trainerData);
      }

      const embed = new EmbedBuilder()
        .setTitle("💾 Manual Save Complete")
        .setDescription("✅ Trainer data successfully saved to both local and cloud storage.")
        .setColor(0x00ae86)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log(`✅ Admin save executed by ${interaction.user.username}`);
    } catch (err) {
      await handleCommandError(err, interaction, "adminsave");
    }
  }
};
