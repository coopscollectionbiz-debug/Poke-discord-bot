// ==========================================================
// 🗓️ Coop's Collection — /daily (Final v13, Safe + Correct)
// ==========================================================
// Rewards:
//   • TWO Pokémon (rank-buffed)
//   • +500 CC
//   • +100 TP
//   • 10% Evolution Stone chance
//   • Three embeds with sprites
//   • Schema-safe + URL-safe
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { enqueueSave } from "../utils/saveQueue.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { spritePaths } from "../spriteconfig.js";

// DAILY CONSTANTS
const DAILY_CC = 500;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.10;
const COOLDOWN_MS = 86400000; // 24 hours


export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (2 Pokémon + CC + TP)");


// ==========================================================
// 🧩 EXECUTE DAILY
// ==========================================================
export async function execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
  try {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const userId = interaction.user.id;

    // ======================================================
    // ENSURE USER EXISTS (Normalized schema)
    // ======================================================
    trainerData[userId] ??= {};
    trainerData[userId] = normalizeUserSchema(userId, trainerData[userId]);
    const user = trainerData[userId];

    // ======================================================
    // COOLDOWN CHECK
    // ======================================================
    const now = Date.now();

    if (user.lastDaily && now - user.lastDaily < COOLDOWN_MS) {
      const remaining = COOLDOWN_MS - (now - user.lastDaily);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);

      return safeReply(interaction, {
        content: `⏳ You've already claimed your daily!\nCome back in **${hours}h ${minutes}m**.`,
        ephemeral: true
      });
    }

    // ======================================================
    // LOAD POKEMON POOL
    // ======================================================
    const allPokemon = await getAllPokemon();
    if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
      return safeReply(interaction, {
        content: "❌ Daily reward failed — Pokémon data unavailable.",
        ephemeral: true
      });
    }

    // ======================================================
    // TWO RANK-BUFFED ROLLS
    // ======================================================
    const pick1 = selectRandomPokemonForUser(allPokemon, user, "pokeball");
    const pick2 = selectRandomPokemonForUser(allPokemon, user, "pokeball");

    if (!pick1 || !pick2) {
      return safeReply(interaction, {
        content: "❌ Daily failed — Unable to select Pokémon.",
        ephemeral: true
      });
    }

    // Shiny results
    const shiny1 = rollForShiny(user.tp);
    const shiny2 = rollForShiny(user.tp);

    // Correct sprite URLs
    const sprite1 = shiny1
      ? `${spritePaths.shiny}${pick1.id}.gif`
      : `${spritePaths.pokemon}${pick1.id}.gif`;

    const sprite2 = shiny2
      ? `${spritePaths.shiny}${pick2.id}.gif`
      : `${spritePaths.pokemon}${pick2.id}.gif`;

    // ======================================================
    // SAVE TO USER INVENTORY
    // ======================================================
    function addPokemon(p, shiny) {
      user.pokemon[p.id] ??= { normal: 0, shiny: 0 };
      if (shiny) user.pokemon[p.id].shiny++;
      else user.pokemon[p.id].normal++;
    }

    addPokemon(pick1, shiny1);
    addPokemon(pick2, shiny2);

    // ======================================================
    // BROADCAST RARE+ OR SHINY
    // ======================================================
    async function maybeBroadcast(pick, shiny) {
      const rarity = (pick.tier || pick.rarity || "common").toLowerCase();
      if (shiny || ["rare", "epic", "legendary", "mythic"].includes(rarity)) {
        await broadcastReward(client, {
          user: interaction.user,
          type: "pokemon",
          item: pick,
          shiny,
          source: "daily"
        }).catch(() => {});
      }
    }

    await maybeBroadcast(pick1, shiny1);
    await maybeBroadcast(pick2, shiny2);

    // ======================================================
    // CURRENCY / STONE
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    let stoneAwarded = false;
    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.items.evolution_stone++;
      stoneAwarded = true;
    }

    user.lastDaily = now;

    // ======================================================
    // SAVE (queued)
    // ======================================================
    await enqueueSave(trainerData);

    // ======================================================
    // EMBEDS — Pokémon 1, Pokémon 2, Summary
    // ======================================================
    const embed1 = new EmbedBuilder()
      .setTitle(`🎁 Daily Pokémon #1 ${shiny1 ? "✨" : ""}`)
      .setColor("#5bc0de")
      .setDescription(
        `**${pick1.name}**\n` +
        `Rarity: **${(pick1.tier || pick1.rarity || "common").toUpperCase()}**`
      )
      .setImage(sprite1);

    const embed2 = new EmbedBuilder()
      .setTitle(`🎁 Daily Pokémon #2 ${shiny2 ? "✨" : ""}`)
      .setColor("#5bc0de")
      .setDescription(
        `**${pick2.name}**\n` +
        `Rarity: **${(pick2.tier || pick2.rarity || "common").toUpperCase()}**`
      )
      .setImage(sprite2);

    const rewardEmbed = new EmbedBuilder()
      .setTitle("🗓️ Daily Rewards")
      .setColor("#28a745")
      .addFields(
        { name: "💰 CC", value: `+${DAILY_CC}`, inline: true },
        { name: "⭐ TP", value: `+${DAILY_TP}`, inline: true },
        { name: "📊 New Balance", value: `${user.cc} CC | ${user.tp} TP`, inline: false }
      );

    if (stoneAwarded) {
      rewardEmbed.addFields({
        name: "💎 Evolution Stone",
        value: "You received **1x Evolution Stone**!"
      });
      rewardEmbed.setThumbnail(`${spritePaths.items}evolution_stone.png`);
    }

    return safeReply(interaction, {
      embeds: [embed1, embed2, rewardEmbed],
      ephemeral: true
    });

  } catch (err) {
    console.error("❌ DAILY ERROR:", err);

    return safeReply(interaction, {
      content: "❌ An error occurred processing your daily reward.",
      ephemeral: true
    });
  }
}
