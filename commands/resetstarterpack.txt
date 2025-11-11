// ==========================================================
// 🛠️ Coop's Collection Discord Bot — /resetstarterpack (Admin Role)
// ==========================================================
// Purpose:
//  • Removes "starter_pack" from a user's purchases list
//  • Allows re-claiming the Starter Pack for testing
//  • Role-gated (requires a role named "Admin" or matching ADMIN_ROLE_NAME)
// ==========================================================

import { SlashCommandBuilder } from "discord.js";
import { safeReply } from "../utils/safeReply.js";

// 🔒 Role name or ID for admin access
const ADMIN_ROLE_NAME = "Admin"; // or replace with your actual role name
// const ADMIN_ROLE_ID = "123456789012345678"; // alternative if you prefer by ID

export default {
  data: new SlashCommandBuilder()
    .setName("resetstarterpack")
    .setDescription("Admin: reset a user's Starter Pack claim status.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user whose Starter Pack you want to reset.")
        .setRequired(true)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      // 🧩 Permission check (by role)
      const hasAdminRole =
        member.roles.cache.some((r) => r.name === ADMIN_ROLE_NAME);
        // or by ID: member.roles.cache.has(ADMIN_ROLE_ID);

      if (!hasAdminRole) {
        return safeReply(interaction, {
          content: "❌ You do not have permission to use this command. Admin role required.",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("user");
      const userId = target.id;

      const user = trainerData[userId];
      if (!user) {
        return safeReply(interaction, {
          content: `⚠️ No trainer data found for <@${userId}>.`,
          ephemeral: true,
        });
      }

      // 🧹 Reset Starter Pack
      user.purchases = Array.isArray(user.purchases)
        ? user.purchases.filter((p) => p !== "starter_pack")
        : [];

      await saveTrainerDataLocal(trainerData);
      await saveDataToDiscord(trainerData);

      await safeReply(interaction, {
        content: `✅ Starter Pack has been reset for <@${userId}>.\nThey can now claim it again via \`/shop\`.`,
        ephemeral: false,
      });

      console.log(`🔁 Starter Pack reset for ${target.username} (${userId}) by ${interaction.user.username}.`);
    } catch (err) {
      console.error("❌ /resetstarterpack failed:", err);
      await safeReply(interaction, {
        content: `❌ Error resetting Starter Pack: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
