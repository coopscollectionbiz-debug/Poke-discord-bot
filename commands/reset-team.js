// ==========================================================
// /resetteam – Admin reset of both Pokémon teams (Display + Battle) and movesets
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";


export default {
  data: new SlashCommandBuilder()
    .setName("resetteam")
    .setDescription("Admin: Reset a user's Showcase and Battle teams.")
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
          content: "You do not have permission to use this command.",
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
            content: `User <@${userId}> has no saved data.`,
            flags: MessageFlags.Ephemeral
          });
        }

        // ======================================================
        // Both teams: the Display team (displayedPokemon) and the
        // Battle team (battleTeam, ranked/wager), plus their chosen
        // movesets (user.movesets). Missing battleTeam = "not set".
        // ======================================================
        user.displayedPokemon = [];
        delete user.battleTeam;
        delete user.movesets;

        // Save changes (user is the live record; no reassignment needed)
        const saveAck = await saveAndAck(trainerData);

        return safeReply(interaction, {
          content: withSaveNote(`Reset **${target.username}'s** Showcase and Battle teams (and their chosen moves).\nThey can now pick new teams on the dashboard's Teams page.`, saveAck),
          flags: MessageFlags.Ephemeral
        });

      });
    } catch (err) {
      console.error("❌ /resetteam failed:", err);
      return safeReply(interaction, {
        content: `Error resetting team: ${err.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
