// ==========================================================
// utils/battle/playback.js
// "Watch it happen": posts a battle frame in the channel, edits it a few
// times at evenly spaced turns, then adds the result embed. Results are
// already saved before this runs; a failed edit just stops the replay.
// ==========================================================

import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { renderBattleFrame, pickFrameTurns } from "./render.js";
import { PLAYBACK } from "./tuning.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;

function expLines(entries) {
  return entries.slice(0, 6).map((e) => {
    if (e.toLevel === e.fromLevel) return `${e.name} Lv ${e.fromLevel} (${signed(e.gained)} EXP)`;
    const learned = e.learned.length ? ` · learned ${e.learned.join(", ")}` : "";
    return `${e.name} Lv ${e.fromLevel} → ${e.toLevel}${learned}`;
  }).join("\n") || "—";
}

export function buildResultEmbed(outcome, names) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🏆 ${names[outcome.winnerId]} wins!`);
  if (outcome.surge) embed.setDescription("🔥 Underdog surge!");
  if (outcome.mode === "wager") {
    embed.addFields({ name: "Pot", value: `${2 * outcome.stake} CC to ${names[outcome.winnerId]}` });
  }
  for (const [userId, entries] of Object.entries(outcome.exp)) {
    const label = outcome.mode === "wager" ? `EXP — ${names[userId]}` : "EXP";
    embed.addFields({ name: label, value: expLines(entries) });
  }
  const rating = Object.entries(outcome.rating)
    .map(([userId, r]) => `${names[userId]} ${r.to} (${signed(r.to - r.from)})`)
    .join("\n");
  embed.addFields({ name: "Battle rating", value: rating });
  return embed;
}

function header(outcome) {
  const [c, d] = outcome.sides.map((s) => `<@${s.userId}>`);
  const intro = outcome.mode === "wager"
    ? `⚔️ ${c} vs ${d} — Wager battle for ${outcome.stake} CC each!`
    : `⚔️ ${c} challenged ${d}!`;
  if (!outcome.surge) return intro;
  return `${intro}\n🔥 The crowd is behind <@${outcome.sides[outcome.surge.side].userId}>! Underdog surge!`;
}

// Sends a new channel message (a fresh message is what actually notifies
// the @mentioned players; edits never do) and replays the battle on it.
export async function playBattle(channel, outcome, names, { frames, delayMs } = PLAYBACK) {
  const sides = outcome.sides.map((s) => ({ name: names[s.userId], members: s.members }));
  const frame = async (turn, caption) => new AttachmentBuilder(
    await renderBattleFrame({ sides, hp: outcome.result.snapshots[turn], caption, surgeSide: outcome.surge?.side ?? null }),
    { name: "battle.png" },
  );

  const message = await channel.send({ content: header(outcome), files: [await frame(0, "Battle start")] });
  const turns = pickFrameTurns(outcome.result.turns, frames);
  try {
    for (const turn of turns) {
      await sleep(delayMs);
      const last = turn === turns.at(-1);
      await message.edit({
        files: [await frame(turn, last ? `Turn ${turn} — ${names[outcome.winnerId]} wins!` : `Turn ${turn}`)],
        ...(last ? { embeds: [buildResultEmbed(outcome, names)] } : {}),
      });
    }
  } catch (err) {
    console.warn("⚠️ battle playback stopped:", err?.message || err);
  }
}
