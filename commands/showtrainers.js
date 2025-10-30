// ==========================================================
// /showtrainers.js
// Coop's Collection Discord Bot
// ==========================================================
// 🧩 Purpose:
// Interactive trainer browser with drill-down navigation.
//
// Levels:
// 1️⃣ Trainer Class List  →  2️⃣ Class Variants  →  3️⃣ Individual Sprite
//
// ✅ Ephemeral & paginated
// ✅ Back/forward navigation
// ✅ Uses centralized spritePaths.js
// ✅ Handles nested trainerSprites.json
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js";

// ==========================================================
// 🧠 Load trainer sprite dataset safely
// ==========================================================
const trainerSprites = JSON.parse(
  await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
);

// Flatten nested JSON structure for easy filtering
function flattenTrainerSprites(json) {
  const flat = [];
  for (const [className, entries] of Object.entries(json)) {
    for (const entry of entries) {
      if (typeof entry === "string") {
        flat.push({ name: className, sprite: entry, rarity: "common" });
      } else if (entry?.file && !entry.disabled) {
        flat.push({
          name: className,
          sprite: entry.file,
          rarity: entry.rarity || "common"
        });
      }
    }
  }
  return flat;
}
const flatTrainers = flattenTrainerSprites(trainerSprites);

// ==========================================================
// 🧩 Command definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("showtrainers")
    .setDescription("View and inspect your trainer collection.")
    .addStringOption((option) =>
      option
        .setName("rarity")
        .setDescription("Filter trainers by rarity.")
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
        .setDescription("Show only owned or unowned trainers.")
        .addChoices(
          { name: "All", value: "all" },
          { name: "Owned Only", value: "owned" },
          { name: "Unowned Only", value: "unowned" }
        )
    ),

  // ==========================================================
  // ⚙️ Execution
  // ==========================================================
  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const user = trainerData[userId];
    if (!user) {
      return interaction.editReply({
        content: "❌ You don’t have a trainer profile yet. Use `/trainercard` first!"
      });
    }

    const owned = user.trainers || {};
    const rarityFilter = interaction.options.getString("rarity")?.toLowerCase() || "all";
    const ownedFilter = interaction.options.getString("owned")?.toLowerCase() || "owned";

    // ==========================================================
    // 🧮 Group trainers by class
    // ==========================================================
    const grouped = {};
    for (const t of flatTrainers) {
      if (rarityFilter !== "all" && t.rarity?.toLowerCase() !== rarityFilter) continue;
      if (!grouped[t.name]) grouped[t.name] = [];
      grouped[t.name].push(t);
    }

    const rows = Object.entries(grouped)
      .map(([name, variants]) => {
        const ownedCount = variants.filter((v) => owned[v.sprite]).length;
        const totalCount = variants.length;
        const missingCount = totalCount - ownedCount;

        const anyOwned = ownedCount > 0;
        const allUnowned = ownedCount === 0;

        if (ownedFilter === "owned" && !anyOwned) return null;
        if (ownedFilter === "unowned" && !allUnowned) return null;

        return {
          name,
          rarity: variants[0].rarity,
          total: totalCount,
          owned: ownedCount,
          missing: missingCount
        };
      })
      .filter(Boolean);

    const totalOwned = Object.keys(owned).length;
    const totalAvailable = flatTrainers.length;
    const percentOwned = ((totalOwned / totalAvailable) * 100).toFixed(1);

    if (rows.length === 0) {
      return interaction.editReply({
        content: "⚠️ No trainers match your current filters or ownership status."
      });
    }

    // ==========================================================
    // 📄 Pagination setup
    // ==========================================================
    const perPage = 15;
    const totalPages = Math.ceil(rows.length / perPage);
    let currentPage = 0;

    // ==========================================================
    // 🧱 Render trainer class list
    // ==========================================================
    const renderHome = (page) => {
      const start = page * perPage;
      const slice = rows.slice(start, start + perPage);

      const tableRows = slice
        .map(
          (r) =>
            `${r.name.padEnd(18)} | ${r.total.toString().padStart(2)} | ${r.owned
              .toString()
              .padStart(2)} | ${r.missing.toString().padStart(2)}`
        )
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎓 ${interaction.user.username}’s Trainer Collection`)
        .setDescription(
          [
            `Owned: ${totalOwned}/${totalAvailable} (${percentOwned}%)`,
            `Filters: ${rarityFilter.toUpperCase()} | ${ownedFilter.toUpperCase()}`,
            "```",
            `Trainer Class         | Var | Ow | Ms`,
            "---------------------|-----|----|----",
            tableRows,
            "```"
          ].join("\n")
        )
        .setColor(0x43b581)
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
        .setTimestamp();

      const navRow = new ActionRowBuilder().addComponents(
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
          .setCustomId("close")
          .setLabel("❌ Close")
          .setStyle(ButtonStyle.Danger)
      );

      const trainerRow = new ActionRowBuilder();
      slice.forEach((r) => {
        trainerRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`inspect_class_${r.name}`)
            .setLabel(`🔍 ${r.name}`)
            .setStyle(ButtonStyle.Primary)
        );
      });

      return { embed, navRow, trainerRow };
    };

    // ==========================================================
    // 🧩 Render trainer variants for a class
    // ==========================================================
    const renderClass = (className) => {
      const variants = flatTrainers.filter((t) => t.name === className);
      const ownedCount = variants.filter((v) => owned[v.sprite]).length;
      const totalCount = variants.length;

      const rows = variants
        .map((v) => {
          const short = v.sprite.replace(".png", "");
          const isOwned = owned[v.sprite];
          return `${short.padEnd(22)} | ${isOwned ? "✅" : "❌"}`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎓 ${className} — Variants`)
        .setDescription(
          [
            `Owned: ${ownedCount}/${totalCount}`,
            "```",
            `Sprite Variant             | Owned`,
            "---------------------------|------",
            rows,
            "```"
          ].join("\n")
        )
        .setColor(0x3498db);

      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("back_home")
          .setLabel("🏠 Back to All Trainers")
          .setStyle(ButtonStyle.Secondary)
      );

      const variantRow = new ActionRowBuilder();
      variants.forEach((v) => {
        variantRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`inspect_variant_${v.sprite}`)
            .setLabel(`🔍 ${v.sprite.replace(".png", "")}`)
            .setStyle(ButtonStyle.Primary)
        );
      });

      return { embed, backRow, variantRow };
    };

    // ==========================================================
    // 🧩 Render specific trainer sprite
    // ==========================================================
    const renderSprite = (spriteFile, className) => {
      const t = flatTrainers.find((x) => x.sprite === spriteFile);
      if (!t) return null;

      const isOwned = !!owned[t.sprite];
      const fullURL = `${spritePaths.trainers}${t.sprite}`;

      const embed = new EmbedBuilder()
        .setTitle(`🎓 ${t.name} — ${t.sprite.replace(".png", "")}`)
        .setDescription(
          [
            `**Rarity:** ${t.rarity?.toUpperCase() || "COMMON"}`,
            `**Owned:** ${isOwned ? "✅ Yes" : "❌ No"}`
          ].join("\n")
        )
        .setColor(0xf7b731)
        .setImage(fullURL)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`back_class_${className}`)
          .setLabel(`⬅️ Back to ${className}`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("back_home")
          .setLabel("🏠 Back to All Trainers")
          .setStyle(ButtonStyle.Secondary)
      );

      return { embed, row };
    };

    // ==========================================================
    // 🖼️ Send initial page
    // ==========================================================
    const { embed, navRow, trainerRow } = renderHome(currentPage);
    const message = await interaction.editReply({
      embeds: [embed],
      components: [navRow, trainerRow]
    });

    // ==========================================================
    // 🎮 Collector
    // ==========================================================
    const collector = message.createMessageComponentCollector({
      time: 120000
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id)
        return i.reply({ content: "⚠️ You can’t control this menu.", ephemeral: true });

      if (i.customId === "prev" && currentPage > 0) currentPage--;
      else if (i.customId === "next" && currentPage < totalPages - 1) currentPage++;
      else if (i.customId === "close") {
        collector.stop();
        return i.update({ content: "Trainer list closed.", embeds: [], components: [] });
      }

      if (i.customId.startsWith("inspect_class_")) {
        const className = i.customId.replace("inspect_class_", "");
        const { embed, backRow, variantRow } = renderClass(className);
        return i.update({ embeds: [embed], components: [backRow, variantRow] });
      }

      if (i.customId.startsWith("inspect_variant_")) {
        const spriteFile = i.customId.replace("inspect_variant_", "");
        const variant = flatTrainers.find((x) => x.sprite === spriteFile);
        const className = variant?.name;
        const rendered = renderSprite(spriteFile, className);
        if (!rendered)
          return i.reply({ content: "❌ Sprite not found.", ephemeral: true });
        return i.update({ embeds: [rendered.embed], components: [rendered.row] });
      }

      if (i.customId.startsWith("back_class_")) {
        const className = i.customId.replace("back_class_", "");
        const { embed, backRow, variantRow } = renderClass(className);
        return i.update({ embeds: [embed], components: [backRow, variantRow] });
      }

      if (i.customId === "back_home") {
        const { embed, navRow, trainerRow } = renderHome(currentPage);
        return i.update({ embeds: [embed], components: [navRow, trainerRow] });
      }

      const { embed, navRow, trainerRow } = renderHome(currentPage);
      await i.update({ embeds: [embed], components: [navRow, trainerRow] });
    });

    collector.on("end", async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {}
    });
  }
};
