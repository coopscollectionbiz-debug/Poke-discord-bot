// ==========================================================
// /viewuser.js — Admin-only command
// Displays a specified user's stats (TP, CC, rank, etc.)
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { getRank } from "../utils/rankSystem.js";

export default {
  data: new SlashCommandBuilder()
    .setName("viewuser")
    .setDescription("Admin-only: View a user's Trainer stats.")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("The user whose stats you want to view")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser("target");
    const id = targetUser.id;
    const user = trainerData[id];

    if (!user) {
      return interaction.editReply({
        content: `⚠️ No trainer data found for ${targetUser.tag}.`,
      });
    }

    // Count Pokémon totals
    let totalPokemon = 0;
    let shinyPokemon = 0;
    for (const entry of Object.values(user.pokemon || {})) {
      totalPokemon += (entry.normal || 0) + (entry.shiny || 0);
      shinyPokemon += entry.shiny || 0;
    }

    // Count trainer totals
    const totalTrainers = Object.values(user.trainers || {}).reduce(
      (a, b) => a + b,
      0
    );

    const rank = getRank(user.tp || 0) || "Unranked";

    const embed = new EmbedBuilder()
      .setTitle(`📊 Stats for ${targetUser.username}`)
      .setColor(0x5865f2)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "🏆 Rank", value: rank, inline: true },
        { name: "💫 TP", value: `${user.tp || 0}`, inline: true },
        { name: "💰 CC", value: `${user.cc || 0}`, inline: true },
        { name: "🎒 Pokémon", value: `${totalPokemon} (${shinyPokemon} shiny)`, inline: true },
        { name: "🧍 Trainers", value: `${totalTrainers}`, inline: true },
        { name: "📅 Onboarded", value: user.onboardingDate ? `<t:${Math.floor(user.onboardingDate / 1000)}:R>` : "Not completed", inline: false }
      )
      .setFooter({ text: `User ID: ${id}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
