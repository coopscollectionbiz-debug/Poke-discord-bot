// ==========================================================
// /adminsave – Force save trainerData to disk + Discord storage
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { handleCommandError } from "../utils/errorHandler.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("adminsave")
    .setDescription("Admin: Save all trainer data to disk and the Discord backup channel now.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    lockUser,          // ✔ now included
    enqueueSave,       // ✔ now included
    client             // ✔ now included
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // ===========================================
      // 1️⃣ Atomic local save
      // ===========================================
      const result = await atomicSave(
        trainerData,
        saveTrainerDataLocal,
        saveDataToDiscord
      );

      // ===========================================
      // 2️⃣ Forced Discord cloud backup
      // ===========================================
      await saveDataToDiscord(trainerData);

      // ===========================================
      // 3️⃣ Confirmation embed
      // ===========================================
      const embed = new EmbedBuilder()
        .setTitle("💾 Manual Save Complete")
        .setDescription(
          "✅ Trainer data saved locally **AND** uploaded to the Discord backup channel."
        )
        .setColor(0x00ae86)
        .setTimestamp();

      const errors = Array.isArray(result?.errors) ? result.errors : [];
      if (errors.length) {
        embed.addFields({ name: "⚠️ Warnings", value: errors.join("\n") });
      }

      await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });

      console.log(`💾 /adminsave executed manually by ${interaction.user.tag}`);

    } catch (err) {
      console.error("❌ Admin save failed:", err);
      await handleCommandError(err, interaction, "adminsave");

      await safeReply(interaction, {
        content: "An unexpected error occurred while saving trainer data.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
