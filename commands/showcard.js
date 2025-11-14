// ==========================================================
// 🪪 /showcard — Public version of /trainercard
// ==========================================================
// Now simplified: always shows YOUR card publicly.
// No viewing other users, no ephemeral mode.
// Fully compatible with updated showTrainerCard().
// ==========================================================

import {
  SlashCommandBuilder
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { showTrainerCard } from "./trainercard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("showcard")
    .setDescription("Display your Trainer Card publicly."),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      // Show publicly → ephemeral: false
      await interaction.deferReply({ ephemeral: false });

      const targetUser = interaction.user;
      const targetId = targetUser.id;

      // Ensure user exists
      let user = trainerData[targetId];
      if (!user) {
        return safeReply(interaction, {
          content: "⚠️ You don’t have a Trainer Card yet! Use `/trainercard` to create one.",
          ephemeral: true,
        });
      }

      // Load full user record
      user = await ensureUserInitialized(
        targetId,
        targetUser.username,
        trainerData,
        client
      );

      // Render card (this edits the reply internally)
      await showTrainerCard(interaction, user);

      // Done — no need to manipulate embeds further
      return;

    } catch (err) {
      console.error("❌ /showcard error:", err);
      await safeReply(interaction, {
        content: "❌ Failed to show Trainer Card. Please try again later.",
        ephemeral: true,
      });
    }
  },
};
