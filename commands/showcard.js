// ==========================================================
// /showcard: old name. /trainercard's "Share to channel" button replaces it
// (three-teams split); kept as an alias for about two weeks. Posts your
// trainer card publicly, without the private Luck row.
// ==========================================================

import { SlashCommandBuilder, MessageFlags } from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { showTrainerCard } from "./trainercard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("showcard")
    .setDescription("Old name: shares your Trainer Card. Use /trainercard → Share to channel."),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    try {
      // Always public
      await interaction.deferReply();

      const userId = interaction.user.id;
      const username = interaction.user.username;

      // Check if user exists
      let user = trainerData[userId];
      if (!user) {
        return safeReply(interaction, {
          content: "⚠️ You don’t have a Trainer Card yet! Use `/trainercard` to create one.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Ensure fully loaded user entry
      user = await ensureUserInitialized(
        userId,
        username,
        trainerData,
        client
      );

      // Render card
      await showTrainerCard(interaction, user, trainerData, null, { shared: true });

    } catch (err) {
      console.error("❌ /showcard error:", err);
      await safeReply(interaction, {
        content: "❌ Failed to show Trainer Card. Please try again later.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
