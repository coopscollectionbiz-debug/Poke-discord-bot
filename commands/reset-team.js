// ==========================================================
// /resetteam – Admin Reset of Displayed Pokémon Team (v7.0)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";


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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Permission
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return safeReply(interaction, {
          content: "⛔ You do not have permission to use this command.",
          flags: MessageFlags.Ephemeral
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
            flags: MessageFlags.Ephemeral
          });
        }

        // ======================================================
        // ⭐ CORRECT FIELD: displayedPokemon
        // ======================================================
        // Your bot uses displayedPokemon for the 6-Pokémon team.
        user.displayedPokemon = [];

        // Save changes (user is the live record; no reassignment needed)
        const saveAck = await saveAndAck(trainerData);

        return safeReply(interaction, {
          content: withSaveNote(`✅ Reset **${target.username}'s** displayed Pokémon team.\nThey can now pick a new team in the dashboard.`, saveAck),
          flags: MessageFlags.Ephemeral
        });

      });
    } catch (err) {
      console.error("❌ /resetteam failed:", err);
      return safeReply(interaction, {
        content: `❌ Error resetting team: ${err.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
