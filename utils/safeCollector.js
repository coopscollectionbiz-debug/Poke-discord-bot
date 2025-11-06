// utils/safeCollector.js
// ======================================================
// Universal Safe Collector for Buttons / Select Menus
// Prevents "Unknown interaction" errors after expiry.
// ======================================================

import { ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { safeReply } from "./safeReply.js";

/**
 * Creates a safe message component collector that:
 *  ✅ Cleans up buttons after expiration
 *  ✅ Sends a restart prompt when expired
 *  ✅ Silently ignores "Unknown interaction" errors
 *
 * @param {import("discord.js").Interaction} interaction - The base interaction.
 * @param {Object} [options] - Collector options (e.g. filter, time, componentType).
 * @param {string} [restartCommand] - Optional command to suggest restarting.
 * @returns {import("discord.js").InteractionCollector}
 */
export function createSafeCollector(interaction, options = {}, restartCommand = null) {
  // Determine component type from options or default to Button
  const componentType = options.componentType || ComponentType.Button;

  const collector = interaction.channel.createMessageComponentCollector({
    componentType,
    time: options.time ?? 60000, // Default 1 minute
    filter: options.filter ?? (() => true),
    ...options,
  });

  collector.on("end", async (_, reason) => {
    // Don't send cleanup message if collector ended with confirmed/restarted reason
    if (reason === "confirmed" || reason === "restarted") {
      return;
    }

    try {
      // 🧹 Disable buttons and notify user
      const restartRow = restartCommand
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`restart_${restartCommand}`)
              .setLabel("🔄 Restart")
              .setStyle(ButtonStyle.Primary)
          )
        : null;

      await safeReply(interaction, {
        content: `⏱️ This session expired. ${
          restartCommand
            ? `Run \`/${restartCommand}\` or press "Restart" below to continue.`
            : "Please rerun the command."
        }`,
        components: restartRow ? [restartRow] : [],
        ephemeral: true,
      });
    } catch (err) {
      // Silently ignore "Unknown interaction" errors on expiry
      if (!err.message?.includes("Unknown interaction")) {
        console.error("⚠️ safeCollector end error:", err.message);
      }
    }
  });

  return collector;
}

/**
 * Create a specialized button collector for pagination
 * @param {import("discord.js").Interaction} interaction - The base interaction
 * @param {string} userId - User ID who can interact
 * @param {number} timeoutMs - Timeout in milliseconds (default 120000)
 * @param {string} restartCommand - Command to restart with
 * @returns {import("discord.js").InteractionCollector}
 */
export function createPaginationCollector(interaction, userId, timeoutMs = 120000, restartCommand = null) {
  return createSafeCollector(
    interaction,
    {
      filter: i => i.user.id === userId,
      componentType: ComponentType.Button,
      time: timeoutMs
    },
    restartCommand
  );
}