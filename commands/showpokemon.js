// ==========================================================
// 🧩 /showpokemon — Displays owned Pokémon in paginated grid
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import pokemonData from "../pokemonData.json" with { type: "json" };

// Normalized rarity order
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// Normalize rarity/type helpers
const normalizeRarity = r =>
  RARITY_ORDER.includes(String(r).toLowerCase()) ? String(r).toLowerCase() : "common";
const normalizeType = t => String(t || "unknown").toLowerCase();

// Pagination helper
function paginate(arr, per = 12) {
  const pages = [];
  for (let i = 0; i < arr.length; i += per) pages.push(arr.slice(i, i + per));
  return pages.length ? pages : [[]];
}

// Build embed page
function buildEmbed(userPokemon, pageIndex, rarity, type, shiny) {
  const pages = paginate(userPokemon, 12);
  const current = pages[pageIndex] ?? [];
  const totalPages = pages.length;

  const embed = new EmbedBuilder()
    .setTitle("Your Pokémon Collection")
    .setDescription(
      `Filters → **Rarity:** ${rarity || "all"}, **Type:** ${type || "all"}, **Shiny:** ${shiny || "all"}\nPage ${pageIndex + 1}/${totalPages}`
    )
    .setColor("#4FC3F7");

  if (!current.length) {
    embed.addFields([{ name: "Empty", value: "No Pokémon match your filters." }]);
  } else {
    for (const p of current) {
      const mon = pokemonData[p.id];
      if (!mon) continue;
      const name = mon.name ?? "Unknown";
      embed.addFields([
        {
          name: `${name}${p.shiny ? " ✨" : ""}`,
          value: `ID: ${p.id}\nRarity: ${normalizeRarity(mon.rarity)}\nType: ${normalizeType(mon.type)}\nCount: ${p.count}`,
          inline: true,
        },
      ]);
    }
  }
  return embed;
}

export default {
  data: new SlashCommandBuilder()
    .setName("showpokemon")
    .setDescription("View your owned Pokémon with filters.")
    .addStringOption(opt =>
      opt
        .setName("rarity")
        .setDescription("Filter by rarity")
        .addChoices(...RARITY_ORDER.map(r => ({ name: r, value: r })))
    )
    .addStringOption(opt =>
      opt.setName("type").setDescription("Filter by type (fire, grass, etc.)")
    )
    .addStringOption(opt =>
      opt
        .setName("shiny")
        .setDescription("Filter shiny Pokémon")
        .addChoices(
          { name: "Yes", value: "yes" },
          { name: "No", value: "no" }
        )
    ),

  async execute(interaction, trainerData) {
    try {
      const user = trainerData[interaction.user.id];
      if (!user || !user.pokemon || !Object.keys(user.pokemon).length) {
        return await interaction.reply({
          content: "❌ You don't own any Pokémon yet.",
          flags: 64,
        });
      }

      const rarity = normalizeRarity(interaction.options.getString("rarity"));
      const type = normalizeType(interaction.options.getString("type"));
      const shiny = interaction.options.getString("shiny");

      // Convert stored structure { id: { normal, shiny } } → flat list
      const list = [];
      for (const [id, data] of Object.entries(user.pokemon)) {
        if (data.normal > 0) list.push({ id, shiny: false, count: data.normal });
        if (data.shiny > 0) list.push({ id, shiny: true, count: data.shiny });
      }

      // Apply filters
      let filtered = list.filter(p => pokemonData[p.id]);
      if (rarity && RARITY_ORDER.includes(rarity)) {
        filtered = filtered.filter(
          p => normalizeRarity(pokemonData[p.id].rarity) === rarity
        );
      }
      if (type && type !== "all" && type !== "unknown") {
        filtered = filtered.filter(
          p => normalizeType(pokemonData[p.id].type) === type
        );
      }
      if (shiny === "yes") filtered = filtered.filter(p => p.shiny);
      if (shiny === "no") filtered = filtered.filter(p => !p.shiny);

      // Sort by rarity then ID
      filtered.sort((a, b) => {
        const r1 = RARITY_ORDER.indexOf(normalizeRarity(pokemonData[a.id].rarity));
        const r2 = RARITY_ORDER.indexOf(normalizeRarity(pokemonData[b.id].rarity));
        return r1 === r2 ? a.id - b.id : r1 - r2;
      });

      let page = 0;
      const embed = buildEmbed(filtered, page, rarity, type, shiny);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setLabel("⬅️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("next").setLabel("➡️").setStyle(ButtonStyle.Secondary)
      );

      const reply = await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: 64,
      });

      const collector = reply.createMessageComponentCollector({ time: 60_000 });
      collector.on("collect", async i => {
        if (i.user.id !== interaction.user.id)
          return i.reply({ content: "Not your menu.", flags: 64 });

        const max = paginate(filtered).length;
        if (i.customId === "next") page = (page + 1) % max;
        if (i.customId === "prev") page = (page - 1 + max) % max;
        await i.update({ embeds: [buildEmbed(filtered, page, rarity, type, shiny)], components: [row] });
      });

      collector.on("end", async () => {
        const disabled = row.components.map(b => b.setDisabled(true));
        await interaction.editReply({
          embeds: [buildEmbed(filtered, page, rarity, type, shiny)],
          components: [new ActionRowBuilder().addComponents(...disabled)],
        });
      });
    } catch (e) {
      console.error("❌ Error in /showpokemon:", e);
      if (!interaction.replied)
        await interaction.reply({ content: "Error showing Pokémon.", flags: 64 });
    }
  },
};
