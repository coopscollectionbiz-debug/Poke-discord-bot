// utils/safeReply.js
// ==========================================
// Safe interaction responder (v2)
// - Handles reply / editReply / followUp correctly
// - Swallows common Discord "late interaction" errors
// ==========================================

function shouldSwallow(err) {
  const code = err?.code;
  const msg = String(err?.message || "");

  // discord.js / API variants
  if (code === "InteractionAlreadyReplied") return true;
  if (code === 40060) return true; // interaction already acknowledged (API)
  if (code === 10062) return true; // Unknown interaction (too late)
  if (msg.includes("Unknown interaction")) return true;
  if (msg.includes("already been acknowledged")) return true;
  if (msg.includes("Interaction has already been acknowledged")) return true;

  return false;
}

/**
 * Safely respond to an interaction by detecting whether it's
 * already been replied to, deferred, or is a fresh interaction.
 *
 * @param {import("discord.js").Interaction} interaction
 * @param {Object} options - { content, embeds, components, flags, ... }
 * @param {boolean} [editIfReplied=false] - If true, edits instead of followUp when already replied.
 */
export async function safeReply(interaction, options = {}, editIfReplied = false) {
  try {
    if (!interaction || typeof interaction !== "object") {
      console.warn("⚠️ safeReply called without valid interaction.");
      return;
    }

    // If deferred, editReply is the correct path
    if (interaction.deferred) {
      return await interaction.editReply(options);
    }

    // If already replied, either edit or followUp
    if (interaction.replied) {
      if (editIfReplied) return await interaction.editReply(options);
      return await interaction.followUp(options);
    }

    // Fresh interaction
    return await interaction.reply(options);
  } catch (err) {
    if (shouldSwallow(err)) return;
    console.error("❌ safeReply error:", err?.stack || err);
  }
}
