// ==========================================================
// 🪪 /showcard — Public version of /trainercard
// ==========================================================
//
// Identical to /trainercard display but public.
// - Reuses showTrainerCard() from trainercard.js
// - No onboarding logic
// - Supports self or another user
// ==========================================================

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { showTrainerCard } from "./trainercard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("showcard")
    .setDescription("Publicly display your Trainer Card or view another user's.")
    .addUserOption((option) =>
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

      // ✅ Reuse the same embed display
      const message = await showTrainerCard(interaction, ensured, targetUser);

      // 🧩 If showTrainerCard returns a message with buttons,
      // rewrite the Show Full Team button to include the targetId
      if (message?.components?.length) {
        const updatedComponents = message.components.map((row) => {
          if (!row?.components) return row;
          const newRow = ActionRowBuilder.from(row);
          newRow.components = row.components.map((btn) => {
            if (btn.customId === "show_full_team") {
              return new ButtonBuilder()
                .setCustomId(`show_full_team_${targetId}`)
                .setLabel(btn.label || "Show Full Team")
                .setStyle(btn.style || ButtonStyle.Primary);
            }
            return btn;
          });
          return newRow;
        });

        await interaction.editReply({
          components: updatedComponents,
        });
      }
    } catch (err) {
      console.error("❌ /showcard error:", err);
      await safeReply(interaction, {
        content: "❌ Failed to show Trainer Card. Please try again later.",
        ephemeral: true,
      });
    }
  },
};
