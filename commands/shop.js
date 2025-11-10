// ===========================================================
// 🛒 /shop — Coop’s Collection Store (Sprite-Based Items)
// ===========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} from "discord.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

// ===========================================================
// 🧾 Catalog — uses sprite instead of emoji
// ===========================================================
const SHOP_ITEMS = [
  {
    id: "evolution_stone",
    name: "Evolution Stone",
    cost: 500,
    desc: "Used to evolve certain Pokémon into stronger forms.",
    sprite: "/public/sprites/items/evolution_stone.png",
    key: "evolution_stone",
  },
];

// ===========================================================
// 🏪 Command
// ===========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("View the Coop’s Collection Shop"),

  async execute(interaction, trainerData, saveTrainerDataLocal) {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const user = await ensureUserInitialized(trainerData, userId);
    const userCC = user.cc ?? 0;

    // Base URL for sprites (adjust for local vs Render)
    const baseUrl = process.env.RENDER_EXTERNAL_URL || "https://yourapp.onrender.com";

    // =======================================================
    // 🏷️ Shop Overview
    // =======================================================
    const shopEmbed = new EmbedBuilder()
      .setTitle("🛒 Coop’s Collection Shop")
      .setColor(0x00ff9d)
      .setDescription(
        SHOP_ITEMS.map(
          (item) =>
            `**[${item.name}](${baseUrl}${item.sprite})** — ${item.cost.toLocaleString()} CC\n*${item.desc}*`
        ).join("\n\n")
      )
      .setFooter({ text: `Your balance: ${userCC.toLocaleString()} CC` });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("shop-select")
      .setPlaceholder("Select an item to buy")
      .addOptions(
        SHOP_ITEMS.map((item) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${item.name}`)
            .setDescription(`${item.cost.toLocaleString()} CC — ${item.desc}`)
            .setValue(item.id)
        )
      );

    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.editReply({ embeds: [shopEmbed], components: [row] });

    // =======================================================
    // 🧩 Item Selection Collector
    // =======================================================
    const collector = interaction.channel.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 60000,
      filter: (i) => i.user.id === userId,
    });

    collector.on("collect", async (i) => {
      if (i.customId !== "shop-select") return;

      const selected = SHOP_ITEMS.find((x) => x.id === i.values[0]);
      if (!selected) return;

      // Confirmation Embed
      const confirmEmbed = new EmbedBuilder()
        .setTitle("🛍️ Confirm Purchase")
        .setColor(0xffcc00)
        .setDescription(
          `Buy **1 ${selected.name}** for **${selected.cost.toLocaleString()} CC**?\n\n` +
          `You currently have **${userCC.toLocaleString()} CC.**`
        )
        .setThumbnail(`${baseUrl}${selected.sprite}`);

      const confirmMenu = new StringSelectMenuBuilder()
        .setCustomId("shop-confirm")
        .setPlaceholder("Confirm or cancel your purchase")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("✅ Confirm Purchase")
            .setDescription(`Spend ${selected.cost} CC`)
            .setValue(`confirm:${selected.id}`),
          new StringSelectMenuOptionBuilder()
            .setLabel("❌ Cancel")
            .setDescription("Cancel this purchase")
            .setValue("cancel")
        );

      const confirmRow = new ActionRowBuilder().addComponents(confirmMenu);
      await i.update({ embeds: [confirmEmbed], components: [confirmRow] });
    });

    // =======================================================
    // 💰 Confirmation Collector
    // =======================================================
    collector.on("collect", async (i) => {
      if (i.customId !== "shop-confirm") return;

      const [action, id] = i.values[0].split(":");
      if (action === "cancel") {
        await i.update({
          content: "❌ Purchase cancelled.",
          embeds: [],
          components: [],
        });
        return;
      }

      const selected = SHOP_ITEMS.find((x) => x.id === id);
      if (!selected) return;

      const cost = selected.cost;
      if (user.cc < cost) {
        await i.reply({ content: "❌ You don't have enough CC!", ephemeral: true });
        return;
      }

      // Transaction
      user.cc -= cost;
      user.items[selected.key] = (user.items[selected.key] ?? 0) + 1;
      await saveTrainerDataLocal(trainerData);

      // Success Embed
      const successEmbed = new EmbedBuilder()
        .setTitle("✅ Purchase Complete")
        .setColor(0x55ff55)
        .setDescription(
          `You bought **1 ${selected.name}** for **${cost.toLocaleString()} CC.**\n\n` +
          `💰 Remaining balance: **${user.cc.toLocaleString()} CC**\n` +
          `🎒 Inventory: **${user.items[selected.key]} Evolution Stone(s)**`
        )
        .setThumbnail(`${baseUrl}${selected.sprite}`);

      await i.update({ embeds: [successEmbed], components: [] });
    });

    collector.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
