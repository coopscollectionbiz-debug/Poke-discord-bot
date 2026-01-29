// ==========================================================
// 📘 /pokedex — Enhanced Pokémon Viewer (Ephemeral)
// ==========================================================
// • Always ephemeral
// • Ownership is tracked separately for normal vs shiny
// • Users can view shiny even if they don't own it
// • Supports numeric type IDs (your pokemonData uses [12, 4])
// • Uses spritePaths.types for type icons: `${spritePaths.types}${typeId}.png`
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
import { spritePaths, rarityEmojis, rarityColors } from "../spriteconfig.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

// ----------------------------------------------------------
// Type ID -> Name (Gen 1-5 style mapping)
// Your data example: Bulbasaur types [12, 4] = Grass, Poison
// ----------------------------------------------------------
const TYPE_ID_TO_NAME = {
  1: "normal",
  2: "fighting",
  3: "flying",
  4: "poison",
  5: "ground",
  6: "rock",
  7: "bug",
  8: "ghost",
  9: "steel",
  10: "fire",
  11: "water",
  12: "grass",
  13: "electric",
  14: "psychic",
  15: "ice",
  16: "dragon",
  17: "dark",
  18: "fairy",
};

const TYPE_NAME_EMOJI = {
  normal: "⚪",
  fighting: "🥊",
  flying: "🕊️",
  poison: "☠️",
  ground: "⛰️",
  rock: "🪨",
  bug: "🐛",
  ghost: "👻",
  steel: "⚙️",
  fire: "🔥",
  water: "💧",
  grass: "🌿",
  electric: "⚡",
  psychic: "🔮",
  ice: "❄️",
  dragon: "🐉",
  dark: "🌑",
  fairy: "✨",
};

function typeNameFromId(t) {
  // supports both number IDs and strings, just in case
  if (typeof t === "number") return TYPE_ID_TO_NAME[t] || `type_${t}`;
  if (typeof t === "string") return t.toLowerCase();
  return "unknown";
}

function formatTypes(typesArr) {
  if (!Array.isArray(typesArr) || typesArr.length === 0) return "Unknown";

  return typesArr
    .map((t) => {
      const name = typeNameFromId(t);
      const emoji = TYPE_NAME_EMOJI[name] || "";
      // Icon URL based on numeric ID if available
      const iconUrl =
        typeof t === "number" ? `${spritePaths.types}${t}.png` : null;

      // We can’t “inline” icons inside text, but we can show URLs or just emoji.
      // Best UX: emoji + Capitalized name (and optionally show icons as embed thumbnails/fields)
      const label = `${emoji} ${name.charAt(0).toUpperCase()}${name.slice(1)}`;

      return { id: t, name, label, iconUrl };
    })
    .filter(Boolean);
}

