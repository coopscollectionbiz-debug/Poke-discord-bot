// ==========================================================
// inspectpokemon.js — Inspect details about a specific Pokémon
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs/promises";

// ✅ JSON-safe import for Render (no assert { type: "json" })
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

// ==========================================================
// 🧩 Command Definition
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

  // ==========================================================
  // ⚙️ Command Execution
  // ==========================================================
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

    // Build detailed embed
    const embed = new EmbedBuilder()
      .setTitle(`${pokemon.name}  #${pokemon.id}`)
      .setDescription(
        `**Rarity:** ${pokemon.rarity.toUpperCase()}\n` +
          (pokemon.type ? `**Type:** ${pokemon.type}\n` : "") +
          (pokemon.generation ? `**Generation:** ${pokemon.generation}\n` : "")
      )
      .setImage(pokemon.sprite)
      .setColor(0x1abc9c)
      .setFooter({ text: "Pokémon data sourced from Coop's Collection database" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
