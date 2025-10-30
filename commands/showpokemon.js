// ==========================================================
// showpokemon.js
// ==========================================================
// 🧩 Purpose:
// Displays user's Pokémon collection with rarity, ownership,
// and shiny filters, plus one-click Pokédex embeds.
//
// ✅ Ephemeral & paginated (15 per page)
// ✅ Normal & shiny completion summaries
// ✅ Pokédex button for each Pokémon (opens instant embed)
// ✅ Fixed-width alignment for clean monospace display
// ✅ Safe JSON import (Node 22+, Render-ready)
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fs from "fs/promises";

// ==========================================================
// 🧠 Load Pokémon dataset safely
// ==========================================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

// ==========================================================
// 🧩 Slash command definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("showpokemon")
    .setDescription("View your Pokémon collection with rarity and shiny filters.")
    .addStringOption((option) =>
      option
        .setName("rarity")
        .setDescription("Filter Pokémon by rarity.")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Common", value: "common" },
          { name: "Uncommon", value: "uncommon" },
          { name: "Rare", value: "rare" },
          { name: "Epic", value: "epic" },
          { name: "Legendary", value: "legendary" },
          { name: "Mythic", value: "mythic" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("owned")
        .setDescription("Show only owned or unowned Pokémon.")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Owned Only", value: "owned" },
          { name: "Unowned Only", value: "unowned" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("shiny")
        .setDescription("Show shiny or normal Pokémon only.")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Normal Only", value: "normal" },
          { name: "Shiny Only", value: "shiny" }
        )
    ),

  // ==========================================================
  // ⚙️ Command execution
  // ==========================================================
  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const user = trainerData[userId];

    if (!user) {
      return interaction.editReply({
        content:
          "❌ You don’t have a trainer profile yet. Use `/trainercard` first!",
      });
    }

    const ownedPokemon = user.pokemon || {};

    // Filters
    const rarityFilter =
      interaction.options.getString("rarity")?.toLowerCase() || "all";
    const ownedFilter =
      interaction.options.getString("owned")?.toLowerCase() || "owned";
    const shinyFilter =
      interaction.options.getString("shiny")?.toLowerCase() || "all";

    // ==========================================================
    // 🧮 Compute ownership summaries
    // ==========================================================
    const totalNormal = pokemonData.length;
    const totalShiny = pokemonData.length;
    let ownedNormal = 0;
    let ownedShiny = 0;

    for (const p of pokemonData) {
      if (ownedPokemon[p.id]?.count > 0) ownedNormal++;
      if (ownedPokemon[`shiny_${p.id}`]?.count > 0) ownedShiny++;
    }

    const percentNormal = ((ownedNormal / totalNormal) * 100).toFixed(1);
    const percentShiny = ((ownedShiny / totalShiny) * 100).toFixed(1);

    // ==========================================================
    // 🧱 Apply filters
    // ==========================================================
    const filtered = pokemonData.filter((p) => {
      if (rarityFilter !== "all" && p.rarity?.toLowerCase() !== rarityFilter)
        return false;

      const ownsNormal = ownedPokemon[p.id]?.count > 0;
      const ownsShiny = ownedPokemon[`shiny_${p.id}`]?.count > 0;
      const anyOwned = ownsNormal || ownsShiny;
      const allUnowned = !anyOwned;

      if (ownedFilter === "owned" && !anyOwned) return false;
      if (ownedFilter === "unowned" && !allUnowned) return false;
      if (shinyFilter === "normal" && !ownsNormal) return false;
      if (shinyFilter === "shiny" && !ownsShiny) return false;
      return true;
    });

    if (filtered.length === 0) {
      return interaction.editReply({
        content: "⚠️ No Pokémon match your current filters or ownership status.",
      });
    }

    // ==========================================================
    // 📄 Pagination setup
    // ==========================================================
    const perPage = 15;
    const totalPages = Math.ceil(filtered.length / perPage);
    let currentPage = 0;

    // ==========================================================
    // 🧾 Helper: fixed-width column generator
    // ==========================================================
    const renderPage = (page) => {
      const start = page * perPage;
      const slice = filtered.slice(start, start + perPage);

      // Determine column width for longest name
      const longestName = Math.max(...slice.map((p) => p.name.length), 12);

      const tableRows = slice
        .map((p) => {
          const normalCount = ownedPokemon[p.id]?.count || 0;
          const shinyCount = ownedPokemon[`shiny_${p.id}`]?.count || 0;

          // Columns: name | normal | shiny | pokedex
          const normalDisplay =
            normalCount > 0
              ? `✅${normalCount.toString().padStart(2, " ")}`
              : "❌  ";
          const shinyDisplay =
            shinyCount > 0
              ? `✅${shinyCount.toString().padStart(2, " ")}`
              : "❌  ";

          return `${p.name.padEnd(longestName)} | ${normalDisplay} | ${shinyDisplay} | 🔍`;
        })
        .join("\n");

      const table = [
        "```",
        `| ${"Pokémon Name".padEnd(longestName)} | Normal | Shiny | Pokédex |`,
        `| ${"-".repeat(longestName)} | ------- | ------ | -------- |`,
        tableRows || "No Pokémon found.",
        "```",
      ].join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`📘 ${interaction.user.username}’s Pokémon Collection`)
        .setDescription(
          [
            `Normal: ${ownedNormal}/${totalNormal} (${percentNormal}%) | Shiny: ${ownedShiny}/${totalShiny} (${percentShiny}%)`,
            `Filters: ${rarityFilter.toUpperCase()} | ${ownedFilter.toUpperCase()} | Shiny: ${shinyFilter.toUpperCase()}`,
            "",
            table,
          ].join("\n")
        )
        .setColor(0x2ecc71)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
        .setTimestamp();

      // Build action row: prev/next/refresh/close
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev")
          .setLabel("⬅️ Prev")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId("next")
          .setLabel("Next ➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages - 1),
        new ButtonBuilder()
          .setCustomId("refresh")
          .setLabel("🔄 Refresh Filters")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("close")
          .setLabel("❌ Close")
          .setStyle(ButtonStyle.Danger)
      );

      // Create Pokémon-specific Pokédex buttons
      const pokedexRow = new ActionRowBuilder();
      slice.forEach((p) => {
        pokedexRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`inspect_${p.id}`)
            .setLabel(`🔍 ${p.name}`)
            .setStyle(ButtonStyle.Primary)
        );
      });

      return { embed, row, pokedexRow };
    };

    // ==========================================================
    // 🖼️ Send first page
    // ==========================================================
    const { embed, row, pokedexRow } = renderPage(currentPage);
    const message = await interaction.editReply({
      embeds: [embed],
      components: [row, pokedexRow],
    });

    // ==========================================================
    // 🎮 Collector
    // ==========================================================
    const collector = message.createMessageComponentCollector({
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id)
        return i.reply({ content: "⚠️ You can’t control this menu.", flags: 64 });

      // Page navigation
      if (i.customId === "prev" && currentPage > 0) currentPage--;
      else if (i.customId === "next" && currentPage < totalPages - 1)
        currentPage++;
      else if (i.customId === "refresh") currentPage = 0;
      else if (i.customId === "close") {
        collector.stop();
        return i.update({ components: [] });
      }

      // Pokédex buttons
      else if (i.customId.startsWith("inspect_")) {
        const id = i.customId.replace("inspect_", "");
        const p = pokemonData.find((x) => x.id === id);
        if (!p)
          return i.reply({ content: "❌ Pokémon not found.", flags: 64 });

        const ownsShiny = ownedPokemon[`shiny_${p.id}`]?.count > 0;

        const inspectEmbed = new EmbedBuilder()
          .setTitle(`${p.name}`)
          .setDescription(
            `**Rarity:** ${p.rarity.toUpperCase()}\n**Type:** ${p.type?.join(", ") || "Unknown"}\n\n${p.flavorText ||
