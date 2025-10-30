// ==========================================================
// 🧩 /showtrainers — Displays owned Trainer sprites with rarity filter
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import trainerSprites from "../trainerSprites.json" with { type: "json" };

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const normalizeRarity = r =>
  RARITY_ORDER.includes(String(r).toLowerCase()) ? String(r).toLowerCase() : "common";

function paginate(arr, per = 12) {
  const pages = [];
  for (let i = 0; i < arr.length; i += per) pages.push(arr.slice(i, i + per));
  return pages.length ? pages : [[]];
}

function buildEmbed(ownedList, page, rarity) {
  const pages = paginate(ownedList, 12);
  const current = pages[page] ?? [];
  const total = pages.length;

  const embed = new EmbedBuilder()
    .setTitle("Your Trainer Sprites")
    .setDescription(`Filter → **Rarity:** ${rarity || "all"}\nPage ${page + 1}/${total}`)
    .setColor("#81C784");

  if (!current.length) {
    embed.addFields([{ name: "Empty", value: "No trainers match your filter." }]);
  } else {
    for (const t of current) {
      const data = trainerSprites[t.filename] || {};
      embed.addFields([
        {
          name: data.name || t.filename,
          value: `Rarity: ${normalizeRarity(data.rarity)}\nCount: ${t.count}`,
          inline: true,
        },
      ]);
    }
  }
  return embed;
}

export default {
  data: new SlashCommandBuilder()
    .setName("showtrainers")
    .setDescription("View your owned Trainer sprites.")
    .addStringOption(opt =>
      opt
        .setName("rarity")
        .setDescription("Filter by rarity")
        .addChoices(...RARITY_ORDER.map(r => ({ name: r, value: r })))
    ),

  async execute(interaction, trainerData) {
    try {
      const user = trainerData[interaction.user.id];
      if (!user || !user.trainers || !Object.keys(user.trainers).length) {
        return await interaction.reply({
          content: "❌ You don't own any trainer sprites yet.",
          flags: 64,
        });
      }

      const rarity = normalizeRarity(interaction.options.getString("rarity"));
      const owned = [];

      // Stored structure: { "lass-gen4.png": count }
      for (const [filename, count] of Object.entries(user.trainers)) {
        const meta = trainerSprites[filename];
        if (!meta) continue;
        if (rarity && RARITY_ORDER.includes(rarity)) {
          if (normalizeRarity(meta.rarity) !== rarity) continue;
        }
        owned.push({ filename, count });
      }

      owned.sort((a, b) => {
        const r1 = RARITY_ORDER.indexOf(normalizeRarity(trainerSprites[a.filename]?.rarity));
        const r2 = RARITY_ORDER.indexOf(normalizeRarity(trainerSprites[b.filename]?.rarity));
        return r1 === r2 ? a.filename.localeCompare(b.filename) : r1 - r2;
      });

      let page = 0;
      const embed = buildEmbed(owned, page, rarity);
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
        const max = paginate(owned).length;
        if (i.customId === "next") page = (page + 1) % max;
        if (i.customId === "prev") page = (page - 1 + max) % max;
        await i.update({ embeds: [buildEmbed(owned, page, rarity)], components: [row] });
      });

      collector.on("end", async () => {
        const disabled = row.components.map(b => b.setDisabled(true));
        await interaction.editReply({
          embeds: [buildEmbed(owned, page, rarity)],
          components: [new ActionRowBuilder().addComponents(...disabled)],
        });
      });
    } catch (e) {
      console.error("❌ Error in /showtrainers:", e);
      if (!interaction.replied)
        await interaction.reply({ content: "Error showing trainers.", flags: 64 });
    }
  },
};
