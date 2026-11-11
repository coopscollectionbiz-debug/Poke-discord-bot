// ==========================================================
// 🛠️ /resetweekly — Admin Only
// Resets a user's weekly pack cooldown for testing
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { lockUser } from "../utils/userLocks.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetweekly")
    .setDescription("Admin: Reset the weekly pack cooldown for a user.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to reset (defaults to yourself)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, _saveLocal, saveDiscord) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Pick target user
      const target =
        interaction.options.getUser("user") || interaction.user;

      const id = target.id;

      await lockUser(id, async () => {
        // Same record shape as every other path (never a hand-built object).
        const user = await ensureUserInitialized(id, target.username, trainerData, null);

        // Reset weekly pack
        user.weeklyPackClaimed = false;

        const ack = await saveAndAck(trainerData);
        await saveDiscord(trainerData);

        await interaction.editReply({
          content: withSaveNote(`Weekly pack reset for **${target.username}**`, ack),
        });
      });
    } catch (err) {
      console.error("❌ /resetweekly error:", err);
      await interaction.editReply({
        content: "Failed to reset weekly pack.",
      });
    }
  },
};
