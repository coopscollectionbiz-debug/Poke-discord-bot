// ==========================================================
// /resetteam – Admin command to wipe a user's displayed Pokémon team
// • Fixes ghost Pokémon stuck in team after donation/evolution
// • Safe: does NOT remove any owned Pokémon or other data
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
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

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    // Defer reply early
    await interaction.deferReply({ ephemeral: true });

    // Admin check (redundant but safe)
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, {
        content: "⛔ You do not have permission to use this command.",
        ephemeral: true
      });
    }

    // Get target user
    const target = interaction.options.getUser("user");
    const userId = target.id;

    // Ensure user exists in datastore
    const userData = await ensureUserInitialized(
      userId,
      target.username,
      trainerData,
      client
    );

    // Reset their Pokémon team
    userData.currentTeam = [];

    // Save changes
    try {
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      return safeReply(interaction, {
        content: `✅ Successfully reset **${target.username}'s** Pokémon team.\nThey can now select a new team with **/changepokemon**.`,
        ephemeral: true
      });
    } catch (err) {
      console.error("❌ resetteam error:", err);
      return safeReply(interaction, {
        content: `❌ Error while saving: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
