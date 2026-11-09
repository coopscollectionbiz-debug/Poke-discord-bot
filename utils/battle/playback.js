// ==========================================================
// utils/battle/playback.js
// "Watch it happen": posts a battle image in the channel, edits it once
// per turn (up to PLAYBACK.maxUpdates, spread evenly over longer battles),
// then shows the result image with a Battle rating embed. (/battle sends
// each player's EXP privately afterward.) Results are already saved before
// this runs; a failed edit just stops the replay. At most
// PLAYBACK.maxAtOnce replays run at once; the rest wait in line.
// Challenges replay here too: every fight of an Elite Four run plays on
// one message, holding one slot. Leaders are names, never <@mentions>.
// ==========================================================

import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { renderBattleFrame, pickFrameTurns } from "./render.js";
import { PLAYBACK } from "./tuning.js";
import { trainingKey } from "../training.js";
import { CHALLENGES, opponentName } from "../challenge/roster.js";
import { badgeEmoji } from "../challenge/badgeEmojis.js";

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

// Replays one fight on `message`, or on a new channel message when it's null:
// the start frame, one edit per turn, then the result frame with
// `finalEmbed`. A start frame that can't be posted throws; a later failed
// edit stops the replay and returns null. `fight` is { sides, surge,
// result, winnerId, exp }; `exp` sets the Levels on the result frame.
// `paceStart` holds the previous fight's result frame up for a full delay.
async function replayFight({ channel, message, heading, fight, names, sprites, maxUpdates, delayMs, finalEmbed, paceStart = false }) {
  const sides = fight.sides.map((s) => ({ name: names[s.userId], members: s.members }));
  const { snapshots, log, turns: total } = fight.result;
  const image = async (opts) => new AttachmentBuilder(
    await renderBattleFrame({ sides, surgeSide: fight.surge?.side ?? null, sprites, ...opts }),
    { name: "battle.gif" },
  );
  // Renders the next image during the wait, so rendering doesn't stretch the pace.
  const paced = async (render) => {
    const started = Date.now();
    const file = await render();
    await sleep(Math.max(0, delayMs - (Date.now() - started)));
    return file;
  };

  // In an Elite Four run, a Pokémon that fainted in an earlier fight can't lead off.
  const leads = sides.map((s, i) => s.members[snapshots[0][i].findIndex((hp) => hp > 0)]?.name).join(" and ");
  const startImage = () => image({ hpBefore: snapshots[0], screens: [["The battle begins!", `${leads} lead off.`]] });
  const start = { content: heading, files: [paceStart ? await paced(startImage) : await startImage()] };
  if (message) await message.edit(start);
  else message = await channel.send(start);
  try {
    let shown = 0;
    // A fight lost before anyone moves (0 turns) goes straight to the result.
    for (const turn of total ? pickFrameTurns(total, maxUpdates) : []) {
      const badge = turn - shown > 1 ? `TURNS ${shown + 1}–${turn}` : `TURN ${turn}`;
      const file = await paced(() => image({ hpBefore: snapshots[turn - 1], events: log[turn - 1], badge }));
      await message.edit({ files: [file] });
      shown = turn;
    }
    // The result image shows each Pokémon's new Level (green when it grew).
    const newLevel = new Map(Object.entries(fight.exp).flatMap(([userId, es]) => es.map((e) => [`${userId}/${e.key}`, e.toLevel])));
    const grownSides = fight.sides.map((s, i) => ({
      ...sides[i],
      members: s.members.map((m) => {
        const level = newLevel.get(`${s.userId}/${trainingKey(m.speciesId, m.variant)}`);
        return level > m.level ? { ...m, level, levelUp: true } : m;
      }),
    }));
    const file = await paced(() => image({
      sides: grownSides, hpBefore: snapshots[total], badge: "FINAL", winnerSide: winnerSideOf(fight), screens: resultScreens(fight, names),
    }));
    await message.edit({ files: [file], ...(finalEmbed && { embeds: [finalEmbed] }) });
    return message;
  } catch (err) {
    console.warn("⚠️ battle playback stopped:", err?.message || err);
    return null;
  }
}

// Waits for a replay slot. A replay that has to wait posts `heading` now,
// so the players are notified, and shows its place in line until a slot
// frees up. Resolves to { message, release }.
async function waitForSlot(channel, queue, heading) {
  let message = null;
  let placeShown = Promise.resolve();
  const showPlace = (n) => {
    const content = `${heading}\n⏳ Wow, lots of battles right now! You're #${n} in line.`;
    placeShown = placeShown
      .then(async () => {
        if (message) await message.edit({ content });
        else message = await channel.send({ content });
      })
      .catch(() => {});
  };
  const release = await queue.acquire(showPlace);
  await placeShown; // a late "in line" edit would otherwise cover the battle
  return { message, release };
}

