// ==========================================================
// inspectpokemon.js — Inspect details about a specific Pokémon
// Coop’s Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js"; // ✅ Use hosted URLs

// ==========================================================
// 📦 Safe JSON load (Render-compatible, no assert { type: "json" })
// ==========================================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

// ✅ Convert object → array for iteration
const allPokemon = Object.values(pokemonData);

// ==========================================================
// 🧩 Command definition
// ==========================================================
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

    // ✅ Use allPokemon for lookups
    const pokemon =
      allPokemon.find(
        p =>
          p.name.toLowerCase() === input ||
          p.id.toString() === input ||
          (p.aliases && p.aliases.map(a => a.toLowerCase()).includes(input))
      ) || null;

    if (!pokemon) {
      return interaction.editReply({
        content: `❌ Pokémon **${input}** not found.`,
      });
    }

    // ✅ Use hosted sprite URL (supports shiny later if needed)
    const spriteUrl = `${spritePaths.pokemon}${pokemon.id}.gif`;

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
