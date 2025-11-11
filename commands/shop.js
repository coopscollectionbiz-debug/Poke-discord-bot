// ==========================================================
// 🏪 Coop's Collection Discord Bot — /shop (Final Production Build v3)
// ==========================================================
// Features:
//  • Local logic only (no API requests)
//  • Starter Pack grants 1 Common, 1 Uncommon, 1 Rare Pokémon + 1 Rare Trainer
//  • Uses embedBuilders.js (same as /daily)
//  • Shiny Pokémon broadcast via broadcastReward()
//  • Scoped collectors (no global listeners)
//  • Safe “commit-on-success” purchase handling
//  • Graceful handling for insufficient CC with auto-reset
// ==========================================================

import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { getAllPokemon, getAllTrainers } from "../utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
  selectRandomTrainerForUser,
} from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { spritePaths } from "../spriteconfig.js";
import {
  createSuccessEmbed,
  createPokemonRewardEmbed,
  createTrainerRewardEmbed,
} from "../utils/embedBuilders.js";

// ==========================================================
// 🪙 Emojis & Assets
// ==========================================================
const COOPCOIN = "<:coopcoin:1437892112959148093>";
const COOPCOIN_IMG = "https://cdn.discordapp.com/emojis/1437892112959148093.webp?size=96";
const EVO_STONE = "<:evolution_stone:1437892171381473551>";
const STARTER_PACK = "<:starter_pack:1437896364087443479>";
const POKEMART_IMG = "https://poke-discord-bot.onrender.com/public/sprites/items/Pokemart.png";

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
      const user = (trainerData[userId] ??= {
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
      )
        .setThumbnail(POKEMART_IMG)
        .setFooter({
          text: `Your current balance: ${user.cc.toLocaleString()} CC`,
          iconURL: COOPCOIN_IMG,
        });

      const options = SHOP_ITEMS.filter(
        (item) => !(item.onceOnly && user.purchases?.includes(item.id))
      ).map((item) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${item.name} — ${item.cost === 0 ? "FREE" : `${item.cost} CC`}`)
          .setValue(item.id)
          .setDescription(item.description.slice(0, 80))
          .setEmoji(item.emoji)
      );

      const menu = new StringSelectMenuBuilder()
        .setCustomId("shop_select")
        .setPlaceholder("🛍️ Select an item")
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);
      const reply = await safeReply(interaction, { embeds: [embed], components: [row] });

      // ======================================================
      // 🎯 Main Menu Collector
      // ======================================================
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "❌ This shop isn’t yours.", ephemeral: true });

        const item = SHOP_ITEMS.find((x) => x.id === i.values[0]);
        if (!item)
          return i.reply({ content: "❌ Invalid item.", ephemeral: true });

        if (item.onceOnly && user.purchases?.includes(item.id))
          return i.reply({ content: "⚠️ You’ve already claimed this item!", ephemeral: true });

        const confirmEmbed = createSuccessEmbed(
          `${item.emoji} ${item.name}`,
          `**Cost:** ${item.cost === 0 ? "🆓 FREE" : `${item.cost} CC`}\n\n${item.description}\n\nConfirm your purchase below.`
        ).setThumbnail(item.sprite);

        const confirmRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`confirm_${item.id}`)
            .setPlaceholder("✅ Confirm or ❌ Cancel")
            .addOptions([
              new StringSelectMenuOptionBuilder().setLabel("Confirm Purchase").setValue("confirm").setEmoji("✅"),
              new StringSelectMenuOptionBuilder().setLabel("Cancel").setValue("cancel").setEmoji("❌"),
            ])
        );

        await i.update({ embeds: [confirmEmbed], components: [confirmRow] });

        // ======================================================
        // 💾 Scoped Confirm Collector (no global listener)
        // ======================================================
        const confirmCollector = reply.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          filter: (x) => x.user.id === userId && x.customId.startsWith("confirm_"),
          time: 30000,
        });

        confirmCollector.on("collect", async (i) => {
          const choice = i.values[0];
          if (choice === "cancel") {
            await i.update({ content: "❌ Purchase cancelled.", embeds: [], components: [] });
            return;
          }

          // ====================================================
          // 🎁 Starter Pack (Safe Commit)
          // ====================================================
          if (item.id === "starter_pack") {
            user.purchases ??= [];
            if (user.purchases.includes("starter_pack"))
              return i.reply({ content: "⚠️ You’ve already claimed your Starter Pack!", ephemeral: true });

            const allPokemon = await getAllPokemon();
            const allTrainers = await getAllTrainers();

            const rewards = [
              selectRandomPokemonForUser(allPokemon, user, "common"),
              selectRandomPokemonForUser(allPokemon, user, "uncommon"),
              selectRandomPokemonForUser(allPokemon, user, "rare"),
            ];

            const rareTrainer = selectRandomTrainerForUser(allTrainers, user, "rare");
            user.trainers[rareTrainer.id] = true;

            const shinyPulled = [];
            const rewardEmbeds = [];

            for (const reward of rewards) {
              const shiny = rollForShiny(user.tp || 0);
              user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

              if (shiny) {
                user.pokemon[reward.id].shiny++;
                shinyPulled.push(reward);
              } else user.pokemon[reward.id].normal++;

              await broadcastReward(client, {
                user: i.user,
                type: "pokemon",
                item: { id: reward.id, name: reward.name, rarity: reward.tier },
                shiny,
                source: "Starter Pack",
              }).catch(() => {});

              const spriteURL = shiny
                ? `${spritePaths.shiny}${reward.id}.gif`
                : `${spritePaths.pokemon}${reward.id}.gif`;

              rewardEmbeds.push(createPokemonRewardEmbed(reward, shiny, spriteURL));
            }

            const trainerSprite = `${spritePaths.trainers}${rareTrainer.filename || rareTrainer.id}.png`;
            rewardEmbeds.push(createTrainerRewardEmbed(rareTrainer, trainerSprite));

            await broadcastReward(client, {
              user: i.user,
              type: "trainer",
              item: { id: rareTrainer.id, name: rareTrainer.name, rarity: rareTrainer.tier || "rare" },
              shiny: false,
              source: "Starter Pack",
            }).catch(() => {});

            const summaryText = `You received 3 Pokémon and 1 Rare Trainer!\n${
              shinyPulled.length > 0
                ? `✨ You pulled ${shinyPulled.length} shiny Pokémon!`
                : "No shinies this time... maybe next pack!"
            }`;
            const successEmbed = createSuccessEmbed(`${STARTER_PACK} Starter Pack Claimed!`, summaryText);

            try {
              await saveTrainerDataLocal(trainerData);
              await saveDataToDiscord(trainerData);

              await i.update({ embeds: [successEmbed, ...rewardEmbeds], components: [] });

              user.purchases.push("starter_pack");
              await saveTrainerDataLocal(trainerData);
              await saveDataToDiscord(trainerData);
            } catch (err) {
              console.error("❌ Failed to finalize Starter Pack:", err);
              return i.update({
                content:
                  "⚠️ Something went wrong granting your Starter Pack. Please try again later — your pack has not been consumed.",
                components: [],
                embeds: [],
              });
            }
            return;
          }

          // ====================================================
          // 🪨 Evolution Stone Purchase (Safe Error Handling)
          // ====================================================
          if (item.id === "evolution_stone") {
            if (user.cc < item.cost) {
              await i.reply({
                content: `❌ You don’t have enough Coop Coins! You need **${item.cost} CC**, but only have **${user.cc} CC**.`,
                ephemeral: true,
              });

              // Auto-reset confirm selector after 3 seconds
              setTimeout(async () => {
                await i.message.edit({ components: [] }).catch(() => {});
              }, 3000);
              return;
            }

            user.cc -= item.cost;
            user.items ??= { evolution_stone: 0 };
            user.items.evolution_stone++;
            await saveTrainerDataLocal(trainerData);
            await saveDataToDiscord(trainerData);

            const successEmbed = createSuccessEmbed(
              `${EVO_STONE} Evolution Stone Purchased!`,
              `You spent **${item.cost} CC** and received **1 ${item.name}**.\n\nYou now have **${user.items.evolution_stone}** Evolution Stones.`
            ).setFooter({
              text: `Remaining balance: ${user.cc.toLocaleString()} CC`,
              iconURL: COOPCOIN_IMG,
            });

            await i.update({ embeds: [successEmbed], components: [] });
          }
        });
      });
    } catch (err) {
      console.error("❌ /shop failed:", err);
      await safeReply(interaction, { content: `❌ Error: ${err.message}`, ephemeral: true });
    }
  },
};
