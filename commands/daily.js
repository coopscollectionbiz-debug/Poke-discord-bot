// ==========================================================
// 🗓️ Coop's Collection — /daily (v7.5 FINAL)
// ==========================================================
// Features:
//  • 24h cooldown
//  • Rank-aware TP rewards (same as before)
//  • CC rewards
//  • 10% chance to award 1 Evolution Stone
//  • Anti-crash, safeReply, and modern deferrals
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";

import { loadUserFromFile, saveUserFromFile } from "../utils/userSchema.js";
import { getRank } from "../utils/rankSystem.js";

// ==========================================================
// 🧩 Helper: safeReply to avoid "Unknown Interaction"
// ==========================================================
async function safeReply(interaction, payload) {
  try {
    if (interaction.replied) return interaction.followUp(payload);
    if (interaction.deferred) return interaction.editReply(payload);
    return interaction.reply(payload);
  } catch (err) {
    console.error("safeReply error:", err);
  }
}

// ==========================================================
// 🎁 Reward Tables
// ==========================================================
const DAILY_CC = 750;               // your existing value
const BASE_DAILY_TP = 150;          // scaled by rank multiplier
const EVOSTONE_CHANCE = 0.10;       // ⭐ 10% chance

// Rank multipliers for TP (unchanged)
const RANK_TP_MULTIPLIERS = {
  novice: 1.0,
  junior: 1.05,
  skilled: 1.10,
  experienced: 1.15,
  advanced: 1.20,
  expert: 1.30,
  veteran: 1.40,
  elite: 1.55,
  master: 1.75,
  gymleader: 2.0,
  elitefour: 2.2,
  champion: 2.4,
  legend: 2.6,
};

// ==========================================================
// 📌 Cooldown Storage
// ==========================================================
const cooldowns = new Map();

// ==========================================================
// 🧪 Command Export
// ==========================================================
export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily rewards!");

export const execute = async (interaction, client) => {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;

    // ======================================================
    // 🕒 Cooldown Check
    // ======================================================
    const now = Date.now();
    const last = cooldowns.get(userId) || 0;
    const diff = now - last;

    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor((24 * 60 * 60 * 1000 - diff) / 3600000);
      const mins = Math.floor(((24 * 60 * 60 * 1000 - diff) % 3600000) / 60000);

      return safeReply(interaction, {
        content: `⏳ You already claimed your daily! Come back in **${hours}h ${mins}m**.`,
        ephemeral: true,
      });
    }

    cooldowns.set(userId, now);

    // ======================================================
    // 📥 Load User
    // ======================================================
    const user = await loadUserFromFile(userId);
    if (!user.items) user.items = {};
    if (!user.items.evolution_stone)
      user.items.evolution_stone = 0;

    // ======================================================
    // 🧮 Calculate Rewards
    // ======================================================
    const rank = getRank(user.tp || 0).toLowerCase().replace(/\s+/g, "");
    const tpMultiplier = RANK_TP_MULTIPLIERS[rank] ?? 1;

    const gainedCC = DAILY_CC;
    const gainedTP = Math.round(BASE_DAILY_TP * tpMultiplier);

    user.cc = (user.cc ?? 0) + gainedCC;
    user.tp = (user.tp ?? 0) + gainedTP;

    // ======================================================
    // 💎 10% Evolution Stone Chance
    // ======================================================
    let gainedStone = false;
    if (Math.random() < EVOSTONE_CHANCE) {
      user.items.evolution_stone += 1;
      gainedStone = true;
    }

    // ======================================================
    // 💾 Save
    // ======================================================
    await saveUserFromFile(userId, user);

    // ======================================================
    // 📦 Build Embed
    // ======================================================
    const embed = new EmbedBuilder()
      .setColor("#facc15")
      .setTitle("📅 Daily Rewards")
      .setDescription(`You claimed your daily rewards!`)
      .addFields(
        { name: "💰 CC", value: `+${gainedCC}`, inline: true },
        { name: "⭐ TP", value: `+${gainedTP}`, inline: true },
        { name: "🏅 Rank", value: getRank(user.tp), inline: false }
      );

    if (gainedStone) {
      embed.addFields({
        name: "💎 Bonus!",
        value: "You found **1 Evolution Stone**!",
      });
    }

    // ======================================================
    // 🎉 Final Deliver
    // ======================================================
    return safeReply(interaction, { embeds: [embed], ephemeral: true });

  } catch (err) {
    console.error("Daily error:", err);
    return safeReply(interaction, {
      content: "❌ Something went wrong processing your daily.",
      ephemeral: true,
    });
  }
};
