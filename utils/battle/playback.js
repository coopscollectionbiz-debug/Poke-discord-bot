// ==========================================================
// utils/battle/playback.js
// "Watch it happen": posts a battle image in the channel, edits it once
// per turn (up to PLAYBACK.maxUpdates, spread evenly over longer battles),
// then shows the result image with a Battle rating embed. (/battle sends
// each player's EXP privately afterward.) Every update has its own file
// name: battle-start.gif, battle-t<turn>.gif, battle-final.gif. Results are already saved before
// this runs; a failed edit just stops the replay. At most
// PLAYBACK.maxAtOnce replays run at once; the rest wait in line.
// Challenges replay here too, themed (the trainers, the opponent's type, the
// Badge) with an award screen on a first win: every fight of an Elite Four
// run plays on one message, holding a slot only while a fight plays (the
// Revive pick between fights can take a minute). Leaders are names, never
// <@mentions>. Trainer encounters replay here too, on their card
// (playEncounter), with both trainers' portraits and the Trainer's
// after-battle line.
// ==========================================================

import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { pickFrameTurns } from "./render.js";
import { PLAYBACK } from "./tuning.js";
import { trainingKey } from "../training.js";
import { CHALLENGES, opponentName, displaySprite } from "../challenge/roster.js";
import { threaded } from "../render/renderers.js";

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

// One Team member's EXP line in the private text summaries.
const expLine = (e) => `${e.name} ${e.toLevel > e.fromLevel ? `Lv ${e.fromLevel} → **${e.toLevel}**` : `Lv ${e.fromLevel}`} · +${e.gained} EXP`;

// One player's EXP, sent only to them: the result image shows level-ups but
// not how much EXP each Pokémon gained.
export function expSummary(outcome, userId, names) {
  const opponentId = outcome.sides.find((s) => s.userId !== userId).userId;
  return [`EXP from your battle with ${names[opponentId]}:`, ...outcome.exp[userId].map(expLine)].join("\n");
}

// A challenger's EXP lines, for the private message's text fallback.
export const challengeExpText = (outcome) => outcome.exp[outcome.userId].map(expLine).join("\n");

// The rating changes, plus (Wager battles) who took the pot, which neither
// the result image nor the header says. Everything else is on the image.
export function buildResultEmbed(outcome, names) {
  const embed = new EmbedBuilder().setColor(0xf1c40f);
  if (outcome.mode === "wager") embed.setDescription(`💰 ${names[outcome.winnerId]} takes the **${2 * outcome.stake} CC** pot!`);
  const entries = Object.entries(outcome.rating ?? {});
  if (!entries.length) {
    // Casual (open) battles are unrated.
    embed.addFields({ name: "Casual battle", value: `${names[outcome.winnerId]} wins! Unrated. For a rated battle: /battle ranked:True` });
    return embed;
  }
  const rating = entries
    .map(([userId, r]) => `${names[userId]} **${r.to}** ${r.to >= r.from ? "▲" : "▼"}${Math.abs(r.to - r.from)}`)
    .join("\n");
  embed.addFields({ name: "Ranked rating", value: rating });
  return embed;
}

/** The attachment name for one playback update: "start", a turn number, or "final". */
export const battleImageName = (step) => (typeof step === "number" ? `battle-t${step}.gif` : `battle-${step}.gif`);

