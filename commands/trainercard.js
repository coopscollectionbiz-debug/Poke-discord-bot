// ==========================================================
// 🧩 /trainercard Command
// Trainer Profile Display + Pokémon & Trainer Selection
// ==========================================================
//
// ✅ Supports:
//    - Displaying trainer card with sprite + up to 6 chosen Pokémon
//    - Paginated Pokémon selector with filters: rarity, type, shiny, search
//    - Paginated trainer selector with filters: rarity, search
//    - Ephemeral safe collectors and persistence
//    - Lowercased rarity & type normalization
//    - Fixed rarity order: common → uncommon → rare → epic → legendary → mythic
//
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import pokemonData from "../pokemonData.json" assert { type: "json" };
import trainerSprites from "../trainerSprites.json" assert { type: "json" };
import { spritePaths } from "../spriteconfig.js";

const TRAINER_BASE_URL =
  "https://poke-discord-bot.onrender.com/public/sprites/trainers_2/";
const PAGE_SIZE = 12;
const MAX_DISPLAY = 6;
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// ==========================================================
// 🧩 Slash Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("trainercard")
    .setDescription("View or customize your Trainer Card."),

  async execute(interaction, trainerData, saveTrainerData) {
    await interaction.deferReply({ flags: 64 }); // ✅ Ephemeral response
    const userId = interaction.user.id;

    // ✅ Ensure user data exists
    if (!trainerData[userId]) trainerData[userId] = {};
    const user = trainerData[userId];
    user.tp ??= 0;
    user.cc ??= 0;
    if (!user.pokemon) user.pokemon = {};
    if (!user.trainers) user.trainers = {};
    user.trainer ??= "youngster-gen4.png";
    user.displayedPokemon ??= [];

    // ✅ Render trainer card
    await renderTrainerCard(interaction, user, saveTrainerData);
  },
};

// ==========================================================
// 🧾 Render Trainer Card Embed
// ==========================================================
async function renderTrainerCard(interaction, user, saveTrainerData) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${interaction.user.username}'s Trainer Card`)
    .setDescription(
      `🧍 **Trainer Sprite:** ${user.trainer}\n` +
        `💎 **TP:** ${user.tp.toLocaleString()} | 💰 **CC:** ${user.cc.toLocaleString()}`
    )
    .setImage(`${TRAINER_BASE_URL}${user.trainer}`);

  // ✅ Display selected Pokémon in a 3x2 grid
  const grid = buildPokemonGrid(user);
  embed.addFields({
    name: "Displayed Pokémon",
    value: grid.length > 0 ? grid.join("\n") : "No Pokémon selected yet.",
  });

  // ✅ Button controls
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("change_trainer")
      .setLabel("Change Trainer Sprite")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("change_displayed")
      .setLabel("Change Displayed Pokémon")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  // ✅ Button collector
  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000,
  });

  collector.on("collect", async (btnInt) => {
    if (btnInt.user.id !== interaction.user.id)
      return btnInt.reply({ content: "❌ Not your trainer card.", flags: 64 });

    if (btnInt.customId === "change_displayed")
      await openPokemonSelector(btnInt, user, saveTrainerData);
    if (btnInt.customId === "change_trainer")
      await openTrainerSelector(btnInt, user, saveTrainerData);
  });

  collector.on("end", async () => {
    const disabled = row.components.map((b) => b.setDisabled(true));
    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(...disabled)],
    });
  });
}

// ==========================================================
// 🎴 Pokémon Grid Builder (3x2)
// ==========================================================
function buildPokemonGrid(user) {
  const ids = user.displayedPokemon.slice(0, MAX_DISPLAY);
  if (ids.length === 0) return [];
  const lines = [];
  for (let i = 0; i < ids.length; i += 3) {
    const row = ids
      .slice(i, i + 3)
      .map((id) => {
        const mon = pokemonData[id];
        if (!mon) return "❓";
        const shiny = (user.pokemon[id]?.shiny || 0) > 0;
        const sprite = shiny
          ? `${spritePaths.pokemon.shiny}${id}.gif`
          : `${spritePaths.pokemon.normal}${id}.gif`;
        return `[${mon.name}](${sprite})`;
      })
      .join("  ");
    lines.push(row);
  }
  return lines;
}

