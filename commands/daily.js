// ==========================================================
// 🗓️ Coop's Collection — /daily (Final Stable v12)
// ==========================================================
// Rewards:
//   • TWO Pokémon (rank-buffed odds)
//   • +500 CC
//   • +100 TP
//   • 10% chance evolution stone
//   • Rare+ or shiny receives broadcast
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

import { spritePaths } from "../spriteconfig.js"; 
// spritePaths.pokemonNormal
// spritePaths.pokemonShiny
// spritePaths.items.evolutionStone

const TRAINERDATA_PATH = path.resolve("./trainerData.json");

// DAILY CONSTANTS
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
    // LOAD trainerData.json
    // ======================================================
    let trainerData = {};
    try {
      trainerData = JSON.parse(await fs.readFile(TRAINERDATA_PATH, "utf8"));
    } catch {
      trainerData = {};
    }

    // Ensure user structure
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

    // ======================================================
    // COOLDOWN CHECK
    // ======================================================
    const now = Date.now();
    const cooldown = 86400000; // 24h

    if (user.lastDaily && now - user.lastDaily < cooldown) {
      const remaining = cooldown - (now - user.lastDaily);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);

      return safeReply(interaction, {
        content: `⏳ You already claimed your daily.\nReturn in **${hours}h ${minutes}m**.`,
        ephemeral: true,
      });
    }

    // ======================================================
    // GET ALL POKÉMON
    // ======================================================
    const allPokemon = await getAllPokemon();

    // TWO ROLLS (rank buff included)
    const picks = [
      selectRandomPokemonForUser(allPokemon, user, "pokeball"),
      selectRandomPokemonForUser(allPokemon, user, "pokeball")
    ];

    for (let i = 0; i < picks.length; i++) {
      if (!picks[i]) {
        return safeReply(interaction, {
          content: "❌ Daily failed — No Pokémon available.",
          ephemeral: true,
        });
      }
    }

    // Roll shiny for both
    const shiny1 = rollForShiny(user.tp);
    const shiny2 = rollForShiny(user.tp);

    const results = [
      {
        pick: picks[0],
        shiny: shiny1,
        sprite: shiny1
          ? `${spritePaths.pokemonShiny}${picks[0].id}.gif`
          : `${spritePaths.pokemonNormal}${picks[0].id}.gif`
      },
      {
        pick: picks[1],
        shiny: shiny2,
        sprite: shiny2
          ? `${spritePaths.pokemonShiny}${picks[1].id}.gif`
          : `${spritePaths.pokemonNormal}${picks[1].id}.gif`
      }
    ];

    // ======================================================
    // SAVE TO USER INVENTORY
    // ======================================================
    for (const r of results) {
      const id = r.pick.id;
      user.pokemon[id] ??= { normal: 0, shiny: 0 };
      if (r.shiny) user.pokemon[id].shiny++;
      else user.pokemon[id].normal++;

      const rarity = r.pick.tier || r.pick.rarity || "common";

      // Broadcast
      if (r.shiny || ["rare", "epic", "legendary", "mythic"].includes(rarity)) {
        broadcastReward(client, {
          user: { id: userId, username: interaction.user.username },
          type: "pokemon",
          item: { id, name: r.pick.name, rarity, spriteFile: r.sprite },
          shiny: r.shiny,
          source: "daily"
        });
      }
    }

    // ======================================================
    // CC + TP
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    // ======================================================
    // EVOLUTION STONE
    // ======================================================
    let stoneAwarded = false;
    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.items.evolution_stone++;
      stoneAwarded = true;
    }

    user.lastDaily = now;

    // ======================================================
    // SAVE
    // ======================================================
    await enqueueSave(trainerData);

    // ======================================================
    // THREE EMBEDS — POKEMON 1, POKEMON 2, REWARD SUMMARY
    // ======================================================
    const embed1 = new EmbedBuilder()
      .setTitle("🎁 Daily Pokémon #1")
      .setColor("#5bc0de")
      .setDescription(
        `${results[0].shiny ? "✨ " : ""}**${results[0].pick.name}**\n` +
        `Rarity: **${(results[0].pick.tier || results[0].pick.rarity || "common").toUpperCase()}**`
      )
      .setImage(results[0].sprite);

    const embed2 = new EmbedBuilder()
      .setTitle("🎁 Daily Pokémon #2")
      .setColor("#5bc0de")
      .setDescription(
        `${results[1].shiny ? "✨ " : ""}**${results[1].pick.name}**\n` +
        `Rarity: **${(results[1].pick.tier || results[1].pick.rarity || "common").toUpperCase()}**`
      )
      .setImage(results[1].sprite);

    const rewardEmbed = new EmbedBuilder()
      .setTitle("🗓️ Daily Rewards")
      .setColor("#5bc0de")
      .addFields(
        { name: "💰 CC", value: `+${DAILY_CC}`, inline: true },
        { name: "⭐ TP", value: `+${DAILY_TP}`, inline: true },
      );

    if (stoneAwarded) {
      rewardEmbed.addFields({
        name: "💎 Evolution Stone",
        value: "You received **1x Evolution Stone**!"
      });
      rewardEmbed.setThumbnail(spritePaths.items.evolutionStone);
    }

    return safeReply(interaction, {
      embeds: [embed1, embed2, rewardEmbed],
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
