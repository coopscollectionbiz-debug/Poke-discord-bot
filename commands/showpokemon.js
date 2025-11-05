// =============================================
// /showpokemon.js (Refactored with safeReply)
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
import { spritePaths } from "../spriteconfig.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { createPaginationButtons, calculateTotalPages, getPage } from "../utils/pagination.js";
import { safeReply } from "../utils/safeReply.js";

// =============================================
// SLASH COMMAND DEFINITION
// =============================================
export const data = new SlashCommandBuilder()
  .setName("showpokemon")
  .setDescription("View your Pokémon collection with filters.")
  .addStringOption((opt) =>
    opt
      .setName("filter")
      .setDescription("Filter by rarity: common, uncommon, rare, epic, legendary, mythic")
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName("ownership")
      .setDescription("Show owned, unowned, or all Pokémon.")
      .addChoices(
        { name: "Owned", value: "owned" },
        { name: "Unowned", value: "unowned" },
        { name: "All", value: "all" }
      )
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName("shiny")
      .setDescription("Filter shiny variants only?")
      .addChoices(
        { name: "Yes", value: "true" },
        { name: "No", value: "false" }
      )
      .setRequired(false)
  );

// =============================================
// EXECUTION
// =============================================
export async function execute(interaction, trainerData) {
  const userId = interaction.user.id;
  const user = trainerData[userId];
  const filterRarity = interaction.options.getString("filter");
  const filterOwnership = interaction.options.getString("ownership") || "owned";
  const filterShiny = interaction.options.getString("shiny");

  if (!user) {
    return safeReply(interaction, {
      content: "❌ You don't have a trainer profile yet. Run /trainercard first.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // =============================================
  // FILTER DATA - Using helper for Pokemon data
  // =============================================
  const allPokemon = await getAllPokemon();
  let filtered = [...allPokemon];
  if (filterRarity)
    filtered = filtered.filter(
      (p) => p.rarity?.toLowerCase() === filterRarity.toLowerCase()
    );

  const owned = user.ownedPokemon || user.pokemon || {};
  filtered = filtered.filter((p) => {
    const has = owned[p.id];
    if (filterOwnership === "owned") return !!has;
    if (filterOwnership === "unowned") return !has;
    return true;
  });

  if (filterShiny === "true") {
    filtered = filtered.filter((p) => owned[p.id]?.shiny);
  }

  // =============================================
  // PAGINATION SETUP - Using helpers
  // =============================================
  const pageSize = 15;
  let page = 0;
  const totalPages = calculateTotalPages(filtered, pageSize);

  const renderPage = () => {
    const slice = getPage(filtered, page, pageSize);
    const rows = slice.map((p) => {
      const ownedData = owned[p.id];
      const normalCount = ownedData?.normal || 0;
      const shinyCount = ownedData?.shiny || 0;
      const indicator =
        normalCount + shinyCount > 0
          ? `✅ ${normalCount ? `x${normalCount}` : ""}${shinyCount ? ` ✨${shinyCount}` : ""}`
          : "❌";
      return `\`${String(p.id).padStart(4, "0")}\` | ${p.name} | ${indicator}`;
    });

    const ownedCount = Object.keys(owned).length;
    const shinyCount = Object.values(owned).filter((p) => p.shiny > 0).length;

    const embed = new EmbedBuilder()
      .setTitle(`📜 Pokémon Collection — Page ${page + 1}/${totalPages}`)
      .setColor(0x43b581)
      .setDescription(rows.join("\n") || "No Pokémon match this filter.")
      .setFooter({
        text: `Owned: ${ownedCount} • Shiny: ${shinyCount} • Filter: ${filterRarity || "All"}`
      });

    const row = createPaginationButtons(page, totalPages, true);

    const pokedexRow = new ActionRowBuilder();
    slice.slice(0, 5).forEach((p) => {
      pokedexRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`inspect_${p.id}`)
          .setLabel(`🔍 ${p.name}`)
          .setStyle(ButtonStyle.Primary)
      );
    });

    return { embed, row, pokedexRow };
  };

  const { embed, row, pokedexRow } = renderPage();
  const msg = await safeReply(interaction, {
    embeds: [embed],
    components: [row, pokedexRow],
    ephemeral: true
  });

  // =============================================
  // COLLECTOR
  // =============================================
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== userId)
      return safeReply(i, { content: "⚠️ This menu isn't yours.", ephemeral: true });

    // PAGINATION
    if (i.customId === "next_page") {
      page++;
      const { embed, row, pokedexRow } = renderPage();
      return safeReply(i, { embeds: [embed], components: [row, pokedexRow] });
    }
    if (i.customId === "prev_page") {
      page--;
      const { embed, row, pokedexRow } = renderPage();
      return safeReply(i, { embeds: [embed], components: [row, pokedexRow] });
    }

    // CLOSE LIST
    if (i.customId === "close") {
      collector.stop("closed");
      return safeReply(i, {
        content: "Pokémon list closed.",
        embeds: [],
        components: []
      });
    }

    // =============================================
    // 🔍 INSPECT ENTRY
    // =============================================
    if (i.customId.startsWith("inspect_")) {
      const id = parseInt(i.customId.replace("inspect_", ""));
      const p = allPokemon.find((x) => x.id === id);
      if (!p) return safeReply(i, { content: "Pokémon not found.", ephemeral: true });

      const normalSprite = `${spritePaths.pokemon}${p.id}.gif`;
      const shinySprite = `${spritePaths.shiny}${p.id}.gif`;

      let shinyView = false;
      const entryEmbed = new EmbedBuilder()
        .setTitle(`${p.name} — #${p.id}`)
        .setColor(0xffcb05)
        .setDescription(
          `**Rarity:** ${p.rarity?.toUpperCase() || "Unknown"}\n**Type:** ${
            p.type?.join(", ") || "Unknown"
          }\n\n${p.description || p.flavorText || "No Pokédex entry found."}`
        )
        .setThumbnail(normalSprite);

      const shinyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("toggle_shiny")
          .setLabel("Toggle Shiny ✨")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("back_to_list")
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("close_entry")
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );

      await safeReply(i, { embeds: [entryEmbed], components: [shinyRow] });

      const inner = i.message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
      });

      inner.on("collect", async (b) => {
        if (b.user.id !== userId)
          return safeReply(b, { content: "⚠️ This entry isn't yours.", ephemeral: true });

        if (b.customId === "toggle_shiny") {
          shinyView = !shinyView;
          entryEmbed.setThumbnail(shinyView ? shinySprite : normalSprite);
          entryEmbed.setColor(shinyView ? 0xdaa520 : 0xffcb05);
          return safeReply(b, { embeds: [entryEmbed], components: [shinyRow] });
        }

        if (b.customId === "back_to_list") {
          const restored = renderPage();
          inner.stop("back");
          return safeReply(b, {
            embeds: [restored.embed],
            components: [restored.row, restored.pokedexRow]
          });
        }

        if (b.customId === "close_entry") {
          inner.stop("closed");
          return safeReply(b, {
            content: "Pokédex entry closed.",
            embeds: [],
            components: []
          });
        }
      });

      inner.on("end", async (_, reason) => {
        if (["back", "closed"].includes(reason)) return;
        await safeReply(i, { components: [] });
      });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "closed") await safeReply(interaction, { components: [] });
  });
}
