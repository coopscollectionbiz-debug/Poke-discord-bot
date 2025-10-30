// ==========================================================
// 🧩 /adminsave Command (Render-Ready)
// ==========================================================
// Triggers an immediate trainerData backup to Discord storage channel.
// Fully async-safe, uses deferReply() to prevent 3-second timeout.
// ==========================================================

import { PermissionsBitField } from "discord.js";

export default {
  data: {
    name: "adminsave",
    description: "Manually trigger a data backup to Discord storage channel.",
  },

  /**
   * @param {ChatInputCommandInteraction} interaction
   * @param {Object} trainerData - The in-memory trainer data object
   * @param {Function} saveDataToDiscord - Backup function from bot_final.js
   */
  async execute(interaction, trainerData, saveDataToDiscord) {
  await interaction.deferReply({ flags: 64 });    
  // 🔒 Admin-only check
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await interaction.reply({ content: "❌ Admins only.", flags: 64 });
      return;
    }

    try {
      // ⚙️ Prevent Discord timeout
      await interaction.deferReply({ flags: 64 }); // flags: 64 = ephemeral reply

      // 💾 Trigger remote backup upload
      await saveDataToDiscord();

      // ✅ Success confirmation
      await interaction.editReply("✅ Trainer data successfully backed up to Discord storage channel.");
    } catch (err) {
      console.error("❌ /adminsave failed:", err);

      // Graceful error reply
      try {
        if (interaction.deferred) {
          await interaction.editReply("❌ Backup failed. Check Render logs for details.");
        } else {
          await interaction.reply({ content: "❌ Backup failed.", flags: 64 });
        }
      } catch (sendErr) {
        console.error("❌ Error sending /adminsave error message:", sendErr);
      }
    }
  },
};
