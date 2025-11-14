// ==========================================================
// 🪪 /showcard — Public version of /trainercard
// ==========================================================
// Now fully synced with the updated trainer card display.
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

      // Determine whose card we're showing
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const targetId = targetUser.id;
      const isSelf = targetId === interaction.user.id;

      // Ephemeral only for viewing someone else
      await interaction.deferReply({ ephemeral: !isSelf });

      // Ensure the user exists in trainerData
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

      // Validate + load full user entry
      const ensured = await ensureUserInitialized(
        targetId,
        targetUser.username,
        trainerData,
        client
      );

      // ======================================================
      // 🖼 Render card using the NEW trainer card builder
      // ======================================================
      // NEW: pass targetUser so avatar/name work correctly
      const message = await showTrainerCard(interaction, ensured, targetUser);

      // ======================================================
      // 🏷 Add "(Private View)" to footer if needed
      // ======================================================
      if (!isSelf && message?.embeds?.length > 0) {
        const embed = message.embeds[0];
        const footerText = (embed.footer?.text || "Coop's Collection") + " • (Private View)";
        embed.setFooter({ text: footerText });

        await interaction.editReply({
          embeds: [embed],
          components: message.components || [],
        });
      }

      // ======================================================
      // 🧩 Patch "Show Full Team" buttons (legacy support)
      // ======================================================
      if (message?.components?.length) {
        const updated = message.components.map((row) => {
          const actionRow = ActionRowBuilder.from(row);
          actionRow.components = row.components.map((c) => {
            if (c.customId === "show_full_team") {
              return new ButtonBuilder()
                .setCustomId(`show_full_team_${targetId}`)
                .setLabel(c.label || "Show Full Team")
                .setStyle(ButtonStyle.Primary);
            }
            return c;
          });
          return actionRow;
        });

        await interaction.editReply({ components: updated });
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