function header(outcome) {
  const [c, d] = outcome.sides.map((s) => `<@${s.userId}>`);
  const intro = outcome.mode === "wager"
    ? `⚔️ ${c} vs ${d} — Wager battle for ${outcome.stake} CC each! Battle teams at Lv 50.`
    : outcome.mode === "ranked"
      ? `⚔️ ${c} challenged ${d} to a ranked battle! Battle teams at Lv 50.`
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
// `trainers` are each side's trainer files for the portraits. `theme`
// (challenges) styles every frame; `award` (challengeAward) adds its screen
// to the result frame, right after who won. `namePrefix` keeps file names
// unique when several fights replay on one message (an Elite Four run).
async function replayFight({ channel, message, heading, fight, names, sprites, maxUpdates, delayMs, finalEmbed, paceStart = false, trainers = [null, null], theme = null, award = null, namePrefix = "" }) {
  const sides = fight.sides.map((s) => ({ name: names[s.userId], members: s.members }));
  const { snapshots, log, turns: total } = fight.result;
  // Each update gets its own file name (battleImageName). With one shared
  // "battle.gif", a desktop client whose first load failed kept showing the
  // broken image for every later edit, result included.
  const image = async (step, opts) => new AttachmentBuilder(
    await threaded.battleFrame({ sides, surgeSide: fight.surge?.side ?? null, sprites, trainers, theme, ...opts }),
    { name: namePrefix + battleImageName(step) },
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
  const startImage = () => image("start", { hpBefore: snapshots[0], screens: [["The battle begins!", `${leads} lead off.`]] });
  const start = { content: heading, files: [paceStart ? await paced(startImage) : await startImage()] };
  if (message) await message.edit(start);
  else message = await channel.send(start);
  try {
    let shown = 0;
    // A fight lost before anyone moves (0 turns) goes straight to the result.
    for (const turn of total ? pickFrameTurns(total, maxUpdates) : []) {
      const badge = turn - shown > 1 ? `TURNS ${shown + 1}–${turn}` : `TURN ${turn}`;
      const file = await paced(() => image(turn, { hpBefore: snapshots[turn - 1], events: log[turn - 1], badge }));
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
    const screens = resultScreens(fight, names);
    if (award) screens.splice(1, 0, award.lines);
    const file = await paced(() => image("final", {
      sides: grownSides, hpBefore: snapshots[total], badge: "FINAL", winnerSide: winnerSideOf(fight), screens,
      ...(award && { theme: { ...theme, award: { screen: 1, badgeFile: award.badgeFile, title: award.title } } }),
    }));
    await message.edit({ files: [file], ...(finalEmbed && { embeds: [finalEmbed] }) });
    return message;
  } catch (err) {
    console.warn("⚠️ battle playback stopped:", err?.message || err);
    return null;
  }
}

// Waits for a replay slot. A replay that has to wait posts `heading` now
// (or edits it onto `message`), so the players are notified, and shows its
// place in line until a slot frees up. Resolves to { message, release }.
async function waitForSlot(channel, queue, heading, message = null) {
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
// `trainers` are the two sides' displayed trainer files (null: none).
export async function playBattle(channel, outcome, names, { maxUpdates, delayMs, queue = replays, trainers = [null, null] } = PLAYBACK) {
  const { message, release } = await waitForSlot(channel, queue, header(outcome));
  try {
    await replayFight({
      channel, message, heading: header(outcome), fight: outcome, names, sprites: new Map(), maxUpdates, delayMs, trainers,
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

// In a run, fight i > 0 also says what the break before it revived.
export function challengeHeader(outcome, i) {
  const player = `<@${outcome.userId}>`;
  const fight = outcome.fights[i];
  const opponent = opponentOf(outcome, fight.opponentKey);
  if (!isRun(outcome)) return `⚔️ ${player} challenges ${opponentName(opponent)}!`;
  const heading = `⚔️ ${player} · Elite Four · ${opponent.name} (${i + 1} of ${CHALLENGES[outcome.key].opponents.length})`;
  const pause = i > 0 && outcome.breaks?.[i - 1];
  if (!pause?.offered) return heading;
  return pause.slot === null
    ? `${heading}\n💊 No Pokémon was revived.`
    : `${heading}\n💊 ${player} revived ${fight.sides[0].members[pause.slot].name}!`;
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

// Who won, for a result shown without its final image (showRunResult).
function challengeTitle(outcome, names) {
  const player = names[outcome.userId];
  const last = outcome.fights.at(-1);
  if (isRun(outcome)) return outcome.cleared ? `🏆 ${player} cleared the Elite Four!` : `The Elite Four run ends at ${opponentOf(outcome, last.opponentKey).name}.`;
  return outcome.cleared ? `🏆 ${player} defeated ${names[last.opponentKey]}!` : `${names[last.opponentKey]} wins!`;
}

// The embed under the final image, like /battle's: only what the image
// doesn't say (who won, the MVP and level-ups are on it; EXP goes to the
// player privately). Null when there's nothing to add (a rematch win).
export function buildChallengeEmbed(outcome, names) {
  const badge = outcome.badge && CHALLENGES[outcome.badge].badge;
  const lines = [
    isRun(outcome) && outcome.fights.map((f) => `${opponentOf(outcome, f.opponentKey).name} ${f.winnerId === outcome.userId ? "✓" : "✗"}`).join(" · "),
    badge && `🏅 Earned the ${badge.badge}!`,
    outcome.prize && `🎁 ${prizeText(outcome.key, outcome.prize)}`,
    outcome.unlocked === "elite4" && "🔓 The Elite Four is open!",
    outcome.unlocked === "blue" && "🔓 Blue is waiting.",
    // Never the amount: 10× a public loss would reveal the player's balance.
    !outcome.cleared && "💸 Lost 10% of their CC.",
  ].filter(Boolean);
  // No Badge thumbnail: the result frame's award screen presents it.
  return lines.length ? new EmbedBuilder().setColor(0xf1c40f).setDescription(lines.join("\n")) : null;
}

const badgeFile = (b) => b.image.split("/").pop();

// Fight i's frames: the challenger's trainer (`trainer`, their displayed
// trainer file or null) and the opponent's, the opponent's type, and the
// Gym's Badge in the center pill.
export function challengeTheme(outcome, i, trainer) {
  const challenge = CHALLENGES[outcome.key];
  const opponent = opponentOf(outcome, outcome.fights[i].opponentKey);
  return { trainers: [trainer ?? null, displaySprite(opponent)], type: opponent.type, badgeFile: challenge.badge ? badgeFile(challenge.badge) : null };
}

// What a first win presents on the result frame: the Badge for a Gym, a
// title for the Elite Four, Blue and Red. Null for a rematch or a loss.
const TITLES = {
  elite4: ["ELITE FOUR CLEARED", (p) => `${p} cleared the Elite Four!`],
  blue: ["CHAMPION DEFEATED", (p) => `${p} beat Champion Blue for the first time!`],
  red: ["RED DEFEATED", (p) => `${p} beat Red for the first time!`],
};
export function challengeAward(outcome, playerName) {
  if (!outcome.cleared || !outcome.prize) return null;
  const badge = outcome.badge && CHALLENGES[outcome.badge].badge;
  if (badge) return { badgeFile: badgeFile(badge), title: badge.badge.toUpperCase(), lines: [`${playerName} received the ${badge.badge}!`, ""] };
  const [title, line] = TITLES[outcome.key];
  return { badgeFile: null, title, lines: [line(playerName), ""] };
}

// Replays fight i of a challenge on `message`, or on a new channel message
// when it's null, holding a replay slot for this fight only. `outcome` is a
// run's view so far, or the full Outcome for the last fight (`last`), whose
// result frame gets the EXP, any award, and the result embed. `trainer` is
// the challenger's displayed trainer file (null: an empty portrait). A first
// post that fails throws; a later failed edit stops the replay and returns null.
export async function playChallengeFight(channel, message, outcome, i, names, { last, maxUpdates, delayMs, queue = replays, trainer = null } = PLAYBACK) {
  const heading = challengeHeader(outcome, i);
  const { trainers, ...theme } = challengeTheme(outcome, i, trainer);
  const posted = message;
  const slot = await waitForSlot(channel, queue, heading, message);
  try {
    const replay = replayFight({
      channel, message: slot.message, heading, names, sprites: new Map(), maxUpdates, delayMs,
      // The previous fight's result frame stays up a full delay before this start frame replaces it.
      paceStart: posted !== null,
      fight: { ...outcome.fights[i], exp: last ? outcome.exp : {} },
      finalEmbed: last ? buildChallengeEmbed(outcome, names) : null,
      trainers,
      theme,
      award: last ? challengeAward(outcome, names[outcome.userId]) : null,
      // Several fights share one message, so each one's file names differ.
      namePrefix: outcome.fights.length > 1 ? `fight${i + 1}-` : "",
    });
    // Only the first post can fail to appear; later fights edit a message that's already up.
    return posted ? await replay.catch((err) => {
      console.warn("⚠️ challenge playback stopped:", err?.message || err);
      return null;
    }) : await replay;
  } finally {
    slot.release(); // even a failed replay frees its slot
  }
}

// A single-fight challenge's replay.
export const playChallenge = (channel, outcome, names, opts = PLAYBACK) =>
  playChallengeFight(channel, null, outcome, 0, names, { ...opts, last: true });

// While the player picks a Revive, the run's message says so under the header
// of the fight just played. Never throws.
export async function showChoosing(message, outcome, i) {
  try {
    await message.edit({ content: `${challengeHeader(outcome, i)}\n⏳ <@${outcome.userId}> is choosing a Pokémon to revive…` });
    return true;
  } catch {
    return false;
  }
}

// Puts a run's result on its message without replaying it: after a restart,
// or when the run stopped unexpectedly. Never throws.
export async function showRunResult(message, outcome, names, note) {
  try {
    // No final image here, so the embed also says who won.
    await message.edit({ content: note, embeds: [buildChallengeEmbed(outcome, names).setTitle(challengeTitle(outcome, names))] });
    return true;
  } catch {
    return false;
  }
}

// ==========================================================
// Trainer encounters
// ==========================================================

/** The player by display name, and the Trainer (side "trainer") as "Youngster Joey". */
export const encounterNames = (outcome, playerName) => ({
  [outcome.userId]: playerName,
  trainer: `${outcome.trainer.title} ${outcome.trainer.name}`,
});

// The result: the Trainer's after-battle line, then the Prize money on a
// win. Never the amount on a loss: a player who held less than the Prize
// money paid all they had, which would reveal it. It's the embed under the
// final image, then all the card keeps once the images go.
export function encounterSummary(outcome, names) {
  const player = names[outcome.userId];
  const said = outcome.won ? outcome.trainer.lines.lost : outcome.trainer.lines.won;
  const result = outcome.won ? `💰 ${player} got ${outcome.prize.toLocaleString("en-US")} CC for winning!` : `${player} whited out!`;
  return [`💬 ${names.trainer}: "${said}"`, result].join("\n");
}

export const buildEncounterEmbed = (outcome, names) => new EmbedBuilder().setColor(0xf1c40f).setDescription(encounterSummary(outcome, names));

// Replays the fight on the encounter card `message`, in place of the card
// image. No new message is needed to notify the player: they just pressed
// Battle! on it. `trainers` are the player's displayed trainer file (or null)
// and the Trainer's sprite. A start frame that can't be shown throws; a later
// failed edit stops the replay and returns null.
export async function playEncounter(channel, message, outcome, names, { maxUpdates, delayMs, queue = replays, trainers = [null, null] } = PLAYBACK) {
  const heading = `⚔️ <@${outcome.userId}> vs ${names.trainer}!`;
  const slot = await waitForSlot(channel, queue, heading, message);
  try {
    return await replayFight({
      channel, message: slot.message, heading, fight: outcome, names, sprites: new Map(), maxUpdates, delayMs, trainers,
      finalEmbed: buildEncounterEmbed(outcome, names),
    });
  } finally {
    slot.release(); // even a failed replay frees its slot
  }
}
