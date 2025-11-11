// ==========================================================
// 🛠️ Coop's Collection Discord Bot — /resetstarterpack (Improved Admin Role Check)
// ==========================================================
// Allows admins (via role name OR Discord "Administrator" permission) 
// to reset a user's Starter Pack so it can be claimed again.
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";

const ADMIN_ROLE_KEYWORDS = ["admin", "moderator", "staff"]; // flexible name check

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

      // 🧩 Permission Check (any of these pass = admin)
      const hasAdminPermission = member.permissions.has(PermissionFlagsBits.Administrator);
      const hasAdminRole = member.roles.cache.some((r) =>
        ADMIN_ROLE_KEYWORDS.some((keyword) => r.name.toLowerCase().includes(keyword))
      );

      if (!hasAdminPermission && !hasAdminRole) {
        return safeReply(interaction, {
          content: "❌ You do not have permission to use this command. Admin role or Administrator permission required.",
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
