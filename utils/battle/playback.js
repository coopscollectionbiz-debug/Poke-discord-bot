// ==========================================================
// utils/battle/playback.js
// "Watch it happen": posts a battle image in the channel, edits it once
// per turn (up to PLAYBACK.maxUpdates, spread evenly over longer battles),
// then shows the result with the embed. Results are already saved before
// this runs; a failed edit just stops the replay.
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
export async function playBattle(channel, outcome, names, { maxUpdates, delayMs } = PLAYBACK) {
  const sides = outcome.sides.map((s) => ({ name: names[s.userId], members: s.members }));
  const { snapshots, log, turns: total, endedBy } = outcome.result;
  const image = async (opts) => new AttachmentBuilder(
    await renderBattleFrame({ sides, surgeSide: outcome.surge?.side ?? null, ...opts }),
    { name: "battle.gif" },
  );
  // Renders the next image during the wait, so rendering doesn't stretch the pace.
  const paced = async (render) => {
    const started = Date.now();
    const file = await render();
    await sleep(Math.max(0, delayMs - (Date.now() - started)));
    return file;
  };

  const leads = sides.map((s) => s.members[0]?.name).join(" and ");
  const message = await channel.send({
    content: header(outcome),
    files: [await image({ hpBefore: snapshots[0], text: ["The battle begins!", `${leads} lead off.`] })],
  });
  try {
    let shown = 0;
    for (const turn of pickFrameTurns(total, maxUpdates)) {
      const badge = turn - shown > 1 ? `TURNS ${shown + 1}–${turn}` : `TURN ${turn}`;
      const file = await paced(() => image({ hpBefore: snapshots[turn - 1], events: log[turn - 1], badge }));
      await message.edit({ files: [file] });
      shown = turn;
    }
    const winnerSide = outcome.sides.findIndex((s) => s.userId === outcome.winnerId);
    const file = await paced(() => image({
      hpBefore: snapshots[total],
      badge: "FINAL",
      winnerSide,
      text: [`${names[outcome.winnerId]} wins the battle!`, endedBy === "turnCap" ? "Turn limit reached: the Team with more HP left wins." : ""],
    }));
    await message.edit({ files: [file], embeds: [buildResultEmbed(outcome, names)] });
  } catch (err) {
    console.warn("⚠️ battle playback stopped:", err?.message || err);
  }
}
