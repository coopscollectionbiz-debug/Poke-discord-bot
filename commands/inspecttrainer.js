// ==========================================================
// inspecttrainer.js (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import {
  createPaginationButtons,
  calculateTotalPages,
  getPage,
} from "../utils/pagination.js";
import { safeReply } from "../utils/safeReply.js";

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("inspecttrainer")
    .setDescription("View another user's Trainer sprite collection.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user whose trainers you want to view.")
        .setRequired(true)
    )
    .addStringOption((option) =>
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
  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser("user");
    const filterRarity = interaction.options.getString("rarity") || "all";

    if (!trainerData[targetUser.id]) {
      return safeReply(interaction, {
        content: `❌ ${targetUser.username} doesn't have a trainer profile yet.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const userData = trainerData[targetUser.id];
    const ownedTrainerKeys = Object.keys(userData.trainers || {});

    if (ownedTrainerKeys.length === 0) {
      return safeReply(interaction, {
        content: `⚠️ ${targetUser.username} doesn't own any trainers yet.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ==========================================================
    // 🧮 Filter trainers by ownership + rarity
    // ==========================================================
    const allTrainers = await getFlattenedTrainers();
    const filtered = allTrainers.filter((t) => {
      const key = t.filename || t.file;
      const owned = ownedTrainerKeys.includes(key);
      const rarityMatch =
        filterRarity === "all" ||
        (t.rarity && t.rarity.toLowerCase() === filterRarity.toLowerCase());
      return owned && rarityMatch;
    });

    if (filtered.length === 0) {
      return safeReply(interaction, {
        content: `⚠️ No trainers found matching **${filterRarity}** rarity.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ==========================================================
    // 📄 Pagination Setup
    // ==========================================================
    const trainersPerPage = 12;
    const totalPages = calculateTotalPages(filtered, trainersPerPage);
    let currentPage = 0;

    const renderPage = (page) => {
      const trainersToShow = getPage(filtered, page, trainersPerPage);

      const embed = new EmbedBuilder()
        .setTitle(`🎓 ${targetUser.username}'s Trainer Collection`)
        .setDescription(
          filterRarity !== "all"
            ? `Filtering by **${filterRarity.toUpperCase()}** rarity`
            : "Showing all owned trainers"
        )
        .setColor(0x5865f2)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
        .setTimestamp();

      const grid = trainersToShow
        .map((t) => {
          const file = t.filename || t.file;
          const spriteUrl = t.url
            ? t.url
            : t.grayscale
            ? `${spritePaths.trainersGray}${file}`
            : `${spritePaths.trainers}${file}`;
          return `**${t.name}**\n[Sprite Link](${spriteUrl})`;
        })
        .join("\n\n");

      embed.addFields({ name: "Owned Trainers", value: grid });

      const row = createPaginationButtons(page, totalPages, false);
      return { embed, row };
    };

    const { embed, row } = renderPage(currentPage);
    const message = await safeReply(interaction, {
      embeds: [embed],
      components: [row],
    });

    // ==========================================================
    // 🎮 Pagination Collector
    // ==========================================================
    const collector = message.createMessageComponentCollector({
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        return safeReply(i, {
          content: "⚠️ You can't control this menu.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (i.customId === "prev_page" && currentPage > 0) currentPage--;
      if (i.customId === "next_page" && currentPage < totalPages - 1)
        currentPage++;

      const { embed, row } = renderPage(currentPage);
      await i.update({ embeds: [embed], components: [row] });
    });

    collector.on("end", async () => {
      try {
        await message.edit({ components: [] });
      } catch {}
    });
  },
};
