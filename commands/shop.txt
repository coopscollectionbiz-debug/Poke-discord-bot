// ==========================================================
// 🛍 /shop — Buy Evolution Stones
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from "discord.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { safeReply } from "../utils/safeReply.js";

export default {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse Coop’s Shop to buy evolution items!"),

  async execute(interaction, trainerData, saveTrainerDataLocal) {
    const userId = interaction.user.id;

    // ✅ ensure full schema user
    const user = await ensureUserInitialized(
      userId,
      interaction.user.username,
      trainerData,
      interaction.client
    );

    // ✅ guarantee items container
    user.items ??= { evolution_stone: 0 };
    const coins = user.cc ?? 0;

    const embed = new EmbedBuilder()
      .setTitle("🛒 Coop’s Shop")
      .setColor(0xffcc00)
      .setDescription(
        `You have **${coins.toLocaleString()} CC**.\nSelect an item to purchase:`
      );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("shop-select")
      .setPlaceholder("Select an item…")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Evolution Stone 🪨")
          .setDescription("Used to evolve your Pokémon.")
          .setValue("evolution_stone")
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const msg = await safeReply(interaction, { embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 60000 });

    collector.on("collect", async (i) => {
      if (i.customId !== "shop-select" || i.user.id !== userId) return;
      const item = i.values[0];
      const cost = 500;

      if (user.cc < cost)
        return i.reply({ content: "❌ Not enough Coop Coins!", ephemeral: true });

      // 🪨 deduct + grant
      user.cc -= cost;
      user.items[item] = (user.items[item] || 0) + 1;

      await saveTrainerDataLocal(trainerData);

      const success = new EmbedBuilder()
        .setTitle("✅ Purchase Complete")
        .setColor(0x55ff55)
        .setDescription(
          `You bought **1 Evolution Stone 🪨** for **500 CC**.\n\n` +
            `Remaining balance: **${user.cc.toLocaleString()} CC**\n` +
            `You now own **${user.items.evolution_stone} 🪨**.`
        );

      await i.update({ embeds: [success], components: [] });
    });

    collector.on("end", async () => {
      try {
        await msg.edit({ components: [] }).catch(() => {});
      } catch {}
    });
  },
};
