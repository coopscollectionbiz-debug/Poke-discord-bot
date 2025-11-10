// ==========================================================
// 🪪 /showcard — Public version of /trainercard
// ==========================================================
//
// Identical to /trainercard display but public.
// - Reuses showTrainerCard() from trainercard.js
// - No onboarding logic
// - Supports self or another user
// - Public when showing your own card, ephemeral when viewing another user's
// - Adds "(Private View)" footer indicator for ephemeral views
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
    .setDescription("Display your Trainer Card publicly, or view another user's card privately.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user whose Trainer Card you want to view")
        .setRequired(false)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      // Determine target (self or mentioned)
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const targetId = targetUser.id;
      const isSelf = targetId === interaction.user.id;

      // If viewing your own card → public
      // If viewing someone else's card → ephemeral (private)
      await interaction.deferReply({ ephemeral: !isSelf });

      const user = trainerData[targetId];
      if (!user) {
        return safeReply(interaction, {
          content:
            isSelf
              ? "⚠️ You don’t have a Trainer Card yet! Use `/trainercard` to create one."
              : `⚠️ ${targetUser.username} doesn’t have a Trainer Card yet.`,
          ephemeral: true,
        });
      }

      // Ensure data is valid
      const ensured = await ensureUserInitialized(targetId, targetUser.username, trainerData, client);

      // ✅ Reuse the same embed display (pass targetUser so the correct name/avatar show)
      const message = await showTrainerCard(interaction, ensured, targetUser);

      // 🧩 If ephemeral, append “(Private View)” footer text
      if (!isSelf && message?.embeds?.length > 0) {
        const updatedEmbed = message.embeds[0];
        const existingFooter = updatedEmbed.footer?.text || "Coop's Collection";
        updatedEmbed.setFooter({ text: `${existingFooter} • (Private View)` });

        await interaction.editReply({
          embeds: [updatedEmbed],
          components: message.components || [],
        });
      }

      // 🧩 Optional legacy support for Show Full Team (safe rewrite)
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
