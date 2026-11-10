// ==========================================================
// /leaderboard — top 10 trainers by Battle rating, plus your position.
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { leaderboardView, renderLeaderboard } from "../utils/render/leaderboardCard.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Top trainers by Battle rating");

export function rankBattleRatings(trainerData, userId) {
  const ranked = Object.entries(trainerData)
    .filter(([, u]) => (u?.battle?.wins ?? 0) + (u?.battle?.losses ?? 0) >= 1)
    .map(([id, u]) => ({ userId: id, name: u.name, rating: u.battle.rating, wins: u.battle.wins, losses: u.battle.losses }))
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.userId.localeCompare(b.userId));
  const index = ranked.findIndex((p) => p.userId === userId);
  const you = index < 0 ? null : (({ rating, wins, losses }) => ({ position: index + 1, rating, wins, losses }))(ranked[index]);
  return { top: ranked.slice(0, 10), you };
}

// The text version: sent if the image can't be rendered.
export function buildLeaderboardEmbed({ top, you }) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🏆 Battle rating leaderboard")
    .setDescription(top.map((p, i) => `${i + 1}. ${p.name} — ${p.rating} (${p.wins}W–${p.losses}L)`).join("\n") || "No battles yet.")
    .setFooter({ text: you ? `Your position: #${you.position} · ${you.rating}` : "Battle someone to join the leaderboard." });
}

// The podium image (utils/render/leaderboardCard.js); text embed on failure.
export async function leaderboardMessage(trainerData, userId, { render = renderLeaderboard } = {}) {
  const board = rankBattleRatings(trainerData, userId);
  try {
    const png = await render(leaderboardView(board, trainerData, userId));
    return { files: [new AttachmentBuilder(png, { name: "leaderboard.png" })] };
  } catch (err) {
    console.warn("⚠️ leaderboard render failed; sending text:", err?.message || err);
    return { embeds: [buildLeaderboardEmbed(board)] };
  }
}

export async function execute(interaction, trainerData) {
  await interaction.deferReply();
  return interaction.editReply(await leaderboardMessage(trainerData, interaction.user.id));
}
