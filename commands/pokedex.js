// ==========================================================
// 📘 /pokedex — the Pokémon viewer (private). See the section above
// autocomplete() for the three-teams-split changes.
// ==========================================================
// • Always ephemeral
// • Ownership tracked separately for normal vs shiny
// • Users can view shiny even if they don't own it
// • Supports numeric type IDs (your pokemonData uses [12, 4])
// • Type line shows emojis + names (NO type icon images)
// • EvolvesFrom / EvolvesTo show Pokémon NAMES (not IDs)
// • Button reliably toggles sprite by rebuilding components each update
// ==========================================================

import { pokemonSpriteUrl, spriteRecord } from "../utils/sprites.js";
import { nameKey, isGenerationLive } from "../utils/speciesCatalog.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { cardImage } from "../utils/render/stage.js";
import { pokedexView } from "../utils/render/pokedexCard.js";

import { safeReply } from "../utils/safeReply.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { spritePaths, rarityEmojis, rarityColors } from "../spriteconfig.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { threaded } from "../utils/render/renderers.js";
import { registeredMask, copiesOf } from "../services/box.js";
import { autocompleteChoices, closestPokemon } from "../utils/pokemonSearch.js";
import { inspectFiles, inspectText } from "./inspectpokemon.js";
import { randomBytes } from "crypto";

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

export function formatTypesLine(typesArr) {
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

// ==========================================================
// Three-teams split: /pokedex is the one Pokémon viewer.
//   • autocomplete while typing (owned first), typo match when sent anyway:
//     a clear winner opens directly, otherwise up to three "Did you mean"
//   • Entry (the dex card) · Your stats (was /inspectpokemon) · ✨ Shiny · Close
// /inspectpokemon is an alias that opens on Your stats.
// ==========================================================

// Released species, plus any the player owns (admin test grants).
function searchList(all, user) {
  const owns = (id) => (Number(user?.pokemon?.[id]?.normal) || 0) + (Number(user?.pokemon?.[id]?.shiny) || 0) > 0;
  return all
    .filter((p) => p && Number.isInteger(Number(p.id)) && typeof p.name === "string")
    .filter((p) => isGenerationLive(p.generation ?? 1) || owns(p.id))
    .map((p) => ({ id: Number(p.id), name: p.name }));
}

export async function autocomplete(interaction, trainerData) {
  const all = await getAllPokemon();
  const user = trainerData?.[interaction.user.id];
  const owned = new Set(Object.entries(user?.pokemon ?? {}).filter(([, e]) => (Number(e?.normal) || 0) + (Number(e?.shiny) || 0) > 0).map(([k]) => Number(k)));
  const focused = String(interaction.options.getFocused() ?? "");
  await interaction.respond(autocompleteChoices(focused, searchList(all, user), { owned }));
}

/** The Pokémon a typed value names: a dex number (autocomplete sends one), an exact name, or a typo match. */
export function resolvePokemon(value, all, user) {
  const list = searchList(all, user);
  const v = String(value ?? "").trim();
  const byId = /^#?\d+$/.test(v) ? all.find((p) => Number(p.id) === Number(v.replace("#", ""))) : null;
  const exact = byId ?? all.find((p) => nameKey(p?.name) === nameKey(v));
  if (exact) return { poke: exact };
  const close = closestPokemon(v, list);
  if (close.match) return { poke: all.find((p) => Number(p.id) === close.match.id) };
  return { suggestions: close.suggestions };
}

async function runPokedex(interaction, trainerData, client, { startOn = "entry" } = {}) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const name = interaction.options.getString("name", true).trim();
    const all = await getAllPokemon();
    const user = await ensureUserInitialized(interaction.user.id, interaction.user.username, trainerData, client);
    const found = resolvePokemon(name, all, user);
    if (found.poke) return showEntry(interaction, found.poke, user, all, { startOn });

    // Not found: up to three "Did you mean" buttons, private.
    if (!found.suggestions.length) return safeReply(interaction, { content: `No Pokémon is called "${name}".`, flags: MessageFlags.Ephemeral });
    const nonce = randomBytes(5).toString("hex");
    const msg = await interaction.editReply({
      content: `No Pokémon is called "${name}". Did you mean:`,
      components: [new ActionRowBuilder().addComponents(found.suggestions.map((p) =>
        new ButtonBuilder().setCustomId(`pdx_pick:${nonce}:${p.id}`).setLabel(p.name).setStyle(ButtonStyle.Primary)))],
    });
    const picker = msg.createMessageComponentCollector({ time: 120000, max: 1, filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(`pdx_pick:${nonce}:`) });
    picker.on("collect", async (i) => {
      await i.deferUpdate().catch(() => {});
      const poke = all.find((p) => Number(p.id) === Number(i.customId.split(":")[2]));
      if (poke) await showEntry(interaction, poke, user, all, { startOn });
    });
    picker.on("end", (_, reason) => { if (reason === "time") interaction.editReply({ components: [] }).catch(() => {}); });
  } catch (err) {
    console.error("❌ /pokedex error:", err);
    return safeReply(interaction, { content: "❌ Failed to load Pokédex entry.", flags: MessageFlags.Ephemeral });
  }
}

