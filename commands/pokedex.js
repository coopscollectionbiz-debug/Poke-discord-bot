// ==========================================================
// 📘 /pokedex — View Pokémon by rarity, type, or search term
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import pokemonData from "../pokemonData.json" with { type: "json" };

// 🧩 Normalized rarity order
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// 🧩 Normalize rarity strings
function normalizeRarity(rarity) {
  if (!rarity) return "common";
  const val = rarity.toLowerCase();
  return RARITY_ORDER.includes(val) ? val : "common";
}

// 🧩 Normalize type strings
function normalizeType(type) {
  if (!type) return "unknown";
  return String(type).toLowerCase();
}

// ==========================================================
// 🧠 Helper: Generate pages
// ==========================================================
function paginate(list, pageSize = 12) {
  const pages = [];
  for (let i = 0; i < list.length; i += pageSize) {
    pages.push(list.slice(i, i + pageSize));
  }
  return pages;
}

// ==========================================================
// 🧠 Helper: Build paginated embed
// ==========================================================
function buildEmbed(filtered, pageIndex = 0, rarity, type, search) {
  const pages = paginate(filtered, 12);
  const currentPage = pages[pageIndex] ?? [];
  const totalPages = pages.length || 1;

  const embed = new EmbedBuilder()
    .setTitle("Pokédex Browser")
    .setDescription(
      `Filter → **Rarity:** ${rarity || "all"}, **Type:** ${type || "all"}${search ? `, **Search:** ${search}` : ""
      }\nPage ${pageIndex + 1} / ${totalPages}`
    )
    .setColor("#FFD700");

  if (currentPage.length === 0) {
    embed.addFields([{ name: "No results", value: "Try changing your filters." }]);
  } else {
    for (const mon of currentPage) {
      embed.addFields([
        {
          name: `${mon.name} (${mon.id})`,
          value: `Rarity: ${normalizeRarity(mon.rarity)} | Type: ${normalizeType(mon.type)}`,
          inline: true,
        },
      ]);
    }
  }

  return embed;
}

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("Browse Pokémon by rarity, type, or name.")
    .addStringOption(opt =>
      opt
        .setName("rarity")
        .setDescription("Filter by rarity")
        .addChoices(
          ...RARITY_ORDER.map(r => ({ name: r, value: r }))
        )
    )
    .addStringOption(opt =>
      opt
        .setName("type")
        .setDescription("Filter by type (fire, grass, etc.)")
    )
    .addStringOption(opt =>
      opt
        .setName("search")
        .setDescription("Search by Pokémon name")
    ),

  // ========================================================
  // 🏃 Command Execution
  // ========================================================
  async execute(interaction) {
    try {
      // Gather filters
      const rarity = normalizeRarity(interaction.options.getString("rarity"));
      const type = normalizeType(interaction.options.getString("type"));
      const search = interaction.options.getString("search")?.toLowerCase() || "";

      // Build list safely
      const allPokemon = Object.values(pokemonData).filter(p => !!p?.name);
      let filtered = allPokemon;

      if (rarity && RARITY_ORDER.includes(rarity)) {
        filtered = filtered.filter(p => normalizeRarity(p.rarity) === rarity);
      }
      if (type && type !== "all" && type !== "unknown") {
        filtered = filtered.filter(p => normalizeType(p.type) === type);
      }
      if (search) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(search));
      }

      // Sort by rarity order then ID
      filtered.sort((a, b) => {
        const r1 = RARITY_ORDER.indexOf(normalizeRarity(a.rarity));
        const r2 = RARITY_ORDER.indexOf(normalizeRarity(b.rarity));
        if (r1 === r2) return a.id - b.id;
        return r1 - r2;
      });

      // Paginate & show
      let pageIndex = 0;
      const embed = buildEmbed(filtered, pageIndex, rarity, type, search);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setLabel("⬅️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("next").setLabel("➡️").setStyle(ButtonStyle.Secondary)
      );

      const reply = await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: 64, // ephemeral replacement
      });

      // Collector for navigation
      const collector = reply.createMessageComponentCollector({
        time: 60_000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: "Only you can use this menu.", flags: 64 });
          return;
        }

        if (i.customId === "next") {
          pageIndex = (pageIndex + 1) % Math.max(1, paginate(filtered).length);
        } else if (i.customId === "prev") {
          pageIndex = (pageIndex - 1 + paginate(filtered).length) % Math.max(1, paginate(filtered).length);
        }

        await i.update({
          embeds: [buildEmbed(filtered, pageIndex, rarity, type, search)],
          components: [row],
        });
      });

      collector.on("end", async () => {
        const disabled = row.components.map(b => b.setDisabled(true));
        await interaction.editReply({
          embeds: [buildEmbed(filtered, pageIndex, rarity, type, search)],
          components: [new ActionRowBuilder().addComponents(...disabled)],
        });
      });
    } catch (err) {
      console.error("❌ Error executing /pokedex:", err);
      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ There was an error running this command.",
          flags: 64,
        });
      }
    }
  },
};
