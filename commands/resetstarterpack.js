// ==========================================================
// /resetstarterpack – Admin (Race-Safe v4.3)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { lockUser } from "../utils/userLocks.js";
import { normalizeUserSchema } from "../utils/sanitizeTrainerData.js";
import { atomicSave } from "../utils/saveManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetstarterpack")
    .setDescription("Admin: Reset a user's Starter Pack claim so they can claim it again.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User whose Starter Pack claim you want to reset. Leave blank to reset globally.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser("user");

      // ======================================================
      // 🔹 CASE 1 — RESET A SINGLE USER (PER-USER LOCKED)
      // ======================================================
      if (targetUser) {
        const userId = targetUser.id;

        return lockUser(userId, async () => {
          let user = trainerData[userId];

          if (!user) {
            return safeReply(interaction, {
              content: `⚠️ No trainer data found for <@${userId}>.`,
              ephemeral: true,
            });
          }

          // Normalize before editing
          user = normalizeUserSchema(userId, user);
          trainerData[userId] = user;

          // Remove starter_pack entry
          user.purchases = Array.isArray(user.purchases)
            ? user.purchases.filter(p => p !== "starter_pack")
            : [];

          // Atomic save
          await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

          console.log(
            `🔁 Starter Pack reset for ${targetUser.username} (${userId}) by ${interaction.user.username}.`
          );

          return safeReply(interaction, {
            content: `✅ Starter Pack reset for **${targetUser.username}**.\nThey can now reclaim it via \`/shop\`.`,
            ephemeral: true,
          });
        });
      }

      // ======================================================
      // 🔹 CASE 2 — GLOBAL RESET (NO LOCK — FULL DATA MUTATION)
      // ======================================================
      // saveQueue + atomicSave already serialize full-dataset writes.
      // Locking each user individually would create hundreds of chained locks.

      let count = 0;

      for (const [id, user] of Object.entries(trainerData)) {
        trainerData[id] = normalizeUserSchema(id, user);

        const beforeCount = trainerData[id].purchases?.length || 0;

        trainerData[id].purchases = trainerData[id].purchases
          ? trainerData[id].purchases.filter(p => p !== "starter_pack")
          : [];

        const afterCount = trainerData[id].purchases.length;
        if (afterCount !== beforeCount) count++;
      }

      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      console.log(
        `🔁 GLOBAL Starter Pack reset by ${interaction.user.username}. Affected users: ${count}`
      );

      return safeReply(interaction, {
        content: `✅ Starter Pack reset for **${count}** users.`,
        ephemeral: true,
      });

    } catch (err) {
      console.error("❌ /resetstarterpack error:", err);
      return safeReply(interaction, {
        content: `❌ Error resetting Starter Pack: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
