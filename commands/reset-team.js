// ==========================================================
// 🛠️ /reset-team (Admin Command)
// • Resets ANY user’s displayed team
// • Does NOT touch owned Pokémon or anything else
// • Fixes broken teams caused by donated/removed Pokémon
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";

import { loadUserFromFile, saveUserFromFile } from "../utils/userSchema.js";

export const data = new SlashCommandBuilder()
  .setName("reset-team")
  .setDescription("Admin: Reset a user's displayed Pokémon team.")
  .addStringOption((option) =>
    option
      .setName("user")
      .setDescription("The Discord user ID to reset")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.options.getString("user");

    const user = await loadUserFromFile(userId);
    if (!user) {
      return interaction.editReply(`❌ No user found with ID **${userId}**.`);
    }

    // Reset displayed Pokémon
    user.displayedPokemon = [];

    await saveUserFromFile(userId, user);

    return interaction.editReply(
      `✅ Team successfully reset for <@${userId}>.\nThey can now set a fresh team without errors.`
    );
  } catch (err) {
    console.error("Reset Team Error:", err);
    return interaction.editReply(
      "❌ An error occurred while resetting the team. Check logs."
    );
  }
}
