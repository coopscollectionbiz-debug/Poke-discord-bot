// ==========================================================
// 🪪 /showcard — Public version of /trainercard
// ==========================================================
// Simplified: Always shows YOUR card, publicly.
// Fully compatible with updated showTrainerCard().
// ==========================================================

import { SlashCommandBuilder } from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { showTrainerCard } from "./trainercard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("showcard")
    .setDescription("Display your Trainer Card publicly."),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      // Always public
      await interaction.deferReply({ ephemeral: false });

      const userId = interaction.user.id;
      const username = interaction.user.username;

      // Check if user exists
      let user = trainerData[userId];
      if (!user) {
        return safeReply(interaction, {
          content: "⚠️ You don’t have a Trainer Card yet! Use `/trainercard` to create one.",
          ephemeral: true
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
      await showTrainerCard(interaction, user);

    } catch (err) {
      console.error("❌ /showcard error:", err);
      await safeReply(interaction, {
        content: "❌ Failed to show Trainer Card. Please try again later.",
        ephemeral: true
      });
    }
  }
};
