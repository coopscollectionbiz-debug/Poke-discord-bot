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

// Convert numeric type IDs into readable names
const typeMap = {
  1: "Normal", 2: "Fighting", 3: "Flying", 4: "Poison", 5: "Ground",
  6: "Rock", 7: "Bug", 8: "Ghost", 9: "Steel", 10: "Fire",
  11: "Water", 12: "Grass", 13: "Electric", 14: "Psychic",
  15: "Ice", 16: "Dragon", 17: "Dark"
};

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
    // ❌ Keep "not found" messages private to avoid clutter
    return interaction.reply({
      content: `❌ No Pokémon found named **${query}**.`,
      ephemeral: true
    });
  }

  // ✅ Public response (not ephemeral)
  await interaction.deferReply(); // no ephemeral flag

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
      `🗒️ **Type:** ${pokemon.types
        .map((id) => typeMap[id] || "Unknown")
        .join("/")}\n⭐ **Rarity:** ${pokemon.tier || "Unknown"}\n📘 **Description:** ${
        pokemon.flavor || "No Pokédex entry available."
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
    if (i.user.id !== interaction.user.id) {
      // Instead of ephemeral, show temporary visible message
      const warn = await i.reply({
        content: "⏳ Only the original trainer can use these buttons.",
        fetchReply: true
      });
      setTimeout(() => i.deleteReply().catch(() => {}), 3000);
      return;
    }

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
        await i.reply({
          content: "Unknown action.",
          fetchReply: true
        });
        setTimeout(() => i.deleteReply().catch(() => {}), 3000);
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "closed") {
      await message.edit({ components: [] }).catch(() => {});
    }
  });
}
