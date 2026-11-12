// ==========================================================
// /showbattlecard — your Battle team as a public card: everyone at Lv 50
// with their real Level, ranked rating, W/L, leaderboard position and rank
// (utils/render/battleCard.js, design option 2). /showteam, /trainercard and
// every other display keep showing the Display team. Read-only.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from "discord.js";
import { cardImage } from "../utils/render/stage.js";
import { battleCardView } from "../utils/render/battleCard.js";
import { rankBattleRatings } from "./leaderboard.js";
import { threaded } from "../utils/render/renderers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trainerSprites = JSON.parse(fs.readFileSync(path.join(__dirname, "../trainerSprites.json"), "utf8"));

export const data = new SlashCommandBuilder()
  .setName("showbattlecard")
  .setDescription("Show your Battle team card: ranked rating, record and leaderboard position");

/** { name, tier } of the equipped trainer file, from trainerSprites.json, or null. */
export function equippedTrainer(file) {
  if (!file) return null;
  const want = path.basename(String(file)).toLowerCase().replace(/\.(png|gif)$/i, "");
  for (const [key, entry] of Object.entries(trainerSprites ?? {})) {
    if (!Array.isArray(entry?.sprites)) continue;
    if (entry.sprites.some((s) => typeof s === "string" && s.toLowerCase().replace(/\.(png|gif)$/i, "") === want)) {
      return { name: key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), tier: String(entry.tier ?? "common").toLowerCase() };
    }
  }
  return null;
}

/** The message: the rendered card, or a short text fallback if rendering fails. */
export async function battleCardMessage(trainerData, userId, displayName, { render = threaded.battleCard } = {}) {
  const user = trainerData[userId];
  const view = battleCardView(user, { displayName, trainer: equippedTrainer(user?.displayedTrainer), board: rankBattleRatings(trainerData, userId) });
  try {
    const card = await cardImage((animate) => render(view, { animate }), "battlecard");
    return { files: [new AttachmentBuilder(card.buffer, { name: card.name })] };
  } catch (err) {
    console.warn("⚠️ battle card render failed; sending text:", err?.message || err);
    const record = view.played ? `${view.rating} rating · ${view.wins}W–${view.losses}L${view.position ? ` · #${view.position} of ${view.players}` : ""}` : "No ranked battles this season.";
    const team = view.team.length ? view.team.map((s) => `${s.name} Lv 50`).join(", ") : "No Battle team yet. Set one on the Teams page (/dashboard).";
    return { content: `**${displayName}'s Battle team**\n${record}\n${team}` };
  }
}

export async function execute(interaction, trainerData) {
  const userId = interaction.user.id;
  if (!trainerData[userId]) {
    return interaction.reply({ content: "You don't have a trainer yet. Use /trainercard to start.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply();
  const name = interaction.member?.displayName ?? interaction.user.username;
  return interaction.editReply(await battleCardMessage(trainerData, userId, name));
}
