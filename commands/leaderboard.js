// ==========================================================
// /leaderboard — top 10 trainers by Battle rating, plus your position.
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

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

export async function execute(interaction, trainerData) {
  const { top, you } = rankBattleRatings(trainerData, interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🏆 Battle rating leaderboard")
    .setDescription(top.map((p, i) => `${i + 1}. ${p.name} — ${p.rating} (${p.wins}W–${p.losses}L)`).join("\n") || "No battles yet.")
    .setFooter({ text: you ? `Your position: #${you.position} · ${you.rating}` : "Battle someone to join the leaderboard." });
  return interaction.reply({ embeds: [embed] });
}