export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("View Pokédex info for a Pokémon.")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("Pokémon name").setRequired(true)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString("name", true).trim();
      const all = await getAllPokemon();

      const poke = all.find((p) => p?.name?.toLowerCase() === name.toLowerCase());

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

      // Ownership is separate: { normal, shiny }
      const ownedEntry = user.pokemon?.[poke.id] || null;
      const normalCount = Number(ownedEntry?.normal || 0);
      const shinyCount = Number(ownedEntry?.shiny || 0);

      const ownsNormal = normalCount > 0;
      const ownsShiny = shinyCount > 0;

      // Sprites (YOUR spritePaths are already full URLs)
      const getSprite = (isShiny) =>
        isShiny ? `${spritePaths.shiny}${poke.id}.gif` : `${spritePaths.pokemon}${poke.id}.gif`;

      let viewingShiny = false;

      const typeObjs = formatTypes(poke.types);
      const typesText = Array.isArray(typeObjs) && typeObjs.length
        ? typeObjs.map((x) => x.label).join(" / ")
        : "Unknown";

      // Evolution line: support either evolutionLine or evolvesTo/evolvesFrom
      const evoLine =
        Array.isArray(poke.evolutionLine) && poke.evolutionLine.length
          ? poke.evolutionLine
          : Array.isArray(poke.evolvesTo) && poke.evolvesTo.length
          ? ["→ " + poke.evolvesTo.join(", ")]
          : [];

      const evoText =
        evoLine.length ? evoLine.join(" ") : "None";

      const buildEmbed = () => {
        const rarityKey = String(poke.tier || poke.rarity || "common").toLowerCase();
        const rarityEmoji = rarityEmojis[rarityKey] || "";
        const color = rarityColors?.[rarityKey] || "#3b82f6";

        const ownedLineNormal = `**Owned (Normal):** ${ownsNormal ? "✅ Yes" : "❌ No"}${ownsNormal ? `  *(x${normalCount})*` : ""}`;
        const ownedLineShiny = `**Owned (Shiny):** ${ownsShiny ? "✨ ✅ Yes" : "❌ No"}${ownsShiny ? `  *(x${shinyCount})*` : ""}`;

        const embed = new EmbedBuilder()
          .setTitle(`#${poke.id} — ${poke.name}`)
          .setColor(color)
          .setDescription(
            `${rarityEmoji} **${rarityKey.toUpperCase()}**\n\n` +
              `**Region:** ${poke.region || "Unknown"}\n` +
              `**Type:** ${typesText}\n` +
              `**Evolves To:** ${
                Array.isArray(poke.evolvesTo) && poke.evolvesTo.length
                  ? poke.evolvesTo.join(", ")
                  : "None"
              }\n` +
              `**Evolves From:** ${
                Array.isArray(poke.evolvesFrom) && poke.evolvesFrom.length
                  ? poke.evolvesFrom.join(", ")
                  : "None"
              }\n\n` +
              `${ownedLineNormal}\n` +
              `${ownedLineShiny}\n\n` +
              `**Viewing:** ${viewingShiny ? "✨ Shiny sprite" : "Normal sprite"}`
          )
          .setImage(getSprite(viewingShiny))
          .setFooter({ text: "Coop's Collection — /pokedex" });

        // Add type icons as fields (clickable URLs) if numeric IDs exist
        // (Discord won't render images in fields, but users can click the URLs)
        const iconLines =
          Array.isArray(typeObjs) && typeObjs.length
            ? typeObjs
                .filter((t) => t.iconUrl)
                .map((t) => `${t.label} — ${t.iconUrl}`)
            : [];

        if (iconLines.length) {
          embed.addFields({
            name: "Type Icons",
            value: iconLines.slice(0, 6).join("\n"),
          });
        }

        // Flavor text (if present)
        if (poke.flavor) {
          embed.addFields({
            name: "Flavor",
            value: String(poke.flavor).slice(0, 900),
          });
        }

        return embed;
      };

      // Buttons (shiny view is ALWAYS allowed)
      const toggleButton = new ButtonBuilder()
        .setCustomId("toggle_shiny")
        .setLabel("⭐ View Shiny")
        .setStyle(ButtonStyle.Primary);

      const closeButton = new ButtonBuilder()
        .setCustomId("close_pokedex")
        .setLabel("Close")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(toggleButton, closeButton);

      const msg = await interaction.editReply({
        embeds: [buildEmbed()],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        time: 120000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "toggle_shiny") {
          viewingShiny = !viewingShiny;
          toggleButton.setLabel(viewingShiny ? "⭐ View Normal" : "⭐ View Shiny");

          return i.update({
            embeds: [buildEmbed()],
            components: [row],
          });
        }

        if (i.customId === "close_pokedex") {
          collector.stop("closed");
          return i.update({
            content: "❌ Closed.",
            embeds: [],
            components: [],
          });
        }
      });

      collector.on("end", async () => {
        // disable buttons after timeout (best effort)
        try {
          toggleButton.setDisabled(true);
          closeButton.setDisabled(true);
          await interaction.editReply({
            components: [new ActionRowBuilder().addComponents(toggleButton, closeButton)],
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
