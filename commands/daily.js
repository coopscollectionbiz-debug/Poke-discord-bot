// ==========================================================
// 🗓️ Coop's Collection — /daily (Unified Schema v9.0)
// ==========================================================
// Rewards:
//  • 1 Pokémon (rank-buffed odds)
//  • +500 CC
//  • +100 TP
//  • 10% chance evolution stone
//
// Uses:
//  • trainerData.json unified schema
//  • weightedRandom -> selectRandomPokemonForUser
//  
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

import fs from "fs/promises";
import path from "path";

import { safeReply } from "../utils/safeReply.js";
import { saveUser } from "../utils/saveManager.js";

import { getRank } from "../utils/rankSystem.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { broadcastReward } from "../utils/broadcastReward.js";

const DATA_PATH = path.resolve("./trainerData.json");

// Reward constants
const DAILY_CC = 500;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.10; // 10%

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (Pokémon + CC + TP)");

export async function execute(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;

    // ======================================================
    // LOAD FULL trainerData.json
    // ======================================================
    let allUsers = {};
    try {
      const raw = await fs.readFile(DATA_PATH, "utf8");
      allUsers = JSON.parse(raw);
    } catch {
      allUsers = {};
    }

    // Ensure user object exists
    if (!allUsers[userId]) {
      allUsers[userId] = {
        trainers: [],
        equipped: null,
        cc: 0,
        tp: 0,
        stones: 0,
        pokemon: {},     // new unified format (id:{normal,shiny} or array)
        lastDaily: 0
      };
    }

    const user = allUsers[userId];
    const now = Date.now();

    // ======================================================
    // DAILY COOLDOWN CHECK
    // ======================================================
    const cooldown = 24 * 60 * 60 * 1000;
    const remaining = user.lastDaily ? cooldown - (now - user.lastDaily) : 0;

    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);

      return safeReply(interaction, {
        content: `⏳ You already claimed your daily.\nCome back in **${hours}h ${minutes}m**.`,
        ephemeral: true,
      });
    }

    // ======================================================
    // GIVE POKÉMON (rank-buffed weighted odds)
    // ======================================================
    const { pokemon, shiny, rarity, spriteFile, name: pokeName } =
      await selectRandomPokemonForUser(userId);

    // Broadcast epic+ or shiny like old daily
    if (["epic", "legendary", "mythic"].includes(rarity) || shiny)
      broadcastReward(client, {
        user: { id: userId },
        type: "pokemon",
        item: {
          id: pokemon,
          name: pokeName,
          rarity,
          spriteFile
        },
        shiny,
        source: "daily"
      });

    // ======================================================
    // CURRENCY + TP REWARDS
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    // ======================================================
    // EVOLUTION STONE (10%)
    // ======================================================
    let stoneAwarded = false;
    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.stones = (user.stones || 0) + 1;
      stoneAwarded = true;
    }

    // ======================================================
    // SET COOLDOWN TIMESTAMP
    // ======================================================
    user.lastDaily = now;

    // ======================================================
// SAVE UPDATED USER ONLY
// ======================================================
await saveUser(userId, user);


    // ======================================================
    // EMBED RESPONSE
    // ======================================================
    const embed = new EmbedBuilder()
      .setTitle("🗓️ Daily Reward")
      .setColor("#5bc0de")
      .addFields(
        { name: "💰 CC", value: `+${DAILY_CC}`, inline: true },
        { name: "⭐ TP", value: `+${DAILY_TP}`, inline: true }
      )
      .addFields({
        name: "🎁 Pokémon Received",
        value: `${shiny ? "✨ " : ""}**${pokeName}**\nRarity: **${rarity.toUpperCase()}**`,
      })
      .setThumbnail(spriteFile);

    if (stoneAwarded) {
      embed.addFields({
        name: "💎 Bonus",
        value: "You found an **Evolution Stone**!",
      });
    }

    return safeReply(interaction, {
      embeds: [embed],
      ephemeral: true
    });

  } catch (err) {
    console.error("❌ DAILY ERROR:", err);
    return safeReply(interaction, {
      content: "❌ Something went wrong while processing your daily.",
      ephemeral: true,
    });
  }
}
