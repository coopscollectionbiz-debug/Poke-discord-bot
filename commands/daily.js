// ==========================================================
// /daily — Coop’s Collection (Race-Safe v17.3)
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";
import { lockUser } from "../utils/userLocks.js";
import { normalizeUserSchema } from "../utils/sanitizeTrainerData.js";

import { getAllPokemon } from "../utils/dataLoader.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { spritePaths, rarityEmojis, rarityColors } from "../spriteconfig.js";

const DAILY_CC = 500;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.10;

const COIN_EMOJI = "<:coopcoin:1437892112959148093>";
const TP_EMOJI   = "<:tp_icon:1437892250922123364>";
const DAILY_COLOR = "#F7C843";

// ==========================================================
// 🕛 UTC date string helper
// ==========================================================
function getUTCDateString() {
  return new Date().toISOString().split("T")[0];
}

// ==========================================================
// Slash Command Definition
// ==========================================================
export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (2 Pokémon + CC + TP + stone chance)");


// ==========================================================
// EXECUTION
// ==========================================================
export async function execute(
  interaction,
  trainerData,
  saveTrainerDataLocal,
  saveDataToDiscord,
  client,
  passedLockUser // OPTIONAL injection from bot_final
) {
  const lock = passedLockUser || lockUser;

  try {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;

    // ======================================================
    // ⭐ Execute ENTIRE DAILY inside atomic per-user lock
    // ======================================================
    return lock(userId, async () => {

      let user = trainerData[userId] ?? {};

      // Normalize BEFORE logic
      user = normalizeUserSchema(userId, user);
      trainerData[userId] = user;

      const today = getUTCDateString();

      // ======================================================
      // Already claimed today?
      // ======================================================
      if (user.lastDaily === today) {
        return safeReply(interaction, {
          content: "⏳ You've already claimed your daily today!\nResets at **00:00 UTC**.",
          ephemeral: true
        });
      }

      // ======================================================
      // Load Pokémon pool
      // ======================================================
      const allPokemon = await getAllPokemon();
      if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
        return safeReply(interaction, {
          content: "❌ Pokémon data unavailable.",
          ephemeral: true
        });
      }

      // ======================================================
      // Draw 2 rank-aware Pokémon
      // ======================================================
      const pick1 = selectRandomPokemonForUser(allPokemon, user, "pokeball");
      const pick2 = selectRandomPokemonForUser(allPokemon, user, "pokeball");

      if (!pick1 || !pick2) {
        return safeReply(interaction, {
          content: "❌ Daily failed — no Pokémon could be selected.",
          ephemeral: true
        });
      }

      const shiny1 = rollForShiny(user.tp);
      const shiny2 = rollForShiny(user.tp);

      // ======================================================
      // Apply Pokémon to inventory
      // ======================================================
      user.pokemon[pick1.id] ??= { normal: 0, shiny: 0 };
      user.pokemon[pick2.id] ??= { normal: 0, shiny: 0 };

      if (shiny1) user.pokemon[pick1.id].shiny++;
      else user.pokemon[pick1.id].normal++;

      if (shiny2) user.pokemon[pick2.id].shiny++;
      else user.pokemon[pick2.id].normal++;

      // ======================================================
      // Apply daily CC + TP + Stone
      // ======================================================
      user.cc += DAILY_CC;
      user.tp += DAILY_TP;

      let stoneAwarded = false;
      if (Math.random() < EVOLUTION_STONE_CHANCE) {
        user.items.evolution_stone++;
        stoneAwarded = true;
      }

      user.lastDaily = today;

      // ======================================================
      // Rare+ or Shiny broadcast
      // ======================================================
      const broadcastMaybe = async (pick, shiny) => {
        const rarity = (pick.tier || pick.rarity || "common").toLowerCase();
        const shouldBroadcast =
          shiny || ["rare", "epic", "legendary", "mythic"].includes(rarity);

        if (!shouldBroadcast) return;

        try {
          await broadcastReward(client, {
            user: interaction.user,
            type: "pokemon",
            item: {
              id: pick.id,
              name: pick.name,
              rarity,
              spriteFile: `${pick.id}.gif`
            },
            shiny,
            source: "daily"
          });
        } catch (err) {
          console.warn("⚠️ Broadcast failed:", err.message);
        }
      };

      await broadcastMaybe(pick1, shiny1);
      await broadcastMaybe(pick2, shiny2);

      // ======================================================
      // Atomic Save
      // ======================================================
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

      // ======================================================
      // Build Embeds
      // ======================================================
      const sprite1 = shiny1
        ? `${spritePaths.shiny}${pick1.id}.gif`
        : `${spritePaths.pokemon}${pick1.id}.gif`;

      const sprite2 = shiny2
        ? `${spritePaths.shiny}${pick2.id}.gif`
        : `${spritePaths.pokemon}${pick2.id}.gif`;

      const rarity1 = (pick1.tier || "common").toLowerCase();
      const rarity2 = (pick2.tier || "common").toLowerCase();

      const embed1 = new EmbedBuilder()
        .setTitle(`🎁 Pokémon #1 ${shiny1 ? "✨" : ""}`)
        .setColor(rarityColors[rarity1] ?? "#5bc0de")
        .setDescription(`${rarityEmojis[rarity1] ?? ""} **${pick1.name}**`)
        .setImage(sprite1);

      const embed2 = new EmbedBuilder()
        .setTitle(`🎁 Pokémon #2 ${shiny2 ? "✨" : ""}`)
        .setColor(rarityColors[rarity2] ?? "#5bc0de")
        .setDescription(`${rarityEmojis[rarity2] ?? ""} **${pick2.name}**`)
        .setImage(sprite2);

      const summary = new EmbedBuilder()
        .setTitle("🗓️ Daily Rewards")
        .setColor(DAILY_COLOR)
        .addFields(
          { name: `${COIN_EMOJI} CC`, value: `+${DAILY_CC}` },
          { name: `${TP_EMOJI} TP`, value: `+${DAILY_TP}` },
          { name: "📊 New Balance", value: `${COIN_EMOJI} ${user.cc}  |  ${TP_EMOJI} ${user.tp}` }
        );

      if (stoneAwarded) {
        summary.addFields({
          name: "💎 Evolution Stone",
          value: "You received **1× Evolution Stone**!"
        });
        summary.setThumbnail(`${spritePaths.items}evolution_stone.png`);
      }

      return safeReply(interaction, {
        embeds: [embed1, embed2, summary],
        ephemeral: true
      });
    });

  } catch (err) {
    console.error("❌ /daily ERROR:", err);

    return safeReply(interaction, {
      content: "❌ An error occurred processing your daily reward.",
      ephemeral: true
    });
  }
}
