// ==========================================================
// 🏪 Coop's Collection Discord Bot — /shop (Admin Command v6.9)
// ==========================================================
//  • Requires Administrator permission
//  • Button-based confirmation (no nested dropdowns)
//  • Full collector lifecycle management (no ghost clicks)
//  • Safe broadcast handling + closure after any outcome
//  • Starter Pack broadcasts bypass cooldown
// ==========================================================

import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";

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
// 🧩 Utility
// ==========================================================
async function safeInteractionReply(i, payload) {
  try {
    if (!i.deferred && !i.replied) await i.reply(payload);
    else await i.followUp(payload);
  } catch {
    try {
      await i.followUp(payload);
    } catch {}
  }
}

// ✅ Enhanced: closes message + stops all collectors
async function closeShopMessage(i, confirmCollector = null, mainCollector = null) {
  try {
    if (confirmCollector && !confirmCollector.ended) confirmCollector.stop("closed");
    if (mainCollector && !mainCollector.ended) mainCollector.stop("closed");
    if (i?.message) await i.message.edit({ components: [] }).catch(() => {});
  } catch (err) {
    console.log("⚠️ Failed to close shop:", err.message);
  }
}

async function terminateShop(i, confirmCollector, mainCollector) {
  await closeShopMessage(i, confirmCollector, mainCollector);
}

// Handles cost deduction and insufficient funds
async function handlePurchaseCost(i, user, item, saveLocal, confirmCollector, mainCollector) {
  if (item.cost > 0 && user.cc < item.cost) {
    await safeInteractionReply(i, {
      content: `❌ Not enough CC. Need **${item.cost}**, have **${user.cc}**.`,
      flags: MessageFlags.Ephemeral,
    });
    await closeShopMessage(i, confirmCollector, mainCollector);
    return false;
  }

  if (item.cost > 0) {
    user.cc -= item.cost;
    await saveLocal();
  }
  return true;
}

// ==========================================================
// 🪙 Assets
// ==========================================================
const COOPCOIN = "<:coopcoin:1437892112959148093>";
const COOPCOIN_IMG = "https://cdn.discordapp.com/emojis/1437892112959148093.webp?size=96";
const EVO_STONE = "<:evolution_stone:1437892171381473551>";
const STARTER_PACK = "<:starter_pack:1437896364087443479>";
const POKEMART_IMG = `${process.env.RENDER_EXTERNAL_URL || "https://poke-discord-bot.onrender.com"}/public/sprites/items/Pokemart.png`;

// ==========================================================
// 🛍️ Items
// ==========================================================
const SHOP_ITEMS = [
  {
    id: "evolution_stone",
    name: "Evolution Stone",
    cost: 3500,
    emoji: EVO_STONE,
    sprite: "https://cdn.discordapp.com/emojis/1437892171381473551.webp?size=128",
    description: "Used to evolve Pokémon. Multiple needed for rarer evolutions.",
    onceOnly: false,
  },
  {
    id: "starter_pack",
    name: "Starter Pack",
    cost: 0,
    emoji: STARTER_PACK,
    sprite: "https://cdn.discordapp.com/emojis/1437896364087443479.webp?size=128",
    description: "1 Common, 1 Uncommon, 1 Rare Pokémon & 1 Rare Trainer (1/account).",
    onceOnly: true,
  },
];

