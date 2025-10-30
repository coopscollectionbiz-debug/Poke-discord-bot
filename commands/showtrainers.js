import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";

const TRAINER_BASE_URL = "https://poke-discord-bot.onrender.com/public/sprites/trainers_2/";
const PAGE_SIZE = 12;
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

export default {
  data: new SlashCommandBuilder()
    .setName("showtrainers")
    .setDescription("Browse your trainer sprites (filtered by rarity tiers)."),

  async execute(interaction, trainerData, saveTrainerData) {
    await interaction.deferReply({ flags: 64 }); // ✅ Ephemeral

    const userId = interaction.user.id;
    const user = trainerData[userId];
    if (!user?.trainers || Object.keys(user.trainers).length === 0) {
      await interaction.editReply("You don't own any trainer sprites yet!");
      return;
    }

    let page = 0;
    let sortMode = "name"; // ✅ Sorting
    let rarityFilter = "all"; // ✅ Rarity filter

    // ✅ Mock rarity lookup (adjust if you have a trainer rarity dataset)
    const getTrainerRarity = (file) => {
      const lower = file.toLowerCase();
      if (lower.includes("grunt")) return "common";
      if (lower.includes("ace") || lower.includes("lass")) return "uncommon";
      if (lower.includes("elite")) return "rare";
      if (lower.includes("champion")) return "legendary";
      return "common";
    };

    const getList = () => {
      const entries = Object.entries(user.trainers);
      let rows = entries.map(([file, count]) => ({
        file,
        count,
        rarity: getTrainerRarity(file),
        url: `${TRAINER_BASE_URL}${file}`,
      }));
      if (rarityFilter !== "all") rows = rows.filter(r => r.rarity === rarityFilter);
      if (sortMode === "name") rows.sort((a, b) => a.file.localeCompare(b.file));
      else if (sortMode === "count") rows.sort((a, b) => b.count - a.count);
      else if (sortMode === "rarity")
        rows.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
      return rows;
    };

    const paginate = (list) => list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const buildEmbed = () => {
      const all = getList();
      const shown = paginate(all);
      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle(`${interaction.user.username}'s Trainers`)
        .setDescription(
          `📊 Sort: **${sortMode}** | 💎 Rarity: **${rarityFilter}**\n` +
          `Results: **${all.length}** • Page ${page + 1}/${Math.max(1, Math.ceil(all.length / PAGE_SIZE))}\n` +
          `Active Trainer: **${user.trainer || "none"}**`
        );

      if (shown.length === 0) embed.addFields({ name: "No results", value: "Try changing filters." });
      else {
        for (const t of shown) {
          embed.addFields({
            name: `${t.file} (${t.rarity})`,
            value: `Owned ×**${t.count}** • [Preview](${t.url})${user.trainer === t.file ? " • ✅ Active" : ""}`,
            inline: true,
          });
        }
      }
      return embed;
    };

    const buildRow = () =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("sort").setLabel(`Sort: ${sortMode}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rarity").setLabel(`Rarity: ${rarityFilter}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("set_active").setLabel("Set Active").setStyle(ButtonStyle.Primary),
      );

    const render = async () =>
      await interaction.editReply({ embeds: [buildEmbed()], components: [buildRow()] });

    await render();

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
          const max = Math.max(0, Math.ceil(getList().length / PAGE_SIZE) - 1);
          if (page < max) page++;
          break;
        case "sort":
          sortMode = sortMode === "name" ? "count" : sortMode === "count" ? "rarity" : "name";
          page = 0;
          break;
        case "rarity":
          const next = RARITY_ORDER.concat(["all"]);
          rarityFilter = next[(next.indexOf(rarityFilter) + 1) % next.length];
          page = 0;
          break;
        case "set_active":
          const visible = paginate(getList());
          if (visible.length > 0) {
            user.trainer = visible[0].file;
            await saveTrainerData();
          }
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
