// utils/safeReply.js
// ==========================================
// Provides a unified, safe way to reply or follow up
// with Discord interactions without causing
// "Unknown interaction" or "Interaction already acknowledged" errors.
// ==========================================

/**
 * Safely respond to an interaction by detecting whether it's
 * already been replied to, deferred, or is a fresh interaction.
 *
 * @param {import("discord.js").Interaction} interaction - The Discord interaction.
 * @param {Object} options - Message options (embeds, content, components, etc.)
 * @param {boolean} [options.ephemeral] - Whether the response should be ephemeral.
 * @param {boolean} [options.editIfReplied=false] - If true, edits the previous reply instead of followUp.
 */
export async function safeReply(interaction, options = {}, editIfReplied = false) {
  try {
    if (!interaction || typeof interaction !== "object") {
      console.warn(⚠️ safeReply called without valid interaction.");
      return;
    }

    // Handle ephemeral consistency
    if (options.ephemeral === undefined) options.ephemeral = true;

    if (interaction.deferred && !interaction.replied) {
      // Deferred, but not yet replied
      return await interaction.editReply(options);
    }

    if (interaction.replied) {
      if (editIfReplied) {
        return await interaction.editReply(options);
      }
      return await interaction.followUp(options);
    }

    // Fresh interaction
    return await interaction.reply(options);
  } catch (err) {
    console.error("❌ safeReply error:", err.message);
  }
}
