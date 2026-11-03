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
import { trainingKey } from "../training.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = (items) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const winnerSideOf = (outcome) => outcome.sides.findIndex((s) => s.userId === outcome.winnerId);

// The winner's Pokémon with the most knockouts (the earlier one on a tie).
function mvpOf(outcome) {
  const side = winnerSideOf(outcome);
  const counts = new Map();
  for (const k of outcome.result.knockouts) if (k.bySide === side) counts.set(k.bySlot, (counts.get(k.bySlot) ?? 0) + 1);
  if (!counts.size) return null;
  const [slot, kos] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return { name: outcome.sides[side].members[slot].name, kos };
}

// The result image's text box, like the games' end-of-battle messages:
// who won and the MVP, then any level-ups and new moves.
export function resultScreens(outcome, names) {
  const winner = names[outcome.winnerId];
  const loser = names[outcome.sides[1 - winnerSideOf(outcome)].userId];
  const mvp = mvpOf(outcome);
  const screens = [[
    outcome.result.endedBy === "turnCap" ? `Time's up! ${winner} wins on HP left.` : `${winner} defeated ${loser}!`,
    mvp ? `${mvp.name} was the MVP with ${plural(mvp.kos, "knockout")}!` : "",
  ]];
  const ups = Object.values(outcome.exp).flat().filter((e) => e.toLevel > e.fromLevel);
  if (ups.length) {
    const grew = [...Map.groupBy(ups, (e) => e.toLevel)]
      .map(([level, es]) => `${list(es.map((e) => e.name))} grew to Lv${level}!`).join(" ");
    const learned = ups.filter((e) => e.learned.length).map((e) => `${e.name} learned ${list(e.learned)}!`).join(" ");
    screens.push([grew, learned]);
  }
  return screens;
}

function expLines(entries) {
  return entries.slice(0, 6).map((e) => {
    if (e.toLevel === e.fromLevel) return `${e.name} Lv ${e.fromLevel} · +${e.gained} EXP`;
    const learned = e.learned.length ? ` · learned **${list(e.learned)}**` : "";
    return `⬆️ **${e.name}** Lv ${e.fromLevel} → **${e.toLevel}**${learned}`;
  }).join("\n") || "—";
}

export function buildResultEmbed(outcome, names) {
  const side = winnerSideOf(outcome);
  const winner = names[outcome.winnerId];
  const { turns, endedBy } = outcome.result;
  const mvp = mvpOf(outcome);
  const lines = [
    endedBy === "turnCap" && `Time ran out after **${turns}** turns, and ${winner}'s Team had more HP left.`,
    mvp && `⭐ MVP: **${mvp.name}** with ${plural(mvp.kos, "knockout")}`,
    outcome.surge && "🔥 Underdog surge!",
    outcome.mode === "wager" && `💰 ${winner} takes the **${2 * outcome.stake} CC** pot!`,
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🏆 ${winner} defeated ${names[outcome.sides[1 - side].userId]}!`)
    .setDescription(lines.join("\n"));
  for (const [userId, entries] of Object.entries(outcome.exp)) {
    embed.addFields({ name: `EXP · ${names[userId]}`, value: expLines(entries) });
  }
  const rating = Object.entries(outcome.rating)
    .map(([userId, r]) => `${names[userId]} **${r.to}** ${r.to >= r.from ? "▲" : "▼"}${Math.abs(r.to - r.from)}`)
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
  const { snapshots, log, turns: total } = outcome.result;
  const sprites = new Map(); // each sprite GIF is read once per battle
  const image = async (opts) => new AttachmentBuilder(
    await renderBattleFrame({ sides, surgeSide: outcome.surge?.side ?? null, sprites, ...opts }),
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
    files: [await image({ hpBefore: snapshots[0], screens: [["The battle begins!", `${leads} lead off.`]] })],
  });
  try {
    let shown = 0;
    for (const turn of pickFrameTurns(total, maxUpdates)) {
      const badge = turn - shown > 1 ? `TURNS ${shown + 1}–${turn}` : `TURN ${turn}`;
      const file = await paced(() => image({ hpBefore: snapshots[turn - 1], events: log[turn - 1], badge }));
      await message.edit({ files: [file] });
      shown = turn;
    }
    // The result image shows each Pokémon's new Level (green when it grew).
    const newLevel = new Map(Object.entries(outcome.exp).flatMap(([userId, es]) => es.map((e) => [`${userId}/${e.key}`, e.toLevel])));
    const grownSides = outcome.sides.map((s, i) => ({
      ...sides[i],
      members: s.members.map((m) => {
        const level = newLevel.get(`${s.userId}/${trainingKey(m.speciesId, m.variant)}`);
        return level > m.level ? { ...m, level, levelUp: true } : m;
      }),
    }));
    const file = await paced(() => image({
      sides: grownSides, hpBefore: snapshots[total], badge: "FINAL", winnerSide: winnerSideOf(outcome), screens: resultScreens(outcome, names),
    }));
    await message.edit({ files: [file], embeds: [buildResultEmbed(outcome, names)] });
  } catch (err) {
    console.warn("⚠️ battle playback stopped:", err?.message || err);
  }
}
