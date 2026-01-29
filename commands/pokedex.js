// ==========================================================
// 📘 /pokedex — Enhanced Pokémon Viewer (Ephemeral)
// ==========================================================
// • Always ephemeral
// • Ownership tracked separately for normal vs shiny
// • Users can view shiny even if they don't own it
// • Supports numeric type IDs (your pokemonData uses [12, 4])
// • Type line shows emojis + names (NO type icon images)
// • EvolvesFrom / EvolvesTo show Pokémon NAMES (not IDs)
// • Button reliably toggles sprite by rebuilding components each update
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
  if (typeof t === "number") return TYPE_ID_TO_NAME[t] || `type_${t}`;
  if (typeof t === "string") return t.toLowerCase();
  return "unknown";
}

function formatTypesLine(typesArr) {
  if (!Array.isArray(typesArr) || typesArr.length === 0) return "Unknown";

  return typesArr
    .map((t) => {
      const name = typeNameFromId(t);
      const emoji = TYPE_NAME_EMOJI[name] || "";
      const nice = name.charAt(0).toUpperCase() + name.slice(1);
      return `${emoji} ${nice}`;
    })
    .join(" / ");
}

// Translate arrays like [2, 3] into "Ivysaur, Venusaur"
function idsToNames(ids, idToName) {
  if (!Array.isArray(ids) || ids.length === 0) return "None";

  const names = ids
    .map((x) => {
      const n = idToName.get(Number(x));
      return n || `#${x}`;
    })
    .filter(Boolean);

  return names.length ? names.join(", ") : "None";
}

export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("View Pokédex info for a Pokémon.")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("Pokémon name").setRequired(true)
    ),

  async execute(
    interaction,
    trainerData,
    saveTrainerDataLocal,
    saveDataToDiscord,
    client
  ) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString("name", true).trim();
      const all = await getAllPokemon();

      // Build an id -> name map to resolve evolvesTo/evolvesFrom ids
      const idToName = new Map();
      for (const p of all) {
        if (p && Number.isFinite(Number(p.id)) && typeof p.name === "string") {
          idToName.set(Number(p.id), p.name);
        }
      }

      const poke = all.find(
        (p) => p?.name?.toLowerCase() === name.toLowerCase()
      );

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
        isShiny
          ? `${spritePaths.shiny}${poke.id}.gif`
          : `${spritePaths.pokemon}${poke.id}.gif`;

      let viewingShiny = false;

      const typesText = formatTypesLine(poke.types);

      const evolvesToText = idsToNames(poke.evolvesTo, idToName);
      const evolvesFromText = idsToNames(poke.evolvesFrom, idToName);

      const buildEmbed = () => {
        const rarityKey = String(poke.tier || poke.rarity || "common").toLowerCase();
        const rarityEmoji = rarityEmojis[rarityKey] || "";
        const color = rarityColors?.[rarityKey] || "#3b82f6";

        const ownedLineNormal =
          `**Owned (Normal):** ${ownsNormal ? "✅ Yes" : "❌ No"}` +
          (ownsNormal ? `  *(x${normalCount})*` : "");

        const ownedLineShiny =
          `**Owned (Shiny):** ${ownsShiny ? "✨ ✅ Yes" : "❌ No"}` +
          (ownsShiny ? `  *(x${shinyCount})*` : "");

        return new EmbedBuilder()
          .setTitle(`#${poke.id} — ${poke.name}`)
          .setColor(color)
          .setDescription(
            `${rarityEmoji} **${rarityKey.toUpperCase()}**\n\n` +
              `**Region:** ${poke.region || "Unknown"}\n` +
              `**Type:** ${typesText}\n` +
              `**Evolves To:** ${evolvesToText}\n` +
              `**Evolves From:** ${evolvesFromText}\n\n` +
              `${ownedLineNormal}\n` +
              `${ownedLineShiny}\n\n` +
              `**Viewing:** ${viewingShiny ? "✨ Shiny sprite" : "Normal sprite"}`
          )
          .setImage(getSprite(viewingShiny))
          .setFooter({ text: "Coop's Collection — /pokedex" });
      };

      // IMPORTANT: rebuild components each time so toggling always updates cleanly
      const buildRow = () => {
        const toggleButton = new ButtonBuilder()
          .setCustomId("toggle_shiny")
          .setLabel(viewingShiny ? "⭐ View Normal" : "⭐ View Shiny")
          .setStyle(ButtonStyle.Primary);

        const closeButton = new ButtonBuilder()
          .setCustomId("close_pokedex")
          .setLabel("Close")
          .setStyle(ButtonStyle.Secondary);

        return new ActionRowBuilder().addComponents(toggleButton, closeButton);
      };

      const msg = await interaction.editReply({
        embeds: [buildEmbed()],
        components: [buildRow()],
      });

      const collector = msg.createMessageComponentCollector({
        time: 120000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "toggle_shiny") {
          viewingShiny = !viewingShiny;

          return i.update({
            embeds: [buildEmbed()],
            components: [buildRow()],
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
          const toggleButton = new ButtonBuilder()
            .setCustomId("toggle_shiny")
            .setLabel(viewingShiny ? "⭐ View Normal" : "⭐ View Shiny")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true);

          const closeButton = new ButtonBuilder()
            .setCustomId("close_pokedex")
            .setLabel("Close")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

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