// ==========================================================
// 🧩 Pokémon Selector (Pagination + Filters)
// ==========================================================
async function openPokemonSelector(interaction, user, saveTrainerData) {
  let page = 0;
  let rarity = "all";
  let type = "all";
  let shiny = "both";
  let search = "";

  const allOwned = Object.entries(user.pokemon);
  if (allOwned.length === 0)
    return interaction.reply({ content: "You don’t own any Pokémon yet!", flags: 64 });

  const getFiltered = () => {
    let list = allOwned
      .map(([id, counts]) => {
        const mon = pokemonData[id];
        if (!mon) return null;
        return {
          id: Number(id),
          name: mon.name,
          rarity: (mon.rarity || "common").toLowerCase(),
          type: (Array.isArray(mon.type) ? mon.type[0] : mon.type || "unknown").toLowerCase(),
          counts,
        };
      })
      .filter(Boolean);

    if (rarity !== "all") list = list.filter((m) => m.rarity === rarity);
    if (type !== "all") list = list.filter((m) => m.type === type);
    if (shiny === "normal") list = list.filter((m) => (m.counts.normal || 0) > 0);
    if (shiny === "shiny") list = list.filter((m) => (m.counts.shiny || 0) > 0);
    if (search) list = list.filter((m) => m.name.toLowerCase().includes(search));

    return list.sort((a, b) => a.name.localeCompare(b.name));
  };

  const renderPage = async () => {
    const filtered = getFiltered();
    const start = page * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle("Select Displayed Pokémon")
      .setDescription(
        `Select up to **${MAX_DISPLAY}** Pokémon to display.\n` +
          `Filters → Rarity: **${rarity}**, Type: **${type}**, Shiny: **${shiny}**\n` +
          `Results: ${filtered.length}, Page ${page + 1}/${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}\n` +
          `Currently selected: ${user.displayedPokemon.length}/${MAX_DISPLAY}`
      );

    if (slice.length === 0) embed.addFields({ name: "No results", value: "Adjust filters or search." });
    else
      for (const p of slice) {
        const selected = user.displayedPokemon.includes(p.id);
        embed.addFields({
          name: `${selected ? "✅ " : ""}${p.name} (${p.rarity})`,
          value: `Type: ${p.type} • Normal: ${p.counts.normal} • Shiny: ${p.counts.shiny}`,
          inline: true,
        });
      }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rarity").setLabel(`Rarity: ${rarity}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("type").setLabel(`Type: ${type}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("shiny").setLabel(`Shiny: ${shiny}`).setStyle(ButtonStyle.Secondary)
    );

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("search").setLabel("Search").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("confirm").setLabel("✅ Confirm").setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [buttons, confirmRow] });
  };

  await renderPage();

  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 90000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "❌ Not your selection.", flags: 64 });

    if (i.customId === "next") {
      const max = Math.ceil(getFiltered().length / PAGE_SIZE);
      if (page < max - 1) page++;
    } else if (i.customId === "prev") {
      if (page > 0) page--;
    } else if (i.customId === "confirm") {
      await saveTrainerData();
      await i.update({ content: "✅ Displayed Pokémon updated!", components: [], embeds: [] });
      collector.stop();
      return renderTrainerCard(interaction, user, saveTrainerData);
    } else if (i.customId === "search") {
      // ✅ Modal search prompt
      const modal = new ModalBuilder().setCustomId("search_modal").setTitle("Search Pokémon");
      const input = new TextInputBuilder()
        .setCustomId("search_query")
        .setLabel("Search by name:")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await i.showModal(modal);
      try {
        const submitted = await i.awaitModalSubmit({ time: 30000 });
        search = submitted.fields.getTextInputValue("search_query").toLowerCase();
        page = 0;
        await submitted.deferUpdate();
      } catch {}
    } else if (i.customId === "rarity") {
      const order = RARITY_ORDER.concat("all");
      rarity = order[(order.indexOf(rarity) + 1) % order.length];
      page = 0;
    } else if (i.customId === "type") {
      const types = ["all", "fire", "water", "grass", "electric", "psychic", "fighting", "normal"];
      type = types[(types.indexOf(type) + 1) % types.length];
      page = 0;
    } else if (i.customId === "shiny") {
      shiny = shiny === "both" ? "normal" : shiny === "normal" ? "shiny" : "both";
      page = 0;
    } else if (i.customId.startsWith("toggle_")) {
      const id = Number(i.customId.replace("toggle_", ""));
      const idx = user.displayedPokemon.indexOf(id);
      if (idx >= 0) user.displayedPokemon.splice(idx, 1);
      else if (user.displayedPokemon.length < MAX_DISPLAY) user.displayedPokemon.push(id);
    }

    await i.deferUpdate();
    await renderPage();
  });

  collector.on("end", async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch {}
  });
}

