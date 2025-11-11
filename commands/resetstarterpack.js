// ==========================================================
// 🛠️ Coop's Collection Discord Bot — /resetstarterpack (Admin Command)
// ==========================================================
// Features:
//  • Requires Administrator permission
//  • Resets Starter Pack claim for a specific user OR all users
//  • Uses atomicSave() pattern for consistent persistence
//  • Fully deferred (no "application did not respond")
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetstarterpack")
    .setDescription("Admin: reset a user's Starter Pack claim so they can claim it again.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User whose Starter Pack you want to reset. Leave blank to reset for all users.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, atomicSave) {
    try {
      // ✅ Prevents Discord from timing out
      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser("user");

      if (targetUser) {
        // Reset for a specific user
        const userId = targetUser.id;
        const user = trainerData[userId];
        if (!user) {
          await interaction.editReply(`⚠️ No trainer data found for <@${userId}>.`);
          return;
        }

        user.purchases = Array.isArray(user.purchases)
          ? user.purchases.filter(p => p !== "starter_pack")
          : [];

        await atomicSave(trainerData);

        await interaction.editReply(
          `✅ Starter Pack reset for <@${userId}>.\nThey can now claim it again via \`/shop\`.`
        );

        console.log(`🔁 Starter Pack reset for ${targetUser.username} (${userId}) by ${interaction.user.username}.`);
      } else {
        // Reset for ALL users
        let count = 0;
        for (const [userId, user] of Object.entries(trainerData)) {
          if (user.purchases && Array.isArray(user.purchases)) {
            const before = user.purchases.length;
            user.purchases = user.purchases.filter(p => p !== "starter_pack");
            if (before !== user.purchases.length) count++;
          }
        }

        await atomicSave(trainerData);

        await interaction.editReply(
          `✅ Starter Pack reset for **${count}** users.\nAll affected users can now claim it again via \`/shop\`.`
        );

        console.log(`🔁 Global Starter Pack reset completed by ${interaction.user.username}. (${count} users)`);
      }
    } catch (err) {
      console.error("❌ /resetstarterpack failed:", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ Error resetting Starter Pack: ${err.message}`,
          ephemeral: true,
        });
      } else {
        await interaction.editReply(`❌ Error resetting Starter Pack: ${err.message}`);
      }
    }
  },
};
