// ==========================================================
// /adminsave – Force save trainerData to disk + Discord storage
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
  // ⚙️ Command Execution
  // ==========================================================
  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    client
  ) {
    // Prevent Discord timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      // -------------------------------------------
      // 🔒 Perform atomic save (local + Discord)
      // -------------------------------------------
      const result = await atomicSave(
        trainerData,
        saveTrainerDataLocal,
        saveDataToDiscord
      );

      // -------------------------------------------
      // 📦 Build confirmation embed
      // -------------------------------------------
      const embed = new EmbedBuilder()
        .setTitle("💾 Manual Save Complete")
        .setDescription(
          "✅ Trainer data successfully saved to **local disk** and **Discord cloud backup**."
        )
        .setColor(0x00ae86)
        .setTimestamp();

      // -------------------------------------------
      // ⚠️ Optional warnings from atomicSave()
      // -------------------------------------------
      const errors = Array.isArray(result?.errors) ? result.errors : [];

      if (errors.length > 0) {
        embed.addFields({
          name: "⚠️ Warnings",
          value: errors.join("\n")
        });
      }

      // -------------------------------------------
      // 📨 Respond to admin
      // -------------------------------------------
      await safeReply(interaction, {
        embeds: [embed],
        ephemeral: true
      });

      console.log(
        `💾 /adminsave executed manually by ${interaction.user.username}`
      );
    } catch (err) {
      console.error("❌ Admin save failed:", err);
      await handleCommandError(err, interaction, "adminsave");

      await safeReply(interaction, {
        content: "❌ An unexpected error occurred while saving trainer data.",
        ephemeral: true
      });
    }
  }
};
