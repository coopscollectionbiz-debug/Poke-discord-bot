// ==========================================================
// 🏪 Coop's Collection Discord Bot — /shop (Admin Command)
// ==========================================================
// Features:
//  • Requires Administrator permission
//  • Grants Starter Pack (1 Common, 1 Uncommon, 1 Rare Pokémon + 1 Rare Trainer)
//  • Grants purchasable Evolution Stones
//  • Safe interaction handling (no Unknown/AlreadyReplied)
//  • Uses embedBuilders.js (same as /daily)
//  • Shiny Pokémon broadcast via broadcastReward()
// ==========================================================

import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
  PermissionFlagsBits,
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
    .setDescription("Admin: access the PokéMart to grant items or rewards.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      // ✅ Prevent Discord timeout
      await interaction.deferReply({ ephemeral: true });

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
        "🏪 Coop’s Collection PokéMart (Admin)",
        "Select an item to view details or confirm a grant."
      )
        .setThumbnail(POKEMART_IMG)
        .setFooter({
          text: `Balance: ${user.cc.toLocaleString()} ${COOPCOIN}`,
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

        const confirmEmbed = createSuccessEmbed(
          `${item.emoji} ${item.name}`,
          `**Cost:** ${item.cost === 0 ? "🆓 FREE" : `${item.cost} CC`}\n\n${item.description}\n\nConfirm your purchase below.`
        ).setThumbnail(item.sprite);

        const confirmRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`confirm_${item.id}_${userId}`)
            .setPlaceholder("✅ Confirm or ❌ Cancel")
            .addOptions([
              new StringSelectMenuOptionBuilder().setLabel("Confirm").setValue("confirm").setEmoji("✅"),
              new StringSelectMenuOptionBuilder().setLabel("Cancel").setValue("cancel").setEmoji("❌"),
            ])
        );

        await i.update({ embeds: [confirmEmbed], components: [confirmRow] });

        // ======================================================
        // Scoped Confirm Collector (per-user)
        // ======================================================
        const confirmCollector = reply.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          filter: (x) => x.user.id === userId && x.customId.startsWith("confirm_"),
          time: 30000,
          max: 1,
        });

        confirmCollector.on("collect", async (i2) => {
          const choice = i2.values[0];
          const [, itemId] = i2.customId.split("_").slice(0, 2);
          const confirmedItem = SHOP_ITEMS.find((x) => x.id === itemId);

          if (!confirmedItem)
            return i2.reply({ content: "❌ Invalid item reference.", ephemeral: true });

          if (choice === "cancel") {
            await i2.update({
              embeds: [createSuccessEmbed("❌ Cancelled", "No changes made.")],
              components: [],
            });
            return;
          }

          await i2.deferUpdate();

          // ====================================================
          // 🎁 Starter Pack Logic
          // ====================================================
          if (confirmedItem.id === "starter_pack") {
            user.purchases ??= [];
            if (user.purchases.includes("starter_pack"))
              return i2.followUp({ content: "⚠️ Already claimed.", ephemeral: true });

            const allPokemon = await getAllPokemon();
            const allTrainers = await getAllTrainers();

            const rewards = [
              selectRandomPokemonForUser(allPokemon, user, "common"),
              selectRandomPokemonForUser(allPokemon, user, "uncommon"),
              selectRandomPokemonForUser(allPokemon, user, "rare"),
            ];
            const rareTrainer = selectRandomTrainerForUser(allTrainers, user, "rare");

            const shinyPulled = [];
            const rewardEmbeds = [];
            const broadcastQueue = [];

            for (const reward of rewards) {
              const shiny = rollForShiny(user.tp || 0);
              user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };
              if (shiny) {
                user.pokemon[reward.id].shiny++;
                shinyPulled.push(reward);
              } else user.pokemon[reward.id].normal++;

              const spriteURL = shiny
                ? `${spritePaths.shiny}${reward.id}.gif`
                : `${spritePaths.pokemon}${reward.id}.gif`;
              rewardEmbeds.push(createPokemonRewardEmbed(reward, shiny, spriteURL));

              broadcastQueue.push({
                type: "pokemon",
                item: { id: reward.id, name: reward.name, rarity: reward.tier },
                shiny,
              });
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
              await saveDataToDiscord(trainerData);

              for (const b of broadcastQueue)
                await broadcastReward(client, {
                  user: i2.user,
                  type: b.type,
                  item: b.item,
                  shiny: b.shiny,
                  source: "Starter Pack",
                }).catch(() => {});

              const summary = `You received 3 Pokémon and 1 Rare Trainer!\n${
                shinyPulled.length ? `✨ ${shinyPulled.length} shiny Pokémon pulled!` : "No shinies this time!"
              }`;

              const successEmbed = createSuccessEmbed(`${STARTER_PACK} Starter Pack Claimed!`, summary);
              await i2.editReply({ embeds: [successEmbed, ...rewardEmbeds], components: [] });
            } catch (err) {
              console.error("❌ Starter Pack Error:", err);
              await i2.editReply({
                content: "⚠️ Error granting Starter Pack.",
                components: [],
                embeds: [],
              });
            }
            return;
          }

          // ====================================================
          // 🪨 Evolution Stone Logic
          // ====================================================
          if (confirmedItem.id === "evolution_stone") {
            if (user.cc < confirmedItem.cost) {
              await i2.followUp({
                content: `❌ Not enough CC. Need **${confirmedItem.cost}**, have **${user.cc}**.`,
                ephemeral: true,
              });
              return;
            }

            user.cc -= confirmedItem.cost;
            user.items ??= { evolution_stone: 0 };
            user.items.evolution_stone++;
            await saveTrainerDataLocal(trainerData);
            await saveDataToDiscord(trainerData);

            const successEmbed = createSuccessEmbed(
              `${EVO_STONE} Evolution Stone Purchased!`,
              `Spent **${confirmedItem.cost} CC**.\nNow have **${user.items.evolution_stone}** total.`
            ).setFooter({
              text: `Remaining balance: ${user.cc.toLocaleString()} CC`,
              iconURL: COOPCOIN_IMG,
            });

            await i2.editReply({ embeds: [successEmbed], components: [] });
          }
        });
      });

      collector.on("end", async () => {
        await reply.edit({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("❌ /shop failed:", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ Error: ${err.message}`,
          ephemeral: true,
        });
      } else {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
    }
  },
};
