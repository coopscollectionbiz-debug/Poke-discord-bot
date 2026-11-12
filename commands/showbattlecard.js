// ==========================================================
// The Ranked card: a player's Ranked team at Lv 50 with their real Level,
// Ranked rating, W/L, leaderboard position and rank (utils/render/
// battleCard.js, design option 2). Read-only. /rankedcard (commands/
// rankedcard.js) is the command; /showbattlecard stays as an alias for
// about two weeks after the three-teams split.
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
  .setDescription("Old name for /rankedcard: your Ranked team, rating and record")
  .addUserOption((o) => o.setName("user").setDescription("See another player's Ranked card (only you see it)").setRequired(false));

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
    const team = view.team.length ? view.team.map((s) => `${s.name} Lv 50`).join(", ") : "No Ranked team yet. Set one on the Teams page (/dashboard).";
    return { content: `**${displayName}'s Ranked team**\n${record}\n${team}` };
  }
}

/** /rankedcard and its alias: your own card posts publicly; user:@someone answers privately. */
export async function execute(interaction, trainerData) {
  const target = interaction.options?.getUser?.("user") ?? null;
  const own = !target || target.id === interaction.user.id;
  const userId = own ? interaction.user.id : target.id;
  if (!trainerData[userId]) {
    const content = own ? "You don't have a trainer yet. Use /trainercard to start." : `${target.username} hasn't started playing yet.`;
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply(own ? {} : { flags: MessageFlags.Ephemeral });
  const member = own ? interaction.member : await interaction.guild?.members.fetch(userId).catch(() => null);
  const name = member?.displayName ?? (own ? interaction.user.username : target.username);
  return interaction.editReply(await battleCardMessage(trainerData, userId, name));
}
