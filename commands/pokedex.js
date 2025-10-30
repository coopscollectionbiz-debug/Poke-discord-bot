// =============================================
// /pokedex.js
// Coop's Collection Discord Bot
// =============================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js"; // ✅ Unified sprite system

// =============================================
// 📦 Safe JSON Load (Render compatible)
// =============================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

// ✅ Convert to iterable array
const allPokemon = Object.values(pokemonData);

// =============================================
// Helper: find Pokémon by name or ID (case-insensitive)
// =============================================
function findPokemonByName(name) {
  const input = name.toLowerCase();
  return (
    allPokemon.find(
      (p) =>
        p.name.toLowerCase() === input ||
        p.id.toString() === input ||
        (p.aliases && p.aliases.map((a) => a.toLowerCase()).includes(input))
    ) || null
  );
}

// =============================================
// Slash command definition
// =============================================
export const data = new SlashCommandBuilder()
  .setName("pokedex")
  .setDescription("View detailed Pokédex information for a Pokémon.")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Enter the Pokémon name or Pokédex ID")
      .setRequired(true)
  );

// =============================================
// Command Execution
// =============================================
export async function execute(interaction) {
  const query = interaction.options.getString("name");
  const pokemon = findPokemonByName(query);

  if (!pokemon) {
    return interaction.reply({
      content: `❌ No Pokémon found named **${query}**.`,
      ephemeral: true
    });
  }

  // Defer reply to allow async image loads
  await interaction.deferReply({ ephemeral: true });

  // =============================================
  // Hosted sprite URLs (normal + shiny)
  // =============================================
  const normalSprite = `${spritePaths.pokemon}${pokemon.id}.gif`;
  const shinySprite = `${spritePaths.shiny}${pokemon.id}.gif`;

  let showingShiny = false;

  // =============================================
  // Embed for Pokémon Info
  // =============================================
  const embed = new EmbedBuilder()
    .setTitle(`${pokemon.name} — #${pokemon.id}`)
    .setColor(0xffcb05)
    .setDescription(
      `🗒️ **Type:** ${pokemon.type?.join("/") ?? "Unknown"}\n⭐ **Rarity:** ${
        pokemon.rarity ?? "Unknown"
      }\n📘 **Description:** ${
        pokemon.description || "No Pokédex entry available."
      }`
    )
    .setThumbnail(normalSprite)
    .setFooter({ text: "Coop’s Collection Pokédex" })
    .setTimestamp();

  // =============================================
  // Buttons: toggle shiny, close
  // =============================================
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("toggle_shiny")
      .setLabel("Toggle Shiny ✨")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("close_entry")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );

  const message = await interaction.editReply({
    embeds: [embed],
    components: [row]
  });

  // =============================================
  // Collector for button interactions
  // =============================================
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id)
      return i.reply({
        content: "❌ This Pokédex entry isn’t yours.",
        ephemeral: true
      });

    switch (i.customId) {
      case "toggle_shiny": {
        showingShiny = !showingShiny;
        embed.setThumbnail(showingShiny ? shinySprite : normalSprite);
        embed.setColor(showingShiny ? 0xdaa520 : 0xffcb05);
        await i.update({ embeds: [embed], components: [row] });
        break;
      }

      case "close_entry": {
        collector.stop("closed");
        await i.update({
          content: "Pokédex entry closed.",
          embeds: [],
          components: []
        });
        break;
      }

      default:
        await i.reply({ content: "Unknown action.", ephemeral: true });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "closed") {
      await message.edit({ components: [] }).catch(() => {});
    }
  });
}
