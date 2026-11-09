// ==========================================================
// 🏪 Coop's Collection Discord Bot — /shop (Admin Command v6.9)
// ==========================================================
//  • Requires Administrator permission
//  • Button-based confirmation (no nested dropdowns)
//  • Full collector lifecycle management (no ghost clicks)
//  • Safe broadcast handling + closure after any outcome
//  • Starter Pack broadcasts bypass cooldown
// ==========================================================

import { pokemonSpriteUrl } from "../utils/sprites.js";
import { grantItem } from "../services/inventory.js";
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

import { getAllPokemon, getAcquirablePokemon, getFlattenedTrainers } from "../utils/dataLoader.js";
import { lockUser } from "../utils/userLocks.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";
import { grantTrainer } from "../services/assets.js";
import { trackProgress } from "../progression/achievements.js";
import { getTrainerKey } from "../utils/trainerFileHandler.js";
import {
  selectRandomPokemonForUser,
  selectRandomTrainerForUser,
} from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { grantCatch } from "../utils/training.js";
import { offerMoveChoices } from "../utils/moveChoice.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { spritePaths } from "../spriteconfig.js";
import { publicBaseUrl } from "../utils/publicUrl.js";
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


// ==========================================================
// 🪙 Assets
// ==========================================================
const COOPCOIN = "<:coopcoin:1437892112959148093>";
const COOPCOIN_IMG = "https://cdn.discordapp.com/emojis/1437892112959148093.webp?size=96";
const EVO_STONE = "<:evolution_stone:1437892171381473551>";
const STARTER_PACK = "<:starter_pack:1437896364087443479>";
const POKEMART_IMG = `${publicBaseUrl()}/public/sprites/items/Pokemart.png`;

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

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const userId = interaction.user.id;
      // Same record shape as every other path (never a hand-built object).
      const user = await lockUser(userId, () =>
        ensureUserInitialized(userId, interaction.user.username, trainerData, client)
      );

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
            // Catalog look-ups (awaits) first; everything else inside the lock.
            const allPokemon = await getAcquirablePokemon(); // live generations only
            const allTrainers = await getFlattenedTrainers();

            await lockUser(userId, async () => {
              const live = trainerData[userId];
              live.purchases ??= [];
              if (live.purchases.includes("starter_pack")) {
                await safeInteractionReply(btn, { content: "⚠️ Already claimed.", flags: MessageFlags.Ephemeral });
                await closeShopMessage(btn, confirmCollector, collector);
                return;
              }

              const pickPokemon = (tier) => {
                const pool = allPokemon.filter((p) => p.tier === tier);
                return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
              };
              const rewards = [pickPokemon("common"), pickPokemon("uncommon"), pickPokemon("rare")].filter(Boolean);

              const rareTrainers = allTrainers.filter((t) => (t.tier || "").toLowerCase() === "rare");
              const rareTrainer = selectRandomTrainerForUser(rareTrainers.length > 0 ? rareTrainers : allTrainers, live);
              const trainerKey = getTrainerKey(rareTrainer);

              // ---- one synchronous block: grant everything + mark claimed ----
              const shinyPulled = [];
              const rewardEmbeds = [];
              const broadcastQueue = [];
              const lessons = [];
              for (const reward of rewards) {
                const shiny = rollForShiny(live.tp || 0);
                lessons.push(grantCatch(live, reward.id, shiny ? "shiny" : "normal").lesson);
                const spriteURL = pokemonSpriteUrl(reward.id, shiny);
                rewardEmbeds.push(createPokemonRewardEmbed(reward, shiny, spriteURL));
                broadcastQueue.push({ type: "pokemon", item: { id: reward.id, name: reward.name, rarity: reward.tier }, shiny });
                if (shiny) shinyPulled.push(reward);
              }
              if (trainerKey) {
                grantTrainer(live, trainerKey);
                rewardEmbeds.push(createTrainerRewardEmbed(rareTrainer, `${spritePaths.trainers}${trainerKey}`));
                broadcastQueue.push({ type: "trainer", item: { id: rareTrainer.id, name: rareTrainer.name, rarity: rareTrainer.tier || "rare" }, shiny: false });
              }
              live.purchases.push("starter_pack");
              trackProgress(live, [{ type: "pokemon" }, { type: "shiny", n: shinyPulled.length }, { type: "trainers" }]); // achievements

              const ack = await saveAndAck(trainerData);

              try {
                for (const b of broadcastQueue) {
                  broadcastReward(client, { user: btn.user, type: b.type, item: b.item, shiny: b.shiny, source: "Starter Pack" }).catch(() => {});
                }
                const summary = withSaveNote(
                  `You received ${rewards.length} Pokémon and ${trainerKey ? "1 Rare Trainer" : "no trainer"}!
${
                    shinyPulled.length ? `✨ ${shinyPulled.length} shiny Pokémon pulled!` : "No shinies this time!"
                  }`,
                  ack
                );
                const successEmbed = createSuccessEmbed(`${STARTER_PACK} Starter Pack Claimed!`, summary);
                await btn.message.edit({ embeds: [successEmbed, ...rewardEmbeds], components: [] });
              } catch (err) {
                console.error("❌ Starter Pack reply error:", err);
              }
              await closeShopMessage(btn, confirmCollector, collector);
              // A duplicate's EXP can teach a move: ask which one to forget.
              // (bot_final.js acknowledges confirm_ buttons, so this can follow up.)
              await offerMoveChoices(btn, { trainerData, userId, lessons });
            });
            return;
          }

          // ====================================================
          // 🪨 Evolution Stone: charge + grant in one block, then save
          // ====================================================
          if (confirmedItem.id === "evolution_stone") {
            await lockUser(userId, async () => {
              const live = trainerData[userId];
              if (confirmedItem.cost > 0 && !(live.cc >= confirmedItem.cost)) {
                await safeInteractionReply(btn, {
                  content: `❌ Not enough CC. Need **${confirmedItem.cost}**, have **${live.cc}**.`,
                  flags: MessageFlags.Ephemeral,
                });
                await closeShopMessage(btn, confirmCollector, collector);
                return;
              }
              const granted = grantItem(live, "evolution_stone", 1);
              if (!granted.ok) {
                await safeInteractionReply(btn, { content: `❌ ${granted.error}`, flags: MessageFlags.Ephemeral });
                await closeShopMessage(btn, confirmCollector, collector);
                return;
              }
              live.cc -= confirmedItem.cost;

              const ack = await saveAndAck(trainerData);

              const successEmbed = createSuccessEmbed(
                `${EVO_STONE} Evolution Stone Purchased!`,
                withSaveNote(`Spent **${confirmedItem.cost} CC**.
Now have **${live.items.evolution_stone}** total.`, ack)
              ).setFooter({
                text: `Remaining balance: ${live.cc.toLocaleString()} CC`,
                iconURL: COOPCOIN_IMG,
              });

              await btn.message.edit({ embeds: [successEmbed], components: [] });
              await closeShopMessage(btn, confirmCollector, collector);
            });
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
