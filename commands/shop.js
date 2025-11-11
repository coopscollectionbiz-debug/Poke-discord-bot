// ==========================================================
// 🏪 Coop's Collection Discord Bot — /shop (FINAL PRODUCTION VERSION)
// ==========================================================
// Features:
//  • Local logic only (no API requests)
//  • Starter Pack grants 1 Common, 1 Uncommon, 1 Rare Pokémon + 1 Rare Trainer
//  • Uses embedBuilders.js (same as /daily)
//  • Shiny Pokémon broadcast via broadcastReward()
// ==========================================================

import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
  selectRandomTrainerForUser,
} from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { rarityEmojis, spritePaths } from "../spriteconfig.js";
import {
  createSuccessEmbed,
  createPokemonRewardEmbed,
  createTrainerRewardEmbed,
} from "../utils/embedBuilders.js";

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
    sprite:
      "https://cdn.discordapp.com/emojis/1437892171381473551.webp?size=128",
    description: "Used to evolve certain Pokémon into stronger forms.",
    onceOnly: false,
  },
  {
    id: "starter_pack",
    name: "Starter Pack",
    cost: 0,
    emoji: STARTER_PACK,
    sprite:
      "https://cdn.discordapp.com/emojis/1437896364087443479.webp?size=128",
    description:
      "Receive 1 Common, 1 Uncommon, 1 Rare Pokémon, and 1 Rare Trainer (with shiny odds). Claimable only once per account!",
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
      const user =
        (trainerData[userId] ??= {
          id: userId,
          tp: 0,
          cc: 0,
          pokemon: {},
          trainers: {},
          items: { evolution_stone: 0 },
          purchases: [],
        });

      // ======================================================
      // 🏪 Initial Embed
      // ======================================================
      const embed = createSuccessEmbed(
        "🏪 Coop’s Collection PokéMart",
        "Welcome to the PokéMart!\nSelect an item below to view details or confirm your purchase."
      ).setFooter({
        text: `Your current balance: ${user.cc.toLocaleString()} ${COOPCOIN}`,
      });

      const options = SHOP_ITEMS.filter(
        (item) => !(item.onceOnly && user.purchases?.includes(item.id))
      ).map((item) => {
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
      const reply = await safeReply(interaction, {
        embeds: [embed],
        components: [row],
      });

      // ======================================================
      // 🎯 Selection Collector
      // ======================================================
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({
            content: "❌ This shop isn’t yours.",
            ephemeral: true,
          });

        const item = SHOP_ITEMS.find((x) => x.id === i.values[0]);
        if (!item)
          return i.reply({ content: "❌ Invalid item.", ephemeral: true });

        if (item.onceOnly && user.purchases?.includes(item.id)) {
          return i.reply({
            content: "⚠️ You’ve already claimed this item!",
            ephemeral: true,
          });
        }

        const confirmEmbed = createSuccessEmbed(
          `${item.emoji} ${item.name}`,
          `**Cost:** ${
            item.cost === 0 ? "🆓 FREE" : `${item.cost} ${COOPCOIN}`
          }\n\n${item.description}\n\nConfirm your purchase below.`
        ).setThumbnail(item.sprite);

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
          return i.update({
            content: "❌ Purchase cancelled.",
            components: [],
            embeds: [],
          });
        }

        // ======================================================
        // 🎁 Starter Pack (Pokémon + Rare Trainer)
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
          const { getAllTrainers } = await import("../utils/dataLoader.js");
          const allTrainers = await getAllTrainers();

          const rewards = [
            selectRandomPokemonForUser(allPokemon, user, "common"),
            selectRandomPokemonForUser(allPokemon, user, "uncommon"),
            selectRandomPokemonForUser(allPokemon, user, "rare"),
          ];

          // 🎓 Add one Rare Trainer
          const rareTrainer = selectRandomTrainerForUser(allTrainers, user, "rare");
          user.trainers[rareTrainer.id] = true;

          const shinyPulled = [];
          const rewardEmbeds = [];

          // 🧬 Pokémon rewards
          for (const reward of rewards) {
            const shiny = rollForShiny(user.tp || 0);
            user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

            if (shiny) {
              user.pokemon[reward.id].shiny++;
              shinyPulled.push(reward);

              // 🌟 Broadcast shiny Pokémon
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
            } else {
              user.pokemon[reward.id].normal++;
            }

            const spriteURL = shiny
              ? `${spritePaths.shiny}${reward.id}.gif`
              : `${spritePaths.pokemon}${reward.id}.gif`;

            rewardEmbeds.push(createPokemonRewardEmbed(reward, shiny, spriteURL));
          }

          // 🎓 Trainer embed
          const cleanTrainerFile = (
            rareTrainer.filename ||
            rareTrainer.spriteFile ||
            `${rareTrainer.id}.png`
          )
            .replace(/^trainers?_2\//, "")
            .replace(/\.png\.png$/i, ".png")
            .toLowerCase();
          const trainerSprite = `${spritePaths.trainers}${cleanTrainerFile}`;
          rewardEmbeds.push(createTrainerRewardEmbed(rareTrainer, trainerSprite));

          // ✅ Save purchase + data
          user.purchases.push("starter_pack");
          await saveTrainerDataLocal(trainerData);
          await saveDataToDiscord(trainerData);

          // 🎉 Success Embed
          const summaryText =
            `You received 3 Pokémon and 1 Rare Trainer!\n` +
            (shinyPulled.length > 0
              ? `✨ You pulled ${shinyPulled.length} shiny Pokémon!`
              : "No shinies this time... maybe next pack!");

          const successEmbed = createSuccessEmbed(
            `${STARTER_PACK} Starter Pack Claimed!`,
            summaryText
          );

          await i.update({
            embeds: [successEmbed, ...rewardEmbeds],
            components: [],
          });
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

          const successEmbed = createSuccessEmbed(
            `${EVO_STONE} Evolution Stone Purchased!`,
            `You spent **${item.cost} ${COOPCOIN}** and received **1 ${item.name}**.\n\nYou now have **${user.items.evolution_stone}** ${EVO_STONE}.`
          ).setFooter({
            text: `Remaining balance: ${user.cc.toLocaleString()} ${COOPCOIN}`,
          });

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
