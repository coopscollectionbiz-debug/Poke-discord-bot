// ==========================================================
// 🗓️ Coop's Collection — /daily (Universal UTC Reset v14)
// ==========================================================
// Rewards:
//   • TWO Pokémon (rank-buffed)
//   • +500 CC
//   • +100 TP
//   • 10% Evolution Stone
//   • Three embeds with sprites
//   • Resets daily at 00:00 UTC for ALL USERS
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

// Returns YYYY-MM-DD (UTC)
function getUTCDateString() {
  return new Date().toISOString().split("T")[0];
}

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (2 Pokémon + CC + TP + stone chance)");


// ==========================================================
// 🧩 EXECUTE DAILY (Universal Reset)
// ==========================================================
export async function execute(
  interaction,
  trainerData,
  saveTrainerDataLocal,
  saveDataToDiscord,
  client
) {
  try {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const userId = interaction.user.id;
    const today = getUTCDateString();

    // ======================================================
    // ENSURE USER EXISTS
    // ======================================================
    trainerData[userId] ??= {};
    const user = trainerData[userId];

    user.cc ??= 0;
    user.tp ??= 0;
    user.items ??= { evolution_stone: 0 };
    user.items.evolution_stone ??= 0;
    user.pokemon ??= {};
    user.lastDaily ??= "1970-01-01"; // default

    // ======================================================
    // UNIVERSAL UTC RESET CHECK
    // ======================================================
    if (user.lastDaily === today) {
      return safeReply(interaction, {
        content: `⏳ You've already claimed your daily today!\nResets at **00:00 UTC**.`,
        ephemeral: true,
      });
    }

    // ======================================================
    // LOAD ALL POKEMON
    // ======================================================
    const allPokemon = await getAllPokemon();
    if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
      return safeReply(interaction, {
        content: "❌ Could not load Pokémon data.",
        ephemeral: true,
      });
    }

    // ======================================================
    // TWO RANDOM ROLLS
    // ======================================================
    const pick1 = selectRandomPokemonForUser(allPokemon, user, "pokeball");
    const pick2 = selectRandomPokemonForUser(allPokemon, user, "pokeball");

    if (!pick1 || !pick2) {
      return safeReply(interaction, {
        content: "❌ Daily failed — Pokémon selection error.",
        ephemeral: true
      });
    }

    // Shiny rolls
    const shiny1 = rollForShiny(user.tp);
    const shiny2 = rollForShiny(user.tp);

    // Sprite URLs
    const sprite1 = shiny1
      ? `${spritePaths.shiny}${pick1.id}.gif`
      : `${spritePaths.pokemon}${pick1.id}.gif`;

    const sprite2 = shiny2
      ? `${spritePaths.shiny}${pick2.id}.gif`
      : `${spritePaths.pokemon}${pick2.id}.gif`;

    // ======================================================
    // SAVE TO INVENTORY
    // ======================================================
    function addMon(pick, shiny) {
      user.pokemon[pick.id] ??= { normal: 0, shiny: 0 };
      if (shiny) user.pokemon[pick.id].shiny++;
      else user.pokemon[pick.id].normal++;
    }

    addMon(pick1, shiny1);
    addMon(pick2, shiny2);

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
          source: "daily",
        }).catch(() => {});
      }
    }

    await maybeBroadcast(pick1, shiny1);
    await maybeBroadcast(pick2, shiny2);

    // ======================================================
    // CC / TP / STONE
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    let stoneAwarded = false;
    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.items.evolution_stone++;
      stoneAwarded = true;
    }

    // Mark today's claim
    user.lastDaily = today;

    // Queue save
    await enqueueSave(trainerData);

    // ======================================================
    // EMBEDS
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

    const summary = new EmbedBuilder()
      .setTitle("🗓️ Daily Rewards")
      .setColor("#28a745")
      .addFields(
        { name: "💰 CC", value: `+${DAILY_CC}`, inline: true },
        { name: "⭐ TP", value: `+${DAILY_TP}`, inline: true },
        { name: "📊 New Balance", value: `${user.cc} CC | ${user.tp} TP` }
      );

    if (stoneAwarded) {
      summary.addFields({
        name: "💎 Evolution Stone",
        value: "You gained **1x Evolution Stone**!"
      });
      summary.setThumbnail(`${spritePaths.items}evolution_stone.png`);
    }

    return safeReply(interaction, {
      embeds: [embed1, embed2, summary],
      ephemeral: true
    });

  } catch (err) {
    console.error("❌ /daily ERROR:", err);

    return safeReply(interaction, {
      content: "❌ An unexpected error occurred while processing your daily.",
      ephemeral: true
    });
  }
}
