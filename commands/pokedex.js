// ==========================================================
// 📘 /pokedex — Enhanced Pokémon Viewer (Ephemeral Version)
// ==========================================================
// • Ephemeral
// • Shows rarity, types, evolutions
// • Shiny toggle is ALWAYS allowed (even if unowned)
// • Ownership is shown separately for Normal vs Shiny (with counts)
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

const typeEmojis = {
  normal: "⚪",
  fire: "🔥",
  water: "💧",
  electric: "⚡",
  grass: "🌿",
  ice: "❄️",
  fighting: "🥊",
  poison: "☠️",
  ground: "⛰️",
  flying: "🕊️",
  psychic: "🔮",
  bug: "🐛",
  rock: "🪨",
  ghost: "👻",
  dragon: "🐉",
  dark: "🌑",
  steel: "⚙️",
  fairy: "✨",
};

export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("View Pokédex info for a Pokémon.")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("Pokémon name").setRequired(true)
    ),

  // NOTE: Keep signature consistent with your command loader invocation.
  // In your bot file you call:
  // command.execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, lockUser, enqueueSave, client)
  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    lockUser,
    enqueueSave,
    client
  ) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString("name", true).trim();
      const all = await getAllPokemon();

      const poke = all.find((p) => p.name?.toLowerCase() === name.toLowerCase());

      if (!poke) {
        return safeReply(interaction, {
          content: `❌ Pokémon "**${name}**" not found.`,
          ephemeral: true,
        });
      }

      const user = await ensureUserInitialized(
        interaction.user.id,
        interaction.user.username,
        trainerData,
        client
      );

      // ======================================================
      // OWNERSHIP (separate normal vs shiny + counts)
      // ======================================================
      const entry = user.pokemon?.[poke.id];
      const normalOwned = Number.isFinite(entry?.normal) ? entry.normal : 0;
      const shinyOwned = Number.isFinite(entry?.shiny) ? entry.shiny : 0;

      const ownsNormal = normalOwned > 0;
      const ownsShiny = shinyOwned > 0;

      // ======================================================
      // SPRITE LOGIC — normal/shiny support
      // Uses your canonical spritePaths where possible.
      // If your spritePaths are already full URLs, this will work as-is.
      // ======================================================
      const getSprite = (isShiny) =>
        isShiny
          ? `${spritePaths.shiny}${poke.id}.gif`
          : `${spritePaths.pokemon}${poke.id}.gif`;

      // Which sprite is currently being viewed (toggleable)
      let currentShinyView = false;

      // ======================================================
      // EMBED BUILDER (safe/defensive)
      // ======================================================
      const buildEmbed = () => {
        const rarity = (poke.tier || poke.rarity || "common").toLowerCase();

        const types =
          Array.isArray(poke.types) && poke.types.length
            ? poke.types.map((t) => `${typeEmojis?.[t] || ""} ${t}`).join(" / ")
            : "Unknown";

        const evo =
          Array.isArray(poke.evolutionLine) && poke.evolutionLine.length
            ? poke.evolutionLine.join(" → ")
            : "None";

        const viewing = currentShinyView ? "✨ Shiny" : "Normal";

        return new EmbedBuilder()
          .setTitle(`#${poke.id} — ${poke.name}`)
          .setColor(0x3b82f6)
          .setDescription(
            `${rarityEmojis?.[rarity] || ""} **${rarity.toUpperCase()}**\n\n` +
              `**Type:** ${types}\n` +
              `**Evolutions:** ${evo}\n` +
              `**Viewing:** ${viewing}\n\n` +
              `**Owned (Normal):** ${
                ownsNormal ? `✅ Yes (${normalOwned})` : "❌ No"
              }\n` +
              `**Owned (Shiny):** ${
                ownsShiny ? `✨ ✅ Yes (${shinyOwned})` : "❌ No"
              }`
          )
          .setImage(getSprite(currentShinyView))
          .setFooter({ text: "Coop's Collection — /pokedex" });
      };

      // ======================================================
      // COMPONENTS (always allow shiny viewing)
      // ======================================================
      const shinyButton = new ButtonBuilder()
        .setCustomId("toggle_shiny")
        .setLabel("⭐ View Shiny")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false);

      const closeButton = new ButtonBuilder()
        .setCustomId("close_pokedex")
        .setLabel("Close")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(shinyButton, closeButton);

      // ======================================================
      // SEND INITIAL MESSAGE (ephemeral)
      // ======================================================
      const msg = await interaction.editReply({
        embeds: [buildEmbed()],
        components: [row],
      });

      // ======================================================
      // COLLECTOR
      // ======================================================
      const collector = msg.createMessageComponentCollector({
        time: 120_000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "toggle_shiny") {
          currentShinyView = !currentShinyView;

          shinyButton.setLabel(currentShinyView ? "⭐ View Normal" : "⭐ View Shiny");

          await i.update({
            embeds: [buildEmbed()],
            components: [row],
          });
          return;
        }

        if (i.customId === "close_pokedex") {
          collector.stop("closed");
          await i.update({
            content: "❌ Closed.",
            embeds: [],
            components: [],
          });
          return;
        }
      });

      collector.on("end", async () => {
        // Optional: disable buttons when collector ends so it feels clean
        try {
          shinyButton.setDisabled(true);
          closeButton.setDisabled(true);
          await interaction.editReply({
            components: [new ActionRowBuilder().addComponents(shinyButton, closeButton)],
          });
        } catch {}
      });
    } catch (err) {
      console.error("❌ /pokedex error:", err);
      return safeReply(interaction, {
        content: "❌ Failed to load Pokédex entry.",
        ephemeral: true,
      });
    }
  },
};
