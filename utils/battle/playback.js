// ==========================================================
// utils/battle/playback.js
// "Watch it happen": posts a battle image in the channel, edits it once
// per turn (up to PLAYBACK.maxUpdates, spread evenly over longer battles),
// then shows the result image with a Battle rating embed. (/battle sends
// each player's EXP privately afterward.) Results are already saved before
// this runs; a failed edit just stops the replay. At most
// PLAYBACK.maxAtOnce replays run at once; the rest wait in line.
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

// One player's EXP, sent only to them: the result image shows level-ups but
// not how much EXP each Pokémon gained.
export function expSummary(outcome, userId, names) {
  const opponentId = outcome.sides.find((s) => s.userId !== userId).userId;
  const lines = outcome.exp[userId].map((e) => {
    const level = e.toLevel > e.fromLevel ? `Lv ${e.fromLevel} → **${e.toLevel}**` : `Lv ${e.fromLevel}`;
    return `${e.name} ${level} · +${e.gained} EXP`;
  });
  return [`EXP from your battle with ${names[opponentId]}:`, ...lines].join("\n");
}

// The rating changes, plus (Wager battles) who took the pot, which neither
// the result image nor the header says. Everything else is on the image.
export function buildResultEmbed(outcome, names) {
  const embed = new EmbedBuilder().setColor(0xf1c40f);
  if (outcome.mode === "wager") embed.setDescription(`💰 ${names[outcome.winnerId]} takes the **${2 * outcome.stake} CC** pot!`);
  const entries = Object.entries(outcome.rating ?? {});
  if (!entries.length) {
    // Casual (open) battles are unrated.
    embed.addFields({ name: "Casual battle", value: `${names[outcome.winnerId]} wins! Casual battles don't change your Ranked rating. For a Ranked battle: /battle ranked:True` });
    return embed;
  }
  const rating = entries
    .map(([userId, r]) => `${names[userId]} **${r.to}** ${r.to >= r.from ? "▲" : "▼"}${Math.abs(r.to - r.from)}`)
    .join("\n");
  embed.addFields({ name: "Ranked rating", value: rating });
  return embed;
}

function header(outcome) {
  const [c, d] = outcome.sides.map((s) => `<@${s.userId}>`);
  const intro = outcome.mode === "wager"
    ? `⚔️ ${c} vs ${d} in a Wager battle for ${outcome.stake} CC each! Battle teams at Lv 50.`
    : outcome.mode === "ranked"
      ? `⚔️ ${c} challenged ${d} to a Ranked battle! Battle teams at Lv 50.`
      : `⚔️ ${c} challenged ${d}!`;
  if (!outcome.surge) return intro;
  return `${intro}\n🔥 The crowd is behind <@${outcome.sides[outcome.surge.side].userId}>! Underdog surge!`;
}

// First come, first served: at most `limit` holders at once. acquire()
// resolves to a release function; while waiting, onPlace(n) hears the
// caller's place in line each time it changes (1 = next).
export function createQueue(limit) {
  let running = 0;
  const waiting = [];
  const release = () => {
    running--;
    const next = waiting.shift();
    if (next) {
      running++;
      next.start();
    }
    waiting.forEach((w, i) => w.onPlace(i + 1));
  };
  return {
    acquire(onPlace = () => {}) {
      if (running < limit) {
        running++;
        return Promise.resolve(release);
      }
      return new Promise((resolve) => {
        waiting.push({ onPlace, start: () => resolve(release) });
        onPlace(waiting.length);
      });
    },
  };
}

// Rendering is what costs CPU and memory, so only the replay waits; the
// results were saved before playBattle runs.
const replays = createQueue(PLAYBACK.maxAtOnce);

// Sends a new channel message (a fresh message is what actually notifies
// the @mentioned players; edits never do) and replays the battle on it.
export async function playBattle(channel, outcome, names, { maxUpdates, delayMs, queue = replays } = PLAYBACK) {
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

  // A battle that has to wait posts its header now, so the players are
  // notified, and shows its place in line until a replay slot frees up.
  let message = null;
  let placeShown = Promise.resolve();
  const showPlace = (n) => {
    const content = `${header(outcome)}\n⏳ Lots of battles right now. You're #${n} in line.`;
    placeShown = placeShown
      .then(async () => {
        if (message) await message.edit({ content });
        else message = await channel.send({ content });
      })
      .catch(() => {});
  };
  const release = await queue.acquire(showPlace);
  try {
    await placeShown; // a late "in line" edit would otherwise cover the battle
    const leads = sides.map((s) => s.members[0]?.name).join(" and ");
    const start = {
      content: header(outcome),
      files: [await image({ hpBefore: snapshots[0], screens: [["The battle begins!", `${leads} lead off.`]] })],
    };
    if (message) await message.edit(start);
    else message = await channel.send(start);
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
  } finally {
    release(); // even a failed replay frees its slot
  }
}