// ==========================================================
// 🎯 Slash Command
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Admin: grant or test item rewards via the PokéMart.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

      const embed = createSuccessEmbed(
        "🏪 Coop’s Collection PokéMart (Admin)",
        "Select an item to grant or test."
      )
        .setThumbnail(POKEMART_IMG)
        .setFooter({
          text: `Balance: ${user.cc.toLocaleString()} CC`,
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
      await interaction.editReply({ embeds: [embed], components: [row] });
      const reply = await interaction.fetchReply();

      // ======================================================
      // 🎯 Main Collector
      // ======================================================
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return safeInteractionReply(i, { content: "❌ This shop isn’t yours.", flags: MessageFlags.Ephemeral });

        const item = SHOP_ITEMS.find((x) => x.id === i.values[0]);
        if (!item)
          return safeInteractionReply(i, { content: "❌ Invalid item.", flags: MessageFlags.Ephemeral });

        // Build confirmation embed
        const confirmEmbed = createSuccessEmbed(
          `${item.emoji} ${item.name}`,
          `**Cost:** ${item.cost === 0 ? "🆓 FREE" : `${item.cost} CC`}\n\n${item.description}\n\nConfirm below.`
        ).setThumbnail(item.sprite);

        // ✅ Confirmation Buttons
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_${item.id}_${userId}`)
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Success)
            .setEmoji("✅"),
          new ButtonBuilder()
            .setCustomId(`cancel_${item.id}_${userId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("❌")
        );

        await i.update({ embeds: [confirmEmbed], components: [confirmRow] });

        // ======================================================
        // 🎯 Button Collector
        // ======================================================
        const confirmCollector = reply.createMessageComponentCollector({
          componentType: ComponentType.Button,
          filter: (btn) => btn.user.id === userId && btn.customId.endsWith(userId),
          time: 30000,
          max: 1,
        });

        confirmCollector.on("collect", async (btn) => {
          // robust parsing
          const withoutUser = btn.customId.replace(/_\d+$/, "");
          const firstUnderscore = withoutUser.indexOf("_");
          const action = withoutUser.slice(0, firstUnderscore);
          const itemId = withoutUser.slice(firstUnderscore + 1);

          const confirmedItem = SHOP_ITEMS.find((x) => x.id === itemId);
          if (!confirmedItem)
            return safeInteractionReply(btn, { content: "❌ Invalid item reference.", flags: MessageFlags.Ephemeral });

          // ❌ Cancel pressed
          if (action === "cancel") {
            await btn.update({
              embeds: [createSuccessEmbed("❌ Cancelled", "No changes made.")],
              components: [],
            });
            await closeShopMessage(btn, confirmCollector, collector);
            return;
          }

          // ====================================================
          // 🎁 Starter Pack
          // ====================================================
          if (confirmedItem.id === "starter_pack") {
            user.purchases ??= [];
            if (user.purchases.includes("starter_pack")) {
              await safeInteractionReply(btn, { content: "⚠️ Already claimed.", flags: MessageFlags.Ephemeral });
              await closeShopMessage(btn, confirmCollector, collector);
              return;
            }

            const allPokemon = await getAllPokemon();
            const allTrainers = await getAllTrainers();

            const pokemonByTier = (tier) => allPokemon.filter((p) => p.tier === tier);
            const pickPokemon = (tier) => {
              const pool = pokemonByTier(tier);
              return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
            };

            const rewards = [
              pickPokemon("common"),
              pickPokemon("uncommon"),
              pickPokemon("rare"),
            ].filter(Boolean);

            const rareTrainers = allTrainers.filter(
              (t) => (t.tier || "").toLowerCase() === "rare"
            );
            const rareTrainer = selectRandomTrainerForUser(
              rareTrainers.length > 0 ? rareTrainers : allTrainers,
              user
            );

            const shinyPulled = [];
            const rewardEmbeds = [];
            const broadcastQueue = [];

            for (const reward of rewards) {
              const shiny = rollForShiny(user.tp || 0);
              user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };
              if (shiny) user.pokemon[reward.id].shiny++;
              else user.pokemon[reward.id].normal++;

              const spriteURL = shiny
                ? `${spritePaths.shiny}${reward.id}.gif`
                : `${spritePaths.pokemon}${reward.id}.gif`;
              rewardEmbeds.push(createPokemonRewardEmbed(reward, shiny, spriteURL));

              broadcastQueue.push({
                type: "pokemon",
                item: { id: reward.id, name: reward.name, rarity: reward.tier },
                shiny,
              });
              if (shiny) shinyPulled.push(reward);
            }

            user.trainers[rareTrainer.id] = true;
            const trainerSprite = `${spritePaths.trainers}${rareTrainer.filename || rareTrainer.id}.png`;
            rewardEmbeds.push(createTrainerRewardEmbed(rareTrainer, trainerSprite));
            broadcastQueue.push({
              type: "trainer",
              item: { id: rareTrainer.id, name: rareTrainer.name, rarity: rareTrainer.tier || "rare" },
              shiny: false,
            });

            try {
              user.purchases.push("starter_pack");
              await saveTrainerDataLocal(trainerData);

              for (const b of broadcastQueue) {
                broadcastReward(client, {
                  user: btn.user,
                  type: b.type,
                  item: b.item,
                  shiny: b.shiny,
                  source: "Starter Pack",
                }).catch(() => {});
              }

              const summary = `You received 3 Pokémon and 1 Rare Trainer!\n${
                shinyPulled.length
                  ? `✨ ${shinyPulled.length} shiny Pokémon pulled!`
                  : "No shinies this time!"
              }`;

              const successEmbed = createSuccessEmbed(`${STARTER_PACK} Starter Pack Claimed!`, summary);
              await btn.message.edit({ embeds: [successEmbed, ...rewardEmbeds], components: [] });
              await closeShopMessage(btn, confirmCollector, collector);
              return;
            } catch (err) {
              console.error("❌ Starter Pack Error:", err);
              await btn.message.edit({
                content: "⚠️ Error granting Starter Pack.",
                components: [],
                embeds: [],
              });
              await closeShopMessage(btn, confirmCollector, collector);
            }
            return;
          }

          // ====================================================
          // 🪨 Evolution Stone
          // ====================================================
          if (confirmedItem.id === "evolution_stone") {
            const ok = await handlePurchaseCost(
              btn,
              user,
              confirmedItem,
              () => saveTrainerDataLocal(trainerData),
              confirmCollector,
              collector
            );
            if (!ok) return;

            user.items ??= { evolution_stone: 0 };
            user.items.evolution_stone++;
            await saveTrainerDataLocal(trainerData);

            const successEmbed = createSuccessEmbed(
              `${EVO_STONE} Evolution Stone Purchased!`,
              `Spent **${confirmedItem.cost} CC**.\nNow have **${user.items.evolution_stone}** total.`
            ).setFooter({
              text: `Remaining balance: ${user.cc.toLocaleString()} CC`,
              iconURL: COOPCOIN_IMG,
            });

            await btn.message.edit({ embeds: [successEmbed], components: [] });
            await closeShopMessage(btn, confirmCollector, collector);
          }
        });

        confirmCollector.on("end", async () => {
          await closeShopMessage(i, confirmCollector, collector);
        });
      });

      collector.on("end", async (_, reason) => {
        if (reason !== "closed") await reply.edit({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("❌ /shop failed:", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${err.message}`, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
    }
  },
};