/** The entry, in the interaction's (private) reply, with Entry / Your stats / Shiny / Close. */
async function showEntry(interaction, poke, user, all, { startOn = "entry" } = {}) {
  // Unreleased generations: only players who already own the species see its entry.
  const ownsIt = (Number(user?.pokemon?.[poke.id]?.normal) || 0) + (Number(user?.pokemon?.[poke.id]?.shiny) || 0) > 0;
  if (!isGenerationLive(poke.generation ?? 1) && !ownsIt) {
    return interaction.editReply({ content: `📖 **${poke.name}** isn't in the Pokédex yet.`, components: [], embeds: [], attachments: [] });
  }
  const idToName = new Map(all.filter((p) => p && typeof p.name === "string").map((p) => [Number(p.id), p.name]));
  const ownedEntry = user.pokemon?.[poke.id] || null;
  const normalCount = Number(ownedEntry?.normal || 0);
  const shinyCount = Number(ownedEntry?.shiny || 0);
  const getSprite = (isShiny) => pokemonSpriteUrl(poke.id, isShiny);
  let tab = startOn === "stats" ? "stats" : "entry";
  let viewingShiny = false;

  const buildEmbed = () => {
    const rarityKey = String(poke.tier || poke.rarity || "common").toLowerCase();
    const mask = registeredMask(user, poke.id);
    const line = (label, n, bit, variant) => {
      const best = copiesOf(user, poke.id, variant)[0]?.level;
      return `**${label}:** ` + (n > 0 ? `✅ ×${n}${best ? ` · best Lv ${best}` : ""}` : (mask & bit) ? "Caught before · none now" : "❌ Not caught");
    };
    return new EmbedBuilder()
      .setTitle(`#${poke.id} — ${poke.name}`)
      .setColor(rarityColors?.[rarityKey] || "#3b82f6")
      .setDescription(
        `${rarityEmojis[rarityKey] || ""} **${rarityKey.toUpperCase()}**\n\n` +
          `**Region:** ${poke.region || "Unknown"}\n**Type:** ${formatTypesLine(poke.types)}\n` +
          `**Evolves To:** ${idsToNames(poke.evolvesTo, idToName)}\n**Evolves From:** ${idsToNames(poke.evolvesFrom, idToName)}\n\n` +
          `${line("Normal", normalCount, 1, "normal")}\n${line("✨ Shiny", shinyCount, 2, "shiny")}`)
      .setImage(getSprite(viewingShiny))
      .setFooter({ text: Number(poke.id) >= 650 ? `Coop's Collection · /pokedex · Sprite: ${spriteRecord(poke.id)?.credit?.project?.replace(/ \(.*$/, "") ?? "Smogon sprite project"} · /credits` : "Coop's Collection · /pokedex" });
  };

  const buildRow = (disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pdx_entry").setLabel("Entry").setStyle(tab === "entry" && !viewingShiny ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("pdx_stats").setLabel("Your stats").setStyle(tab === "stats" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("pdx_shiny").setLabel("✨ Shiny").setStyle(tab === "entry" && viewingShiny ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("pdx_close").setLabel("Close").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );

  const content = async () => {
    if (tab === "stats") {
      try {
        return { content: "", embeds: [], attachments: [], files: await inspectFiles(user, poke) };
      } catch (err) {
        console.warn("⚠️ inspect card render failed; sending text:", err?.message || err);
        return { content: inspectText(user, poke), embeds: [], attachments: [], files: [] };
      }
    }
    try {
      const view = pokedexView(poke.id, user);
      const card = await cardImage((animate) => threaded.pokedex(view, { shiny: viewingShiny, animate }), "pokedex", { unique: true });
      return { content: "", embeds: [], attachments: [], files: [new AttachmentBuilder(card.buffer, { name: card.name })] };
    } catch (err) {
      console.warn("⚠️ pokedex card render failed; sending embed:", err?.message || err);
      return { content: "", embeds: [buildEmbed()], attachments: [], files: [] };
    }
  };

  const msg = await interaction.editReply({ ...(await content()), components: [buildRow()] });
  const collector = msg.createMessageComponentCollector({
    time: 120000,
    filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith("pdx_") && !i.customId.startsWith("pdx_pick"),
  });
  collector.on("collect", async (i) => {
    if (i.customId === "pdx_close") {
      collector.stop("closed");
      return i.update({ content: "Closed.", embeds: [], attachments: [], components: [] });
    }
    if (i.customId === "pdx_entry") { tab = "entry"; viewingShiny = false; }
    if (i.customId === "pdx_shiny") { tab = "entry"; viewingShiny = true; }
    if (i.customId === "pdx_stats") tab = "stats";
    await i.deferUpdate().catch(() => {});
    await interaction.editReply({ ...(await content()), components: [buildRow()] }).catch(() => {});
  });
  collector.on("end", (_, reason) => {
    if (reason !== "closed") interaction.editReply({ components: [buildRow(true)] }).catch(() => {});
  });
  return msg;
}

export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("Look up a Pokémon: its entry, your stats, and its shiny.")
    .addStringOption((opt) => opt.setName("name").setDescription("Pokémon name or Pokédex number").setRequired(true).setAutocomplete(true)),
  autocomplete,
  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    return runPokedex(interaction, trainerData, client);
  },
};

export { runPokedex };
