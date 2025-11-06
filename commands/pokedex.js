// =============================================
// /pokedex.js (SafeReply Refactor + Pokemon Cache)
// Coop's Collection Discord Bot
// =============================================

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { findPokemonByName } from "../utils/dataLoader.js";
import { validateNameQuery } from "../utils/validators.js";
import { createPokedexEmbed } from "../utils/embedBuilders.js";
import { safeReply } from "../utils/safeReply.js";

// Convert numeric type IDs into readable names
const typeMap = {
  1: "Normal", 2: "Fighting", 3: "Flying", 4: "Poison", 5: "Ground",
  6: "Rock", 7: "Bug", 8: "Ghost", 9: "Steel", 10: "Fire",
  11: "Water", 12: "Grass", 13: "Electric", 14: "Psychic",
  15: "Ice", 16: "Dragon", 17: "Dark"
};

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

  // ✅ Validate input
  const validation = validateNameQuery(query);
  if (!validation.valid) {
    return safeReply(interaction, {
      content: `❌ ${validation.error}`,
      ephemeral: true
    });
  }

  // ✅ Find Pokémon (uses cache internally if dataLoader is updated)
  const pokemon = await findPokemonByName(validation.sanitized);

  if (!pokemon) {
    return safeReply(interaction, {
      content: `❌ No Pokémon found named **${query}**.`,
      ephemeral: true
    });
  }

  // ✅ Public reply (not ephemeral)
  await interaction.deferReply({ flags: 0 });

  const normalSprite = `${spritePaths.pokemon}${pokemon.id}.gif`;
  const shinySprite = `${spritePaths.shiny}${pokemon.id}.gif`;
  let showingShiny = false;

  // Create main embed
  const embed = createPokedexEmbed(pokemon, normalSprite, typeMap);

  // Buttons
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

  const message = await safeReply(interaction, {
    embeds: [embed],
    components: [row]
  });

  // =============================================
  // Collector
  // =============================================
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      const warn = await safeReply(i, {
        content: "⏳ Only the original trainer can use these buttons.",
        ephemeral: true
      });
      setTimeout(() => {
        try { warn.delete().catch(() => {}); } catch {}
      }, 3000);
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
        await safeReply(i, {
          content: "Unknown action.",
          ephemeral: true
        });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "closed") {
      try {
        await message.edit({ components: [] });
      } catch {}
    }
  });
}