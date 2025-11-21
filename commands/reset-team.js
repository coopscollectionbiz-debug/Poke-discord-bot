// ==========================================================
// /resetteam – Admin Reset of Displayed Pokémon Team (v7.0)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetteam")
    .setDescription("Admin: Reset a user's displayed Pokémon team.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user whose Pokémon team should be reset.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,   // 3
    saveDataToDiscord,      // 4
    lockUser,               // 5
    enqueueSave,            // 6
    client                  // 7
  ) {

    try {
      await interaction.deferReply({ ephemeral: true });

      // Permission
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return safeReply(interaction, {
          content: "⛔ You do not have permission to use this command.",
          ephemeral: true
        });
      }

      const target = interaction.options.getUser("user");
      const userId = target.id;

      // ======================================================
      // 🔒 ATOMIC PER-USER LOCK
      // ======================================================
      return lockUser(userId, async () => {

        let user = trainerData[userId];

        if (!user) {
          return safeReply(interaction, {
            content: `❌ User <@${userId}> has no saved data.`,
            ephemeral: true
          });
        }

        // ======================================================
        // ⭐ CORRECT FIELD: displayedPokemon
        // ======================================================
        // Your bot uses displayedPokemon for the 6-Pokémon team.
        user.displayedPokemon = [];

        trainerData[userId] = user;

        // Save changes
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Reset **${target.username}'s** displayed Pokémon team.\nThey can now pick a new team in the dashboard.`,
          ephemeral: true
        });

      });
    } catch (err) {
      console.error("❌ /resetteam failed:", err);
      return safeReply(interaction, {
        content: `❌ Error resetting team: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
