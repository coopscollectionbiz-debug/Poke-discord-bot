// ==========================================================
// 🏪 Coop's Collection Discord Bot — /shop (Final with Starter Pack Emoji + Shiny Logic)
// ==========================================================
// Features:
//  • Local logic only (no API requests)
//  • Starter Pack grants 1 Common, 1 Uncommon, 1 Rare Pokémon (with shiny odds)
//  • Evolution Stone costs Coop Coins
//  • Shiny Pokémon broadcast via broadcastReward()
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { rarityEmojis } from "../spriteconfig.js";

// ==========================================================
// 🪙 Emoji IDs
// ==========================================================
const COOPCOIN = "<:coopcoin:1437892112959148093>";
const EVO_STONE = "<:evolution_stone:1437892171381473551>";
const STARTER_PACK = "<:starter_pack:1437896364087443479>";

// ==========================================================
// 🧩 Shop Items
// ==========================================================
const SHOP_ITEMS = [
  {
    id: "evolution_stone",
    name: "Evolution Stone",
    cost: 3500,
    emoji: EVO_STONE,
    sprite: "https://cdn.discordapp.com/emojis/1437892171381473551.webp?size=128",
    description: "Used to evolve certain Pokémon into stronger forms.",
    onceOnly: false,
  },
  {
    id: "starter_pack",
    name: "Starter Pack",
    cost: 0,
    emoji: STARTER_PACK,
    sprite: "https://cdn.discordapp.com/emojis/1437896364087443479.webp?size=128",
    description:
      "Receive 1 Common, 1 Uncommon, and 1 Rare Pokémon (with shiny odds). Claimable only once per account!",
    onceOnly: true,
  },
];

// ==========================================================
// 🎯 Slash Command
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse the PokéMart and purchase items!"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      const userId = interaction.user.id;
      const user = trainerData[userId] ??= {
        id: userId,
        tp: 0,
        cc: 0,
        pokemon: {},
        trainers: {},
        items: { evolution_stone: 0 },
        purchases: [],
      };

      // ======================================================
      // 🏪 Initial Embed
      // ======================================================
      const embed = new EmbedBuilder()
        .setColor("#00ff9d")
        .setTitle("🏪 Coop’s Collection PokéMart")
        .setDescription(
          "Welcome to the PokéMart!\nSelect an item below to view details or confirm your purchase."
        )
        .setThumbnail("/public/sprites/items/Pokemart.png")
        .setFooter({
  text: `Your current balance: ${user.cc.toLocaleString()} ${COOPCOIN}`,
});


      // NEW:
