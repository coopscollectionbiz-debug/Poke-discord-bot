// =============================================
// /showpokemon.js
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

// =============================================
// SAFE JSON LOADERS
// =============================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

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

  // guard
  if (!user) {
    return interaction.reply({
      content: "❌ You don't have a trainer profile yet. Run /trainercard first.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // filter master list
  let filtered = [...pokemonData];
  if (filterRarity)
    filtered = filtered.filter((p) => p.rarity?.toLowerCase() === filterRarity.toLowerCase());

  // map owned data
  const owned = user.ownedPokemon || {};
  filtered = filtered.filter((p) => {
    const has = owned[p.id];
    if (filterOwnership === "owned") return !!has;
    if (filterOwnership === "unowned") return !has;
    return true;
  });

  if (filterShiny === "true") {
    filtered = filtered.filter((p) => owned[p.id]?.shiny);
  }

  // layout control
  const pageSize = 15;
  let page = 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // renderer
  const renderPage = () => {
    const slice = filtered.slice(page * pageSize, page * pageSize + pageSize);
    const rows = slice.map((p) => {
      const ownedData = owned[p.id];
      const ownedCount = ownedData ? ownedData.count || 1 : 0;
      const shinyOwned = ownedData?.shiny ? "✨" : "";
      const ownedIndicator = ownedCount > 0 ? `✅ x${ownedCount}${shinyOwned}` : "❌";
      const name = p.name.padEnd(14, " ");
      return `\`${String(p.id).padStart(4, "0")}\` | ${name} | ${ownedIndicator}`;
    });

    const ownedCount = Object.keys(owned).length;
    const shinyCount = Object.values(owned).filter((p) => p.shiny).length;

    const embed = new EmbedBuilder()
      .setTitle(`📜 Pokémon Collection — Page ${page + 1}/${totalPages}`)
      .setColor(0x43b581)
      .setDescription(
        rows.join("\n") || "No Pokémon match this filter."
      )
      .setFooter({
        text: `Owned Pokémon: ${ownedCount} • Shiny: ${shinyCount} • Filter: ${
          filterRarity || "All"
        }`
      });

    // main navigation
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev_page")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId("next_page")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page + 1 >= totalPages),
      new ButtonBuilder()
        .setCustomId("close_list")
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger)
    );

    // pokedex row (max 5 per page to stay within button limit)
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
  const msg = await interaction.editReply({
    embeds: [embed],
    components: [row, pokedexRow]
  });

  // collector
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== userId)
      return i.reply({ content: "This menu isn't yours.", ephemeral: true });

    if (i.customId === "next_page") {
      page++;
      const newView = renderPage();
      return i.update({
        embeds: [newView.embed],
        components: [newView.row, newView.pokedexRow]
      });
    }
    if (i.customId === "prev_page") {
      page--;
      const newView = renderPage();
      return i.update({
        embeds: [newView.embed],
        components: [newView.row, newView.pokedexRow]
      });
    }
    if (i.customId === "close_list") {
      collector.stop("closed");
      return i.update({ content: "Pokémon list closed.", embeds: [], components: [] });
    }

    // Pokédex inspect button
    if (i.customId.startsWith("inspect_")) {
      const id = parseInt(i.customId.replace("inspect_", ""));
      const p = pokemonData.find((x) => x.id === id);
      if (!p)
        return i.reply({ content: "Pokémon not found.", ephemeral: true });

      const normalSprite = `https://poke-discord-bot.onrender.com/public/sprites/pokemon/${p.id}.gif`;
      const shinySprite = `https://poke-discord-bot.onrender.com/public/sprites/pokemon/${p.id}_shiny.gif`;

      let showingShiny = false;
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

      await i.update({ embeds: [entryEmbed], components: [shinyRow] });

      const innerCollector = i.message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
      });

      innerCollector.on("collect", async (b) => {
        if (b.user.id !== userId)
          return b.reply({ content: "This entry isn't yours.", ephemeral: true });

        switch (b.customId) {
          case "toggle_shiny":
            showingShiny = !showingShiny;
            entryEmbed.setThumbnail(showingShiny ? shinySprite : normalSprite);
            entryEmbed.setColor(showingShiny ? 0xdaa520 : 0xffcb05);
            await b.update({ embeds: [entryEmbed], components: [shinyRow] });
            break;

          case "back_to_list": {
            const restored = renderPage();
            innerCollector.stop("back");
            await b.update({
              embeds: [restored.embed],
              components: [restored.row, restored.pokedexRow]
            });
            break;
          }

          case "close_entry":
            innerCollector.stop("closed");
            await b.update({
              content: "Pokédex entry closed.",
              embeds: [],
              components: []
            });
            break;
        }
      });

      innerCollector.on("end", async (_, reason) => {
        if (["closed", "back"].includes(reason)) return;
        await i.message.edit({ components: [] }).catch(() => {});
      });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "closed") {
      await msg.edit({ components: [] }).catch(() => {});
    }
  });
}
