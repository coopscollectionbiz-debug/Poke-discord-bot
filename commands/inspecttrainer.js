// ==========================================================
// inspecttrainer.js — View another user's Trainer sprite collection
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fs from "fs/promises";

// ✅ JSON-safe imports (Render compatible)
const trainerSprites = JSON.parse(
  await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
);

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("inspecttrainer")
    .setDescription("View another user’s Trainer sprite collection.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user whose trainers you want to view.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("rarity")
        .setDescription("Filter by trainer rarity.")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Common", value: "common" },
          { name: "Uncommon", value: "uncommon" },
          { name: "Rare", value: "rare" },
          { name: "Epic", value: "epic" },
          { name: "Legendary", value: "legendary" },
          { name: "Mythic", value: "mythic" }
        )
        .setRequired(false)
    ),

  // ==========================================================
  // ⚙️ Command Execution
  // ==========================================================
  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: 64 });

    const targetUser = interaction.options.getUser("user");
    const filterRarity = interaction.options.getString("rarity") || "all";

    if (!trainerData[targetUser.id]) {
      return interaction.editReply({
        content: `❌ ${targetUser.username} doesn’t have a trainer profile yet.`,
      });
    }

    const userData = trainerData[targetUser.id];
    const ownedTrainerKeys = Object.keys(userData.trainers || {});

    if (ownedTrainerKeys.length === 0) {
      return interaction.editReply({
        content: `⚠️ ${targetUser.username} doesn’t own any trainers yet.`,
      });
    }

    // Filter trainers based on rarity
    const filtered = trainerSprites.filter(t => {
      const owned = ownedTrainerKeys.includes(t.file);
      const rarityMatch =
        filterRarity === "all" ||
        t.rarity?.toLowerCase() === filterRarity.toLowerCase();
      return owned && rarityMatch;
    });

    if (filtered.length === 0) {
      return interaction.editReply({
        content: `⚠️ No trainers found matching **${filterRarity}** rarity.`,
      });
    }

    // ==========================================================
    // 📄 Pagination Setup
    // ==========================================================
    const trainersPerPage = 12;
    const totalPages = Math.ceil(filtered.length / trainersPerPage);
    let currentPage = 0;

    const renderPage = page => {
      const start = page * trainersPerPage;
      const trainersToShow = filtered.slice(start, start + trainersPerPage);

      const embed = new EmbedBuilder()
        .setTitle(`🎓 ${targetUser.username}’s Trainer Collection`)
        .setDescription(
          filterRarity !== "all"
            ? `Filtering by **${filterRarity.toUpperCase()}** rarity`
            : "Showing all owned trainers"
        )
        .setColor(0x5865f2)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
        .setTimestamp();

      // Build trainer grid (inline images)
      const grid = trainersToShow
        .map(
          t =>
            `**${t.name}**\n[Sprite Link](${t.url || `https://poke-discord-bot.onrender.com/public/sprites/trainers_2/${t.file}`})`
        )
        .join("\n\n");

      embed.addFields({ name: "Owned Trainers", value: grid });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev_page")
          .setLabel("⬅️ Prev")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId("next_page")
          .setLabel("Next ➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages - 1)
      );

      return { embed, row };
    };

    const { embed, row } = renderPage(currentPage);
    const message = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // ==========================================================
    // 🎮 Collector for pagination buttons
    // ==========================================================
    const collector = message.createMessageComponentCollector({
      time: 60000, // 1 minute timeout
    });

    collector.on("collect", async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({
          content: "⚠️ You can’t control this menu.",
          flags: 64,
        });
      }

      if (i.customId === "prev_page" && currentPage > 0) currentPage--;
      if (i.customId === "next_page" && currentPage < totalPages - 1)
        currentPage++;

      const { embed, row } = renderPage(currentPage);
      await i.update({ embeds: [embed], components: [row] });
    });

    collector.on("end", async () => {
      await interaction.editReply({ components: [] });
    });
  },
};
