// ==========================================================
// 🗓️ Coop's Collection — /daily (Two Pokémon + Optional Stone)
// ==========================================================
// Rewards:
//  • 2 Pokémon (rank-buffed odds)
//  • +500 CC
//  • +100 TP
//  • 10% chance evolution stone
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

import fs from "fs/promises";
import path from "path";

import { safeReply } from "../utils/safeReply.js";
import { enqueueSave } from "../utils/saveQueue.js";

import { getAllPokemon } from "../utils/dataLoader.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";

const TRAINERDATA_PATH = path.resolve("./trainerData.json");

// Daily rewards
const DAILY_CC = 500;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.10;

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (2 Pokémon + CC + TP)");

export async function execute(interaction, client) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;

    // ======================================================
    // LOAD trainerData
    // ======================================================
    let trainerData = {};
    try {
      trainerData = JSON.parse(await fs.readFile(TRAINERDATA_PATH, "utf8"));
    } catch {
      trainerData = {};
    }

    // Ensure user block
    trainerData[userId] ??= {
      cc: 0,
      tp: 0,
      items: { evolution_stone: 0 },
      pokemon: {},
      trainers: [],
      displayedTrainer: null,
      displayedPokemon: [],
      onboardingComplete: false,
      onboardingDate: null,
      starterPokemon: null,
      lastDaily: 0
    };

    const user = trainerData[userId];
    user.items ??= { evolution_stone: 0 };
    user.items.evolution_stone ??= 0;

    const now = Date.now();

    // ======================================================
    // Cooldown
    // ======================================================
    const cooldown = 24 * 60 * 60 * 1000;
    if (user.lastDaily && now - user.lastDaily < cooldown) {
      const remaining = cooldown - (now - user.lastDaily);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);

      return safeReply(interaction, {
        content: `⏳ You already claimed your daily.\nCome back in **${hours}h ${minutes}m**.`,
        ephemeral: true
      });
    }

    // ======================================================
    // LOAD ALL POKÉMON
    // ======================================================
    const allPokemon = await getAllPokemon();

    // ======================================================
    // FUNCTION — picks and saves a Pokémon
    // ======================================================
    function rollOnePokemon() {
      const pick = selectRandomPokemonForUser(allPokemon, user, "pokeball");

      if (!pick) return null;

      const id = pick.id;
      const name = pick.name;
      const rarity = pick.tier || pick.rarity || "common";

      const shiny = rollForShiny(user.tp || 0);

      const sprite = shiny
        ? `/public/sprites/pokemon/shiny/${id}.gif`
        : `/public/sprites/pokemon/normal/${id}.gif`;

      // Save to user inventory
      user.pokemon[id] ??= { normal: 0, shiny: 0 };
      if (shiny) user.pokemon[id].shiny++;
      else user.pokemon[id].normal++;

      // Broadcast rare+ or shiny
      if (shiny || ["rare", "epic", "legendary", "mythic"].includes(rarity)) {
        broadcastReward(client, {
          user: { id: userId, username: interaction.user.username },
          type: "pokemon",
          item: { id, name, rarity, spriteFile: sprite },
          shiny,
          source: "daily"
        });
      }

      return { id, name, rarity, shiny, sprite };
    }

    // ======================================================
    // ROLL TWO POKÉMON
    // ======================================================
    const poke1 = rollOnePokemon();
    const poke2 = rollOnePokemon();

    if (!poke1 || !poke2) {
      return safeReply(interaction, {
        content: "❌ Daily reward failed — Pokémon pool unavailable.",
        ephemeral: true
      });
    }

    // ======================================================
    // CC + TP
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    // ======================================================
    // EVOLUTION STONE (10%)
    // ======================================================
    let stoneAwarded = false;
    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.items.evolution_stone++;
      stoneAwarded = true;
    }

    user.lastDaily = now;

    // Save
    await enqueueSave(trainerData);

    // ======================================================
    // BUILD 3 EMBEDS
    // ======================================================

    // Pokémon 1 Embed
    const embed1 = new EmbedBuilder()
      .setTitle("🎁 Daily Reward — Pokémon #1")
      .setColor("#5bc0de")
      .addFields(
        { name: "Name", value: poke1.name, inline: true },
        { name: "Rarity", value: poke1.rarity.toUpperCase(), inline: true },
        { name: "Shiny?", value: poke1.shiny ? "✨ Yes" : "No", inline: true }
      )
      .setThumbnail(poke1.sprite);

    // Pokémon 2 Embed
    const embed2 = new EmbedBuilder()
      .setTitle("🎁 Daily Reward — Pokémon #2")
      .setColor("#5bc0de")
      .addFields(
        { name: "Name", value: poke2.name, inline: true },
        { name: "Rarity", value: poke2.rarity.toUpperCase(), inline: true },
        { name: "Shiny?", value: poke2.shiny ? "✨ Yes" : "No", inline: true }
      )
      .setThumbnail(poke2.sprite);

    // Evolution Stone Embed (only if awarded)
    let embeds = [embed1, embed2];

    if (stoneAwarded) {
      const stone = new EmbedBuilder()
        .setTitle("💎 Bonus Reward")
        .setDescription("You received an **Evolution Stone**!")
        .setColor("#ffd700")
        .setThumbnail("/public/sprites/items/evolution_stone.png");

      embeds.push(stone);
    }

    // Send all embeds
    return safeReply(interaction, {
      embeds,
      ephemeral: true
    });

  } catch (err) {
    console.error("❌ DAILY ERROR:", err);
    return safeReply(interaction, {
      content: "❌ Something went wrong while processing /daily.",
      ephemeral: true
    });
  }
}
