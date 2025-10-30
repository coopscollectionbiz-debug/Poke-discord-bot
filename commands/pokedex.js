// ==========================================================
// pokedex.js — Lookup command: Shows a Pokémon's data, sprite, rarity, and flavor text
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fs from "fs/promises";

// ✅ Safe JSON import (no assert)
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("Look up details about a specific Pokémon.")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Enter a Pokémon name or ID to view its Pokédex entry.")
        .setRequired(true)
    ),

  // ==========================================================
  // ⚙️ Command Execution
  // ==========================================================
  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const input = interaction.options.getString("name").trim().toLowerCase();

    // Find the Pokémon
    const pokemon =
      pokemonData.find(
        (p) =>
          p.name.toLowerCase() === input ||
          p.id.toString() === input ||
          (p.aliases && p.aliases.includes(input))
      ) || null;

    if (!pokemon) {
      return interaction.editReply({
        content: `❌ Pokémon **${input}** not found.`,
      });
    }

    // ==========================================================
    // 🖼️ Embed Builder
    // ==========================================================
    const normalSprite = pokemon.sprite;
    const shinySprite = pokemon.shinySprite || null;

    const embed = new EmbedBuilder()
      .setTitle(`${pokemon.name}  #${pokemon.id}`)
      .setDescription(
        [
          `**Type:** ${pokemon.type || "Unknown"}`,
          `**Rarity:** ${pokemon.rarity?.toUpperCase() || "COMMON"}`,
          pokemon.flavorText ? `\n_${pokemon.flavorText}_` : "",
        ].join("\n")
      )
      .setColor(0x3498db)
      .setImage(normalSprite)
      .setFooter({
        text: shinySprite
          ? "Click 'Show Shiny' to view the shiny version!"
          : "No shiny variant available.",
      })
      .setTimestamp();

    // ==========================================================
    // ✨ Shiny Toggle Buttons
    // ==========================================================
    const row = new ActionRowBuilder();

    if (shinySprite) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("show_normal")
          .setLabel("Normal")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("show_shiny")
          .setLabel("Show Shiny ✨")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("close_entry")
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("close_entry")
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );
    }

    const message = await interaction.editReply({
      embeds: [embed],
      components: shinySprite ? [row] : [],
    });

    // ==========================================================
    // 🎮 Collector for Shiny Toggle
    // ==========================================================
    if (!shinySprite) return;

    const collector = message.createMessageComponentCollector({ time: 60000 });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id)
        return i.reply({ content: "⚠️ This Pokédex entry isn’t yours!", flags: 64 });

      if (i.customId === "show_shiny") {
        const shinyEmbed = EmbedBuilder.from(embed)
          .setImage(shinySprite)
          .setColor(0xffc300)
          .setFooter({ text: "Shiny variant displayed ✨" });

        const shinyRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("show_normal")
            .setLabel("Show Normal")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuild
