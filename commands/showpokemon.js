import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from "discord.js";
import pokemonData from "../pokemonData.json" assert { type: "json" };

// ✅ Feature constants
const PAGE_SIZE = 12;
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

export default {
  data: new SlashCommandBuilder()
    .setName("showpokemon")
    .setDescription("Browse your Pokémon collection (with filters).")
    .addStringOption(opt =>
      opt.setName("search")
        .setDescription("Search Pokémon by name substring.")
        .setRequired(false)
    ),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: 64 }); // ✅ Ephemeral response

    const userId = interaction.user.id;
    const user = trainerData[userId];
    if (!user?.pokemon || Object.keys(user.pokemon).length === 0) {
      await interaction.editReply("You don't own any Pokémon yet!");
      return;
    }

    // ---------- Working state ----------
    let page = 0;
    let shinyView = "both"; // ✅ Shiny toggle
    let sortMode = "name";  // ✅ Sort mode
    let rarityFilter = "all"; // ✅ Rarity filter
    let search = (interaction.options.getString("search") || "").trim().toLowerCase();

    // ✅ Helper to build filtered/sorted Pokémon list
    const getOwnedList = () => {
      const entries = Object.entries(user.pokemon);
      let list = entries.map(([id, counts]) => {
        const mon = pokemonData[id];
        if (!mon) return null;
        const total = (counts.normal || 0) + (counts.shiny || 0);
        return {
          id: Number(id),
          name: mon.name,
          rarity: mon.rarity?.toLowerCase() || "common",
          counts,
          total,
        };
      }).filter(Boolean);

      if (search) list = list.filter(p => p.name.toLowerCase().includes(search));
      if (rarityFilter !== "all") list = list.filter(p => p.rarity === rarityFilter);
      if (shinyView === "normal") list = list.filter(p => (p.counts.normal || 0) > 0);
      if (shinyView === "shiny") list = list.filter(p => (p.counts.shiny || 0) > 0);

      if (sortMode === "name") list.sort((a, b) => a.name.localeCompare(b.name));
      else if (sortMode === "count") list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      else if (sortMode === "rarity")
        list.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));

      return list;
    };

    const paginate = (list) => list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    // ✅ Embed builder
    const buildEmbed = () => {
      const all = getOwnedList();
      const shown = paginate(all);
      const embed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle(`${interaction.user.username}'s Pokémon`)
        .setDescription(
          `✨ View: **${shinyView}** | 📊 Sort: **${sortMode}** | 💎 Rarity: **${rarityFilter}**\n` +
          `Results: **${all.length}** • Page ${page + 1}/${Math.max(1, Math.ceil(all.length / PAGE_SIZE))}` +
          (search ? `\n🔍 Filter: *${search}*` : "")
        );

      if (shown.length === 0) {
        embed.addFields({ name: "No results", value: "Try different filters." });
      } else {
        for (const p of shown) {
          const normal = p.counts.normal ?? 0;
          const shiny = p.counts.shiny ?? 0;
          embed.addFields({
            name: `${p.name} (${p.rarity})`,
            value: `Normal: **${normal}**${shiny ? ` • Shiny: **${shiny}** ✨` : ""}`,
            inline: true,
          });
        }
      }
      return embed;
    };

    // ✅ Button row (pagination + filters)
    const buildRow = () =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("toggle_shiny").setLabel(`View: ${shinyView}`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("sort").setLabel(`Sort: ${sortMode}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rarity").setLabel(`Rarity: ${rarityFilter}`).setStyle(ButtonStyle.Secondary),
      );

    const render = async () =>
      await interaction.editReply({ embeds: [buildEmbed()], components: [buildRow()] });

    await render();

    // ✅ Collector logic
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "❌ Not your session.", flags: 64 });

      switch (i.customId) {
        case "prev": if (page > 0) page--; break;
        case "next":
          const max = Math.max(0, Math.ceil(getOwnedList().length / PAGE_SIZE) - 1);
          if (page < max) page++;
          break;
        case "toggle_shiny":
          shinyView = shinyView === "both" ? "normal" : shinyView === "normal" ? "shiny" : "both";
          page = 0;
          break;
        case "sort":
          sortMode = sortMode === "name" ? "count" : sortMode === "count" ? "rarity" : "name";
          page = 0;
          break;
        case "rarity":
          const current = RARITY_ORDER.concat(["all"]);
          rarityFilter = current[(current.indexOf(rarityFilter) + 1) % current.length];
          page = 0;
          break;
      }
      await i.deferUpdate();
      await render();
    });

    collector.on("end", async () => {
      try { await interaction.editReply({ components: [] }); } catch {}
    });
  },
};
