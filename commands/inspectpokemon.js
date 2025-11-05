// ==========================================================
// inspectpokemon.js (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { findPokemonByName } from "../utils/dataLoader.js";
import { validateNameQuery } from "../utils/validators.js";
import { safeReply } from "../utils/safeReply.js";

// ==========================================================
// 🧩 Command definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("inspectpokemon")
    .setDescription("Inspect details about a specific Pokémon by name or ID.")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Pokémon name or Pokédex ID.")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const input = interaction.options.getString("name").trim();

    // Validate input
    const validation = validateNameQuery(input);
    if (!validation.valid) {
      return safeReply(interaction, {
        content: `❌ ${validation.error}`,
        ephemeral: true,
      });
    }

    // Use helper to find Pokémon
    const pokemon = await findPokemonByName(validation.sanitized);

    if (!pokemon) {
      return safeReply(interaction, {
        content: `❌ Pokémon **${input}** not found.`,
        ephemeral: true,
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

    await safeReply(interaction, { embeds: [embed], ephemeral: true });
  },
};