const options = SHOP_ITEMS
  .filter(item => !(item.onceOnly && user.purchases?.includes(item.id))) // ⬅ hide claimed one-time items
  .map((item) => {
    const label = `${item.name} — ${
      item.cost === 0 ? "FREE" : `${item.cost} ${COOPCOIN}`
    }`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(item.id)
      .setDescription(item.description.slice(0, 80))
      .setEmoji(item.emoji);
  });


      const menu = new StringSelectMenuBuilder()
        .setCustomId("shop_select")
        .setPlaceholder("🛍️ Select an item")
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);
      const reply = await safeReply(interaction, { embeds: [embed], components: [row] });

      // ======================================================
      // 🎯 Selection Collector
      // ======================================================
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "❌ This shop isn’t yours.", ephemeral: true });

        const item = SHOP_ITEMS.find((x) => x.id === i.values[0]);
        if (!item) return i.reply({ content: "❌ Invalid item.", ephemeral: true });

        if (item.onceOnly && user.purchases?.includes(item.id)) {
          return i.reply({
            content: "⚠️ You’ve already claimed this item!",
            ephemeral: true,
          });
        }

        const confirmEmbed = new EmbedBuilder()
          .setColor("#00ff9d")
          .setTitle(`${item.emoji} ${item.name}`)
          .setThumbnail(item.sprite)
          .setDescription(
            `**Cost:** ${
              item.cost === 0 ? "🆓 FREE" : `${item.cost} ${COOPCOIN}`
            }\n\n${item.description}\n\nConfirm your purchase below.`
          );

        const confirmRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`confirm_${item.id}`)
            .setPlaceholder("✅ Confirm or ❌ Cancel")
            .addOptions([
              new StringSelectMenuOptionBuilder()
                .setLabel("Confirm Purchase")
                .setValue("confirm")
                .setEmoji("✅"),
              new StringSelectMenuOptionBuilder()
                .setLabel("Cancel")
                .setValue("cancel")
                .setEmoji("❌"),
            ])
        );

        await i.update({ embeds: [confirmEmbed], components: [confirmRow] });
      });

      collector.on("end", async () => {
        await interaction.editReply({
          components: [],
          content: "🕒 Shop session expired. Use `/shop` again to reopen.",
        });
      });

      // ======================================================
      // 💾 Confirm Collector (local logic)
      // ======================================================
      client.on("interactionCreate", async (i) => {
        if (!i.isStringSelectMenu()) return;
        if (!i.customId.startsWith("confirm_")) return;
        if (i.user.id !== userId) return;

        const itemId = i.customId.replace("confirm_", "");
        const item = SHOP_ITEMS.find((x) => x.id === itemId);
        const choice = i.values[0];
        if (!item) return;

        if (choice === "cancel") {
          return i.update({ content: "❌ Purchase cancelled.", components: [], embeds: [] });
        }

        // ======================================================
        // 🎁 Starter Pack (with shiny logic)
        // ======================================================
        if (item.id === "starter_pack") {
          user.purchases ??= [];
          if (user.purchases.includes("starter_pack")) {
            return i.update({
              content: "⚠️ You’ve already claimed your Starter Pack!",
              components: [],
            });
          }

          const allPokemon = await getAllPokemon();
          const rewards = [
            selectRandomPokemonForUser(allPokemon, user, "common"),
            selectRandomPokemonForUser(allPokemon, user, "uncommon"),
            selectRandomPokemonForUser(allPokemon, user, "rare"),
          ];

          let shinyPulled = [];
          let lines = [];
          let spritesHTML = [];

          for (const reward of rewards) {
            const shiny = rollForShiny(user.tp || 0);
            user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

            const spriteURL = shiny
              ? `/public/sprites/pokemon/shiny/${reward.id}.gif`
              : `/public/sprites/pokemon/normal/${reward.id}.gif`;
            spritesHTML.push(
              `[${shiny ? "✨" : ""}${reward.name}](${spriteURL})`
            );

            if (shiny) {
              user.pokemon[reward.id].shiny++;
              shinyPulled.push(reward);
              lines.push(`✨ **${reward.name}** (${reward.tier})`);
            } else {
              user.pokemon[reward.id].normal++;
              lines.push(`${rarityEmojis[reward.tier]} **${reward.name}**`);
            }

            // Broadcast shiny immediately
            if (shiny) {
              await broadcastReward(client, {
                user: i.user,
                type: "pokemon",
                item: {
                  id: reward.id,
                  name: reward.name,
                  rarity: reward.tier,
                },
                shiny: true,
                source: "Starter Pack",
              }).catch(() => {});
            }
          }

          user.purchases.push("starter_pack");
          await saveTrainerDataLocal(trainerData);
          await saveDataToDiscord(trainerData);

          const successEmbed = new EmbedBuilder()
            .setColor("#00ff9d")
            .setTitle(`${STARTER_PACK} Starter Pack Claimed!`)
            .setDescription(
              `You received:\n${lines.join("\n")}\n\nEnjoy your adventure!`
            )
            .setThumbnail(item.sprite)
            .setFooter({
              text:
                shinyPulled.length > 0
                  ? `✨ You pulled ${shinyPulled.length} shiny Pokémon!`
                  : "No shinies this time... maybe next pack!",
            });

          await i.update({ embeds: [successEmbed], components: [] });
          return;
        }

        // ======================================================
        // 🪨 Evolution Stone Purchase
        // ======================================================
        if (item.id === "evolution_stone") {
          if (user.cc < item.cost) {
            return i.update({
              content: `❌ Not enough Coop Coins! You need ${item.cost} ${COOPCOIN}.`,
              components: [],
            });
          }

          user.cc -= item.cost;
          user.items ??= { evolution_stone: 0 };
          user.items.evolution_stone++;
          await saveTrainerDataLocal(trainerData);
          await saveDataToDiscord(trainerData);

          const successEmbed = new EmbedBuilder()
            .setColor("#00ff9d")
            .setTitle(`${EVO_STONE} Evolution Stone Purchased!`)
            .setDescription(
              `You spent **${item.cost} ${COOPCOIN}** and received **1 ${item.name}**.\n\nYou now have **${user.items.evolution_stone}** ${EVO_STONE}.`
            )
            .setThumbnail(item.sprite)
            .setFooter({ text: `Remaining balance: ${user.cc} ${COOPCOIN}` });

          await i.update({ embeds: [successEmbed], components: [] });
          return;
        }
      });
    } catch (err) {
      console.error("❌ /shop failed:", err);
      await safeReply(interaction, {
        content: `❌ Error: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