// Sends a new channel message (a fresh message is what actually notifies
// the @mentioned players; edits never do) and replays the battle on it.
export async function playBattle(channel, outcome, names, { maxUpdates, delayMs, queue = replays } = PLAYBACK) {
  const { message, release } = await waitForSlot(channel, queue, header(outcome));
  try {
    await replayFight({
      channel, message, heading: header(outcome), fight: outcome, names, sprites: new Map(), maxUpdates, delayMs,
      finalEmbed: buildResultEmbed(outcome, names),
    });
  } finally {
    release(); // even a failed replay frees its slot
  }
}

// ==========================================================
// Challenges
// ==========================================================

const opponentOf = (outcome, key) => CHALLENGES[outcome.key].opponents.find((o) => o.key === key);
const isRun = (outcome) => CHALLENGES[outcome.key].kind === "elite4";

export function challengeNames(outcome, playerName) {
  const names = { [outcome.userId]: playerName };
  for (const f of outcome.fights) names[f.opponentKey] = opponentName(opponentOf(outcome, f.opponentKey));
  return names;
}

export function challengeHeader(outcome, i) {
  const player = `<@${outcome.userId}>`;
  const fight = outcome.fights[i];
  const opponent = opponentOf(outcome, fight.opponentKey);
  const intro = isRun(outcome)
    ? `⚔️ ${player} · Elite Four · ${opponent.name} (${i + 1} of ${CHALLENGES[outcome.key].opponents.length})`
    : `⚔️ ${player} challenges ${opponentName(opponent)}!`;
  return fight.surge ? `${intro}\n🔥 The crowd is behind ${player}! Underdog surge!` : intro;
}

// "Brock sprite, 2,500 CC, 1 stone, and 5 Dust". prize.sprites are in the
// challenge's opponent order.
export function prizeText(key, prize) {
  const n = (x) => x.toLocaleString("en-US");
  const sprites = prize.sprites.map((s, i) => {
    const name = CHALLENGES[key].opponents[i].name;
    return s.file ? `${name} sprite` : `${n(s.cc)} CC for owning every ${name} sprite`;
  });
  return list([...sprites, `${n(prize.cc)} CC`, plural(prize.stones, "stone"), `${n(prize.dust)} Dust`]);
}

export function buildChallengeEmbed(outcome, names) {
  const player = names[outcome.userId];
  const last = outcome.fights.at(-1);
  const lastOpponent = opponentOf(outcome, last.opponentKey);
  const { turns, endedBy } = last.result;
  const mvp = mvpOf(last);
  const title = isRun(outcome)
    ? (outcome.cleared ? `🏆 ${player} cleared the Elite Four!` : `The Elite Four run ends at ${lastOpponent.name}.`)
    : (outcome.cleared ? `🏆 ${player} defeated ${names[last.opponentKey]}!` : `${names[last.opponentKey]} wins!`);
  const badge = outcome.badge && CHALLENGES[outcome.badge].badge;
  const lines = [
    endedBy === "turnCap" && `Time ran out after **${turns}** turns, and ${names[last.winnerId]}'s Team had more HP left.`,
    mvp && `⭐ MVP: **${mvp.name}** with ${plural(mvp.kos, "knockout")}`,
    outcome.fights.some((f) => f.surge) && "🔥 Underdog surge!",
    isRun(outcome) && outcome.fights.map((f) => `${opponentOf(outcome, f.opponentKey).name} ${f.winnerId === outcome.userId ? "✓" : "✗"}`).join(" · "),
    badge && `🏅 ${badgeEmoji(outcome.badge)} Earned the ${badge.badge}!`,
    outcome.prize && `🎁 ${prizeText(outcome.key, outcome.prize)}`,
    outcome.unlocked === "elite4" && "🔓 The Elite Four is open!",
    outcome.unlocked === "blue" && "🔓 Blue is waiting.",
    // Never the amount: 10× a public loss would reveal the player's balance.
    !outcome.cleared && "💸 Lost 10% of their CC.",
  ].filter(Boolean);
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .addFields({ name: `EXP · ${player}`, value: expLines(outcome.exp[outcome.userId]) });
}

// Replays every fight of a challenge on one message, holding one replay
// slot throughout. Only the last fight's result frame shows the EXP, so
// level-ups show once, at the end.
export async function playChallenge(channel, outcome, names, { maxUpdates, delayMs, queue = replays } = PLAYBACK) {
  let { message, release } = await waitForSlot(channel, queue, challengeHeader(outcome, 0));
  try {
    const sprites = new Map();
    for (const [i, fight] of outcome.fights.entries()) {
      const last = i === outcome.fights.length - 1;
      const opts = {
        channel, message, heading: challengeHeader(outcome, i), names, sprites, maxUpdates, delayMs, paceStart: i > 0,
        fight: { ...fight, exp: last ? outcome.exp : {} },
        finalEmbed: last ? buildChallengeEmbed(outcome, names) : null,
      };
      // Only the first post can fail to appear; later fights edit a message that's already up.
      message = i === 0 ? await replayFight(opts) : await replayFight(opts).catch((err) => {
        console.warn("⚠️ challenge playback stopped:", err?.message || err);
        return null;
      });
      if (!message) break;
    }
  } finally {
    release(); // even a failed replay frees its slot
  }
}
