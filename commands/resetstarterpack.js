// ==========================================================
// /resetstarterpack – Admin (Race-Safe v6.0)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";


export default {
  data: new SlashCommandBuilder()
    .setName("resetstarterpack")
    .setDescription("Admin: Reset a user's Starter Pack claim, or all users.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to reset. Leave blank to reset ALL users.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    lockUser,        // 5
    enqueueSave,      // 6
    client            // 7
  ) {

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Permission check
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("⛔ You do not have permission to use this command.");
      }

      const targetUser = interaction.options.getUser("user");

      // ======================================================
      // 🔹 CASE 1 — RESET A SINGLE USER (WITH LOCK)
      // ======================================================
      if (targetUser) {
        const userId = targetUser.id;

        return lockUser(userId, async () => {
          const user = trainerData[userId];

          if (!user) {
            return interaction.editReply(`⚠️ No trainer data found for <@${userId}>.`);
          }

          // Remove starter pack
          if (Array.isArray(user.purchases)) {
            user.purchases = user.purchases.filter(p => p !== "starter_pack");
          }

          // Save
          const saveAck = await saveAndAck(trainerData);

          console.log(
            `🔁 Starter Pack reset for ${targetUser.username} (${userId}) by ${interaction.user.username}`
          );

          return interaction.editReply(withSaveNote(
            `✅ Starter Pack reset for **${targetUser.username}**.\nThey can now claim it again.`,
            saveAck
          ));
        });
      }

      // ======================================================
      // 🔹 CASE 2 — GLOBAL RESET (NO PER-USER LOCKS)
      // ======================================================
      let count = 0;

      for (const [id, user] of Object.entries(trainerData)) {
        if (!user || !Array.isArray(user.purchases)) continue;

        const before = user.purchases.length;

        user.purchases = user.purchases.filter(p => p !== "starter_pack");

        if (user.purchases.length !== before) count++;
      }

      const globalAck = await saveAndAck(trainerData);

      console.log(
        `🔁 GLOBAL Starter Pack reset by ${interaction.user.username}. Users affected: ${count}`
      );

      return interaction.editReply(withSaveNote(`✅ Starter Pack reset for **${count}** users.`, globalAck));

    } catch (err) {
      console.error("❌ /resetstarterpack error:", err);
      return interaction.editReply(`❌ Error resetting Starter Pack: ${err.message}`);
    }
  }
};
