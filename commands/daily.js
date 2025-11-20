// ==========================================================
// 🗓️ Coop's Collection — /daily (Unified Schema v10)
// ==========================================================
// Rewards:
//  • 1 Pokémon (rank-buffed odds)
//  • +500 CC
//  • +100 TP
//  • 10% chance evolution stone
//
// Saves entire trainerData.json using enqueueSave()
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

import fs from "fs/promises";
import path from "path";

import { safeReply } from "../utils/safeReply.js";
import { enqueueSave } from "../utils/saveQueue.js";

import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { getAllPokemon } from "../utils/dataLoader.js";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");

// Daily constants
const DAILY_CC = 500;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.10;

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (Pokémon + CC + TP)");

export async function execute(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;

    // ======================================================
    // LOAD FULL trainerData
    // ======================================================
    let trainerData = {};
    try {
      trainerData = JSON.parse(await fs.readFile(TRAINERDATA_PATH, "utf8"));
    } catch {
      trainerData = {};
    }

    // Ensure user block exists
    if (!trainerData[userId]) {
      trainerData[userId] = {
        cc: 0,
        tp: 0,
        items: { evolution_stone: 0 },
        pokemon: {},   // Unified format { id: {normal, shiny} }
        trainers: [],
        equipped: null,
        lastDaily: 0
      };
    } else {
      // ensure items exists
      if (!trainerData[userId].items)
        trainerData[userId].items = { evolution_stone: 0 };

      if (trainerData[userId].items.evolution_stone == null)
        trainerData[userId].items.evolution_stone = 0;
    }

    const user = trainerData[userId];
    const now = Date.now();

    // ======================================================
    // DAILY COOLDOWN CHECK
    // ======================================================
    const cooldown = 24 * 60 * 60 * 1000;
    if (user.lastDaily && now - user.lastDaily < cooldown) {
      const remaining = cooldown - (now - user.lastDaily);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);

      return safeReply(interaction, {
        content: `⏳ You already claimed your daily.\nCome back in **${hours}h ${minutes}m**.`,
        ephemeral: true,
      });
    }

    // ======================================================
// GENERATE POKÉMON REWARD (rank-buffed odds)
// ======================================================
const allPokemon = await getAllPokemon();
const roll = selectRandomPokemonForUser(allPokemon, user, "daily");

if (!roll) {
  console.error("❌ DAILY: No Pokémon could be selected! allPokemon length = ", allPokemon.length);
  return safeReply(interaction, {
    content: "❌ Daily reward failed — no Pokémon available to roll.",
    ephemeral: true,
  });
}

const { id, name, rarity, shiny, spriteFile } = roll;


    // ======================================================
    // SAVE POKÉMON TO USER INVENTORY
    // ======================================================
    if (!user.pokemon[id]) {
      user.pokemon[id] = { normal: 0, shiny: 0 };
    }
    if (shiny) {
      user.pokemon[id].shiny += 1;
    } else {
      user.pokemon[id].normal += 1;
    }

    // ======================================================
// BROADCAST RARE+ OR SHINY
// ======================================================
if (shiny || ["rare", "epic", "legendary", "mythic"].includes(rarity)) {
  broadcastReward(client, {
    user: { id: userId, username: interaction.user.username },
    type: "pokemon",
    item: { id, name, rarity, spriteFile },
    shiny,
    source: "daily"
  });
}


    // ======================================================
    // CURRENCY + TP
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    // ======================================================
    // EVOLUTION STONE (10% chance)
    // ======================================================
    let stoneAwarded = false;

    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.items.evolution_stone += 1;
      stoneAwarded = true;
    }

    // ======================================================
    // SET COOLDOWN
    // ======================================================
    user.lastDaily = now;

    // ======================================================
    // SAVE ENTIRE trainerData.json VIA QUEUE
    // ======================================================
    await enqueueSave(trainerData);

    // ======================================================
    // EMBED RESPONSE
    // ======================================================
    const embed = new EmbedBuilder()
      .setTitle("🗓️ Daily Reward")
      .setColor("#5bc0de")
      .addFields(
        { name: "💰 CC", value: `+${DAILY_CC}`, inline: true },
        { name: "⭐ TP", value: `+${DAILY_TP}`, inline: true },
        {
          name: "🎁 Pokémon Received",
          value: `${shiny ? "✨ " : ""}**${name}**\nRarity: **${rarity.toUpperCase()}**`,
        }
      )
      .setThumbnail(spriteFile);

    if (stoneAwarded) {
      embed.addFields({
        name: "💎 Bonus",
        value: "You received an **Evolution Stone**!"
      });
    }

    return safeReply(interaction, {
      embeds: [embed],
      ephemeral: true,
    });

  } catch (err) {
    console.error("❌ DAILY ERROR:", err);
    return safeReply(interaction, {
      content: "❌ Something went wrong while processing /daily.",
      ephemeral: true
    });
  }
}
