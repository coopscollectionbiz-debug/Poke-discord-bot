// ==========================================================
// /resetteam – Admin Reset of Displayed Pokémon Team (v4.3)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { lockUser } from "../utils/userLocks.js";
import { normalizeUserSchema } from "../utils/sanitizeTrainerData.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("resetteam")
    .setDescription("Admin: Reset a user's displayed Pokémon team.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user whose team you want to reset.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    client
  ) {

    // Prevent command timeout
    await interaction.deferReply({ ephemeral: true });

    // Permission check
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, {
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const target = interaction.options.getUser("user");
    const userId = target.id;

    // ======================================================
    // 🔒 PER-USER ATOMIC LOCK
    // ======================================================
    return lockUser(userId, async () => {
      // Ensure user exists in datastore
      let userData = await ensureUserInitialized(
        userId,
        target.username,
        trainerData,
        client
      );

      // Normalize schema BEFORE mutation
      userData = normalizeUserSchema(userId, userData);
      trainerData[userId] = userData;

      // ======================================================
      // ⭐ CORRECT FIELD: currentTeam
      // ======================================================
      // Your entire bot uses `currentTeam` as the active display party.
      // Always reset THIS field — NOT displayedPokemon.
      userData.currentTeam = [];

      // Save via unified atomic save system
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      return safeReply(interaction, {
        content: `✅ Successfully reset **${target.username}'s** Pokémon team.\nThey can now choose a new team with **/changepokemon**.`,
        ephemeral: true,
      });
    });
  },
};
