// ==========================================================
// /adminsave – Force save trainerData to disk + Discord storage
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { handleCommandError } from "../utils/errorHandler.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("adminsave")
    .setDescription("Force-save all trainer data to disk AND Discord cloud backup.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    // Prevent Discord timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      // =====================================================
      // 1️⃣ Atomic local save (queued disk write)
      // =====================================================
      const result = await atomicSave(
        trainerData,
        saveTrainerDataLocal,
        saveDataToDiscord   // this will NOT upload, only queue local save
      );

      // =====================================================
      // 2️⃣ FORCED DISCORD BACKUP (this is what was missing)
      // =====================================================
      await saveDataToDiscord(trainerData);

      // =====================================================
      // 3️⃣ Confirmation embed
      // =====================================================
      const embed = new EmbedBuilder()
        .setTitle("💾 Manual Save Complete")
        .setDescription(
          "✅ Trainer data saved locally **AND** uploaded to the Discord backup channel."
        )
        .setColor(0x00ae86)
        .setTimestamp();

      const errors = Array.isArray(result?.errors) ? result.errors : [];
      if (errors.length > 0) {
        embed.addFields({
          name: "⚠️ Warnings",
          value: errors.join("\n")
        });
      }

      await safeReply(interaction, { embeds: [embed], ephemeral: true });

      console.log(`💾 /adminsave executed manually by ${interaction.user.tag}`);

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