// ==========================================================
// 🧍 Trainer Selector (Pagination + Rarity Filter + Search)
// ==========================================================
async function openTrainerSelector(interaction, user, saveTrainerData) {
  let page = 0;
  let rarity = "all";
  let search = "";

  const allOwned = Object.entries(user.trainers);
  if (allOwned.length === 0)
    return interaction.reply({ content: "You don’t own any trainer sprites!", flags: 64 });

  const getFiltered = () => {
    let list = allOwned
      .map(([file, count]) => {
        const sprite = trainerSprites[file];
        return {
          file,
          count,
          rarity: (sprite?.rarity || "common").toLowerCase(),
          url: `${TRAINER_BASE_URL}${file}`,
        };
      })
      .filter(Boolean);

    if (rarity !== "all") list = list.filter((t) => t.rarity === rarity);
    if (search) list = list.filter((t) => t.file.toLowerCase().includes(search));

    return list.sort(
      (a, b) =>
        RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
        a.file.localeCompare(b.file)
    );
  };

  const renderPage = async () => {
    const filtered = getFiltered();
    const start = page * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    const embed = new EmbedBuilder()
      .setColor(0xffcc00)
      .setTitle("Select Trainer Sprite")
      .setDescription(
        `Filter → Rarity: **${rarity}** | Results: ${filtered.length} | Page ${page + 1}/${Math.max(
          1,
          Math.ceil(filtered.length / PAGE_SIZE)
        )}`
      );

    if (slice.length === 0) embed.addFields({ name: "No results", value: "Adjust filters." });
    else
      for (const t of slice)
        embed.addFields({
          name: `${user.trainer === t.file ? "✅ " : ""}${t.file}`,
          value: `Owned ×${t.count} • Rarity: ${t.rarity} • [Preview](${t.url})`,
          inline: true,
        });

    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("rarity").setLabel(`Rarity: ${rarity}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("search").setLabel("Search").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("confirm").setLabel("✅ Confirm").setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [controls] });
  };

  await renderPage();

  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 90000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id)
      return i.reply({ content: "❌ Not your selection.", flags: 64 });

    if (i.customId === "next") {
      const max = Math.ceil(getFiltered().length / PAGE_SIZE);
      if (page < max - 1) page++;
    } else if (i.customId === "prev") {
      if (page > 0) page--;
    } else if (i.customId === "rarity") {
      const order = RARITY_ORDER.concat("all");
      rarity = order[(order.indexOf(rarity) + 1) % order.length];
      page = 0;
    } else if (i.customId === "search") {
      const modal = new ModalBuilder().setCustomId("search_modal").setTitle("Search Trainer");
      const input = new TextInputBuilder()
        .setCustomId("search_query")
        .setLabel("Filename contains:")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await i.showModal(modal);
      try {
        const submitted = await i.awaitModalSubmit({ time: 30000 });
        search = submitted.fields.getTextInputValue("search_query").toLowerCase();
        page = 0;
        await submitted.deferUpdate();
      } catch {}
    } else if (i.customId === "confirm") {
      await saveTrainerData();
      await i.update({ content: "✅ Trainer sprite updated!", components: [], embeds: [] });
      collector.stop();
      return renderTrainerCard(interaction, user, saveTrainerData);
    } else if (i.customId.startsWith("trainer_")) {
      const chosen = i.customId.replace("trainer_", "");
      user.trainer = chosen;
      await saveTrainerData();
    }

    await i.deferUpdate();
    await renderPage();
  });

  collector.on("end", async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch {}
  });
}
