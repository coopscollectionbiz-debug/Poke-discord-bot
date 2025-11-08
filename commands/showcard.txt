// ==========================================================
// 🪪 /showcard — Public version of /trainercard
// ==========================================================
//
// Identical to /trainercard display but public.
// - Reuses showTrainerCard() from trainercard.js
// - No onboarding logic
// - Supports self or another user
// ==========================================================

import { SlashCommandBuilder } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { showTrainerCard } from "./trainercard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("showcard")
    .setDescription("Publicly display your Trainer Card or view another user's.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user whose Trainer Card you want to view")
        .setRequired(false)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      // Public message
      await interaction.deferReply({ ephemeral: false });

      // Determine target (self or mentioned)
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const targetId = targetUser.id;

      const user = trainerData[targetId];
      if (!user) {
        return safeReply(interaction, {
          content:
            targetId === interaction.user.id
              ? "⚠️ You don’t have a Trainer Card yet! Use `/trainercard` to create one."
              : `⚠️ ${targetUser.username} doesn’t have a Trainer Card yet.`,
          ephemeral: true,
        });
      }

      // Ensure user data is valid
      const ensured = await ensureUserInitialized(targetId, targetUser.username, trainerData, client);

      // Temporarily override interaction.user to render the correct username/avatar
      const fakeInteraction = {
        ...interaction,
        user: targetUser,
        editReply: (data) => interaction.editReply(data),
      };

      // ✅ Reuse the exact embed display
      await showTrainerCard(fakeInteraction, ensured);

    } catch (err) {
      console.error("❌ /showcard error:", err);
      await safeReply(interaction, {
        content: "❌ Failed to show Trainer Card. Please try again later.",
        ephemeral: true,
      });
    }
  },
};
