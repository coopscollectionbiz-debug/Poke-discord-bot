// ==========================================================
// inspectpokemon.js — Inspect details about a specific Pokémon
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js"; // ✅ Use hosted URLs

// ✅ JSON-safe import for Render (no assert { type: "json" })
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

export default {
  data: new SlashCommandBuilder()
    .setName("inspectpokemon")
    .setDescription("Inspect details about a specific Pokémon by name or ID.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Pokémon name or Pokédex ID.")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const input = interaction.options.getString("name").trim().toLowerCase();
    const pokemon =
      pokemonData.find(
        p =>
          p.name.toLowerCase() === input ||
          p.id.toString() === input ||
          (p.aliases && p.aliases.includes(input))
      ) || null;

    if (!pokemon) {
      return interaction.editReply({
        content: `❌ Pokémon **${input}** not found.`,
      });
    }

    // ✅ Use hosted sprite URL (supports shiny later if needed)
    // Detect shiny if your data has a "shiny" flag (optional for now)
  const spriteUrl = pokemon.shiny
  ? `${spritePaths.shiny}${pokemon.id}.png`
  : `${spritePaths.pokemon}${pokemon.id}.png`;

    const embed = new EmbedBuilder()
      .setTitle(`${pokemon.name}  #${pokemon.id}`)
      .setDescription(
        `**Rarity:** ${pokemon.rarity?.toUpperCase() ?? "Unknown"}\n` +
          (pokemon.type ? `**Type:** ${pokemon.type}\n` : "") +
          (pokemon.generation ? `**Generation:** ${pokemon.generation}\n` : "")
      )
      .setImage(spriteUrl)
      .setColor(0x1abc9c)
      .setFooter({ text: "Pokémon data sourced from Coop's Collection" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
