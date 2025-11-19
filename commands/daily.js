// ==========================================================
// 🕐 /daily – Daily Pokémon Reward (Pokémon Only)
// • No trainers are rewarded
// • Shiny odds applied normally
// • Epic+ broadcast supported
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from "discord.js";

import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { createPokemonRewardEmbed } from "../utils/embedBuilders.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { safeReply } from "../utils/safeReply.js";
import { saveTrainerDataLocal } from "../utils/saveQueue.js";

// User lock system (same as bot_final)
import { userLocks } from "../bot_final.js";

export default {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily Pokémon reward!")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction, trainerData) {
    try {
      const userId = interaction.user.id;
      const user = trainerData[userId];

      if (!user) {
        return safeReply(interaction, {
          content: "❌ You do not have a profile yet.",
          ephemeral: true
        });
      }

      // ================================
      // Cooldown Check
      // ================================
      const now = Date.now();
      const last = user.lastDaily ? new Date(user.lastDaily).getTime() : 0;
      const day = 24 * 60 * 60 * 1000;

      if (now - last < day) {
        const next = new Date(last + day).toLocaleString();
        return safeReply(interaction, {
          content: `⏳ You already claimed your daily reward!\nNext claim: **${next}**`,
          ephemeral: true
        });
      }

      // Apply cooldown immediately
      user.lastDaily = new Date().toISOString();

      // ================================
      // ATOMIC LOCK
      // ================================
      if (!userLocks.has(userId)) {
        userLocks.set(userId, Promise.resolve());
      }

      const lock = userLocks.get(userId);

      const task = async () => {
        // Load Pokémon pool
        const allPokemon = await getPokemonCached();

        // Pokémon-only roll
        const reward = selectRandomPokemonForUser(allPokemon, user, "pokeball");
        const shiny = rollForShiny(user.tp || 0);

        if (!reward) {
          return safeReply(interaction, {
            content: "❌ Could not generate a Pokémon.",
            ephemeral: true
          });
        }

        // Inventory update
        user.pokemon ??= {};
        user.pokemon[reward.id] ??= { normal: 0, shiny: 0 };

        if (shiny) user.pokemon[reward.id].shiny++;
        else user.pokemon[reward.id].normal++;

        // Save
        await saveTrainerDataLocal(trainerData);

        // Sprite path
        const spriteUrl = shiny
          ? `${spritePaths.shiny}${reward.id}.gif`
          : `${spritePaths.pokemon}${reward.id}.gif`;

        // Embed
        const embed = createPokemonRewardEmbed(reward, shiny, spriteUrl);

        // Respond to user
        await interaction.reply({
          content: `🎁 **Daily Reward!**`,
          embeds: [embed]
        });

        // Global broadcast
        try {
          await broadcastReward(interaction.client, {
            user: interaction.user,
            type: "pokemon",
            item: {
              id: reward.id,
              name: reward.name,
              rarity: reward.tier || "common",
              spriteFile: `${reward.id}.gif`
            },
            shiny,
            source: "daily"
          });
        } catch (err) {
          console.error("❌ broadcastReward failed (daily):", err.message);
        }

        console.log(`✅ Daily completed for ${interaction.user.username}`);
      };

      const newLock = lock.then(task).catch(err =>
        console.error("❌ Daily lock error:", err)
      );
      userLocks.set(userId, newLock);
      return newLock;

    } catch (err) {
      console.error("❌ /daily error stack:", err);
      return safeReply(interaction, {
        content: `❌ Error executing /daily: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
