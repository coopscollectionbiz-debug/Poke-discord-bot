// ==========================================================
// 📘 /pokedex — Enhanced Pokémon Viewer (Ephemeral Version)
// ==========================================================
// • Shows rarity, types, evolutions, shiny status
// • Dynamic shiny toggle
// • Consistent with dashboard + trainer card UI
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { spritePaths, rarityEmojis, typeEmojis } from "../spriteconfig.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("View Pokédex info for a Pokémon.")
    .addStringOption(opt =>
      opt
        .setName("name")
        .setDescription("Pokémon name")
        .setRequired(true)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString("name");
      const all = await getAllPokemon();

      let poke = all.find(
        p => p.name.toLowerCase() === name.toLowerCase()
      );

      if (!poke) {
        return safeReply(interaction, {
          content: `❌ Pokémon "**${name}**" not found.`,
          ephemeral: true
        });
      }

      const user = await ensureUserInitialized(
        interaction.user.id,
        interaction.user.username,
        trainerData,
        client
      );

      const owns = user.pokemon?.[poke.id];
      const shinyOwned = owns?.shiny > 0;

      // ======================================================
      // SPRITE LOGIC — normal/shiny support
      // ======================================================
      const getSprite = (isShiny) =>
        isShiny
          ? `${spritePaths.pokemon}shiny/${poke.id}.gif`
          : `${spritePaths.pokemon}normal/${poke.id}.gif`;

      let currentShiny = false;

      // ======================================================
      // BUILD FULL EMBED (patched safely)
      // ======================================================
      const buildEmbed = () => {
        const rarity = (poke.tier || poke.rarity || "common").toLowerCase();

        // SAFE TYPES (patched)
        const types = Array.isArray(poke.types) && poke.types.length
          ? poke.types.map(t => `${typeEmojis[t] || ""} ${t}`).join(" / ")
          : "Unknown";

        // SAFE EVOLUTION LINE (patched)
        const evo = Array.isArray(poke.evolutionLine) && poke.evolutionLine.length
          ? poke.evolutionLine.join(" → ")
          : "None";

        return new EmbedBuilder()
          .setTitle(`#${poke.id} — ${poke.name}`)
          .setColor(0x3b82f6)
          .setDescription(
            `${rarityEmojis[rarity] || ""} **${rarity.toUpperCase()}**\n\n` +
            `**Type:** ${types}\n` +
            `**Evolutions:** ${evo}\n\n` +
            `**Owned:** ${owns ? "Yes" : "No"}\n` +
            `**Shiny Owned:** ${shinyOwned ? "✨ Yes" : "No"}`
          )
          .setImage(getSprite(currentShiny))
          .setFooter({
            text: "Coop's Collection — /pokedex"
          });
      };

      // ======================================================
      // COMPONENTS
      // ======================================================
      const shinyButton = new ButtonBuilder()
        .setCustomId("toggle_shiny")
        .setLabel("⭐ View Shiny")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!shinyOwned);

      const closeButton = new ButtonBuilder()
        .setCustomId("close_pokedex")
        .setLabel("Close")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        shinyButton,
        closeButton
      );

      // ======================================================
      // SEND INITIAL MESSAGE
      // ======================================================
      const msg = await interaction.editReply({
        embeds: [buildEmbed()],
        components: [row]
      });

      // ======================================================
      // COLLECTOR
      // ======================================================
      const collector = msg.createMessageComponentCollector({
        time: 120000,
        filter: i => i.user.id === interaction.user.id
      });

      collector.on("collect", async i => {
        if (i.customId === "toggle_shiny") {
          currentShiny = !currentShiny;

          shinyButton.setLabel(
            currentShiny ? "⭐ View Normal" : "⭐ View Shiny"
          );

          await i.update({
            embeds: [buildEmbed()],
            components: [row]
          });
        }

        if (i.customId === "close_pokedex") {
          collector.stop("closed");
          return i.update({
            content: "❌ Closed.",
            embeds: [],
            components: []
          });
        }
      });

    } catch (err) {
      console.error("❌ /pokedex error:", err);
      return safeReply(interaction, {
        content: "❌ Failed to load Pokédex entry.",
        ephemeral: true
      });
    }
  }
};
