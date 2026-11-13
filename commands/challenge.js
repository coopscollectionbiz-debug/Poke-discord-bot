// ==========================================================
// /challenge — fight Kanto's Gym Leaders, the Elite Four, Blue, and Red.
// With no opponent: a private progress board, whose dropdown opens the
// preview for whoever is picked. With one: a private preview
// (prize, exact CC a loss costs) with Fight! and Not now. Nothing is held
// while the preview is open; Fight! re-checks everything under the lock,
// saves the result, then posts a public intro card and the replay. An Elite
// Four run plays one fight at a time, with a private Revive menu after each
// win; the run waits on the player's record (challenge.run) between fights.
// ==========================================================

import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionFlagsBits, AttachmentBuilder, StringSelectMenuBuilder,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { logEvent } from "../utils/eventLog.js";
import { recordFight, challengeRecord } from "../utils/fightRecordBuild.js";
import { CHALLENGES, CHALLENGE_KEYS, opponentName, displaySprite } from "../utils/challenge/roster.js";
import {
  challengeBlock, previewChallenge, runChallenge, isUnlocked,
  startRun, continueRun, finishOpenRun, isRunStale, attachRunMessage, challengeLogEntry,
} from "../utils/challenge/runChallenge.js";
import { badgeUrl } from "../utils/challenge/badgeImages.js";
import { challengeCardView, cardAltText } from "../utils/render/challengeCard.js";
import { boardView, boardAltText } from "../utils/render/challengeBoard.js";
import { GYM_BADGES, earnedBadgeKeys } from "../public/picker-pokemon/badges.js";
import {
  playChallenge, playChallengeFight, showChoosing, showRunResult, challengeNames, prizeText, challengeExpText,
} from "../utils/battle/playback.js";
import { expMembers } from "../utils/render/expCard.js";
import { utcDay } from "../utils/battle/rewards.js";
import { CHALLENGE, PLAYBACK } from "../utils/battle/tuning.js";
import { spritePaths } from "../spriteconfig.js";
import { threaded } from "../utils/render/renderers.js";
import { cardImage } from "../utils/render/stage.js";
import { availablePicks } from "../utils/battle/runBattle.js";

export const data = new SlashCommandBuilder()
  .setName("challenge")
  .setDescription("Take on Kanto's Gym Leaders, the Elite Four, Blue, and Red")
  .addStringOption((o) =>
    o.setName("opponent")
      .setDescription("Who to challenge; leave empty to see your progress")
      .addChoices(...CHALLENGE_KEYS.map((key) => ({ name: CHALLENGES[key].label, value: key }))));

// The intro card and the replay are new channel messages.
const CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles,
];

const n = (x) => x.toLocaleString("en-US");

// /challenge works only in this channel when it's set (fly.toml in production,
// .env locally); unset, it works anywhere.
const challengeChannelId = () => process.env.CHALLENGE_CHANNEL_ID || null;

export function refusal(reason, user) {
  return {
    no_team: "Challenges use your Casual or Ranked team. Set one on the Teams page: run /dashboard.",
    locked_elite4: `Earn all 8 Badges first. You have ${earnedBadgeKeys(user).length}.`,
    locked_blue: "Clear the Elite Four to challenge Blue.",
    cap: `You've used all ${CHALLENGE.perDay} challenges today. They reset at midnight UTC.`,
    pending_wager: "Finish your pending wager first.",
    no_perms: "I can't post challenges in this channel. Try another one.",
    settled: "This challenge already happened.",
    run_open: "Finish your Elite Four run first.",
    wrong_channel: `Challenges happen in <#${challengeChannelId()}>.`,
  }[reason] ?? "That challenge can't happen right now.";
}

// The board in text: boardMessage sends it when the image can't render.
export function boardEmbed(user, now = new Date()) {
  const won = user.challenge?.won ?? {};
  const check = (key) => (key in won ? " ✅" : "");
  const missing = GYM_BADGES.length - earnedBadgeKeys(user).length;
  const lines = [
    ...GYM_BADGES.map((b) => `**${b.leader}** · ${b.type}${check(b.key)}`),
    isUnlocked(user, "elite4") ? `**Elite Four**${check("elite4")}`
      : `🔒 **Elite Four** · ${missing} more Badge${missing === 1 ? "" : "s"}`,
    isUnlocked(user, "blue") ? `**Blue**${check("blue")}` : "🔒 **Blue** · Clear the Elite Four",
    `**Red**${check("red")}`,
  ];
  const used = user.challenge?.day === utcDay(now) ? user.challenge.attempts : 0;
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Kanto challenges")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Challenges left today: ${CHALLENGE.perDay - used}/${CHALLENGE.perDay}` });
}

// The board as an image (utils/render/challengeBoard.js), or boardEmbed when
// it can't render. `user` may be null (no record yet).
export async function boardMessage(user, displayName, now = new Date(), { render = threaded.challengeBoard } = {}) {
  try {
    const view = boardView(user, { displayName, now });
    return { files: [new AttachmentBuilder(await render(view), { name: "board.png", description: boardAltText(view) })] };
  } catch (err) {
    console.warn("⚠️ challenge board render failed; sending the embed:", err?.message || err);
    return { embeds: [boardEmbed(user ?? {}, now)] };
  }
}

// How long the board's dropdown answers picks: under the 15 minutes its
// reply can still be edited, so it can be taken off the board at the end.
const BOARD_MS = 10 * 60 * 1000;

// The board's dropdown: everyone the player can challenge now, in board
// order (the Elite Four and Blue join once they open). A pick opens the
// same private preview as /challenge opponent:<pick>.
export function boardMenu(user, nonce) {
  const open = CHALLENGE_KEYS.filter((key) => isUnlocked(user ?? {}, key));
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`challenge_pick:${nonce}`)
    .setPlaceholder("Choose who to challenge")
    .addOptions(open.map((key) => ({ label: CHALLENGES[key].label, value: key }))));
}

// `preview` is previewChallenge(user, key). The private preview shows the
// exact loss; the public intro card never does (10× it is the balance).
// The VS card's fallback when it can't render.
export function previewEmbed(key, preview, { exactLoss = false } = {}) {
  const challenge = CHALLENGES[key];
  const first = challenge.opponents[0];
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(challenge.kind === "elite4" ? "Elite Four" : opponentName(first))
    .setThumbnail(spritePaths.trainers + displaySprite(first));
  if (challenge.badge) embed.setAuthor({ name: challenge.badge.badge, iconURL: badgeUrl(key) }).setDescription(challenge.badge.type);
  if (challenge.kind === "elite4") embed.setDescription(challenge.opponents.map((o) => o.name).join(" · "));
  return embed.addFields(
    { name: "Win", value: preview.prize ? prizeText(key, preview.prize) : "Rematch: EXP only" },
    { name: "Lose", value: exactLoss ? `${n(preview.loss)} CC (10% of your CC)` : "10% of their CC" },
  );
}

// The VS card's facts, or null when they can't be built. It runs under the
// lock before the fight is saved, so it must never throw there.
export function cardView(key, preview, user, displayName, pick = "casual") {
  try {
    return challengeCardView(key, preview, user, { displayName, pick });
  } catch (err) {
    console.warn("⚠️ challenge card view failed; sending the embed:", err?.message || err);
    return null;
  }
}

// The preview and the public intro: the VS card, or previewEmbed when it
// can't be built or rendered. `view` is challengeCardView(), built before the fight is
// saved so the intro shows the Badge still on the line. Only the private
// preview (exactLoss) says the amount, in text: the card itself goes public.
// Animated (idle trainers, the player's tier backdrop) when the render
// threads have room, else the still PNG (utils/render/stage.js cardImage).
export async function previewMessage(key, preview, view, { exactLoss = false, render = threaded.challengeCard } = {}) {
  try {
    if (!view) throw new Error("no card view");
    const card = await cardImage((animate) => render(view, { animate }), "challenge");
    return {
      ...(exactLoss && { content: `A loss costs you **${n(preview.loss)} CC**.` }),
      files: [new AttachmentBuilder(card.buffer, { name: card.name, description: cardAltText(view) })],
    };
  } catch (err) {
    console.warn("⚠️ challenge card render failed; sending the embed:", err?.message || err);
    return { embeds: [previewEmbed(key, preview, { exactLoss })] };
  }
}

const privateResult = (outcome) => {
  if (!outcome.cleared) return `You lost ${n(outcome.ccLost)} CC.`;
  return outcome.prize ? `You won! 🎁 ${prizeText(outcome.key, outcome.prize)}` : "You won!";
};

// After the replay the player gets /battle's private EXP card, captioned
// with the result (the exact CC lost, or the prize); text if it can't render.
// `user` is their record after the challenge.
export async function challengeExpMessage(outcome, names, user, { render = threaded.exp } = {}) {
  const caption = privateResult(outcome);
  try {
    const png = await render({
      opponent: CHALLENGES[outcome.key].kind === "elite4" ? "the Elite Four" : names[outcome.fights.at(-1).opponentKey],
      won: outcome.cleared,
      rating: null, // challenges never change Ranked rating
      surge: false,
      pot: 0,
      members: expMembers(outcome.exp[outcome.userId], user),
    });
    return { content: caption, files: [new AttachmentBuilder(png, { name: "exp.png" })], flags: MessageFlags.Ephemeral };
  } catch (err) {
    console.warn("⚠️ challenge EXP card render failed; sending text:", err?.message || err);
    return { content: `${caption}\n${challengeExpText(outcome)}`, flags: MessageFlags.Ephemeral };
  }
}

// The event log line, and the Fight record for Battle Records (never throws).
const logChallenge = (userId, outcome, extra, { playerName, trainerData }) => {
  logEvent("challenge", userId, { ...challengeLogEntry(outcome), ...extra });
  recordFight(() => challengeRecord(outcome, playerName, trainerData));
};

// How long a Revive menu still answers clicks after its pick or deadline.
const LATE_CLICKS_MS = 15 * 60 * 1000;

// Nonces of the runs this process is playing. A run's step can stay put for
// over CHALLENGE.staleRunMs while its replay waits in a long queue; only a run
// whose command died (a restart finishes all of those) may be finished as stale.
const playing = new Set();

// A run with no step for CHALLENGE.staleRunMs, and no command playing it,
// stopped unexpectedly. Finishes it with no Revives and saves; the run's
// message gets the result after the caller's reply, which has 3 seconds.
async function finishStaleRun({ trainerData, userId, lockUser, enqueueSave, client, playerName }) {
  const done = await lockUser(userId, async () => {
    const run = trainerData[userId]?.challenge?.run;
    if (!isRunStale(trainerData[userId]) || playing.has(run.nonce)) return null;
    const outcome = finishOpenRun({ trainerData, userId });
    await enqueueSave(trainerData, { force: true });
    return { outcome, channelId: run.channelId, messageId: run.messageId };
  });
  if (!done) return;
  logChallenge(userId, done.outcome, { finished: "stale" }, { playerName, trainerData });
  if (!done.messageId) return;
  (async () => {
    const channel = await client.channels.fetch(done.channelId);
    const message = await channel.messages.fetch(done.messageId);
    await showRunResult(message, done.outcome, challengeNames(done.outcome, playerName),
      `⚔️ <@${userId}>'s Elite Four run stopped unexpectedly and finished without Revives.`);
  })().catch(() => {});
}

// The private Revive menu for a Step with fainted Pokémon: one button each,
// up to 5 per row (all 6 can faint in a win on a double knockout).
export const reviveMenu = (step) => {
  const buttons = step.fainted.map((f) => new ButtonBuilder()
    .setCustomId(`challenge_revive:${step.nonce}:${step.step + 1}:${f.slot}`)
    .setLabel(`${f.name} Lv ${f.level}`)
    .setStyle(ButtonStyle.Success));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return {
    content: `Next: ${step.next.name} · ${step.next.type}\nPick a Pokémon to revive · ${CHALLENGE.pickMs / 1000} s`,
    components: rows,
    flags: MessageFlags.Ephemeral,
  };
};

// Sends the private Revive menu from `latest` (the newest click: each click
// has its own 15-minute reply window) and resolves to { slot, click } once
// the player picks or CHALLENGE.pickMs passes. The collector outlives the
// pick so every later click gets an answer: Discord shows "This interaction
// failed" for a click no collector hears, and the buttons stay up if the
// deadline edit fails (latest's reply window expired).
async function askRevive(latest, step) {
  // bot_final's wrapper resolves to nothing when the reply window has expired.
  const menu = await latest.followUp(reviveMenu(step)).catch((err) => console.warn("⚠️ revive menu failed:", err?.message || err));
  if (!menu) return { slot: null, click: latest };
  return new Promise((resolve) => {
    let closed = null; // "picked" or "time"
    const collector = menu.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.customId.startsWith(`challenge_revive:${step.nonce}:`),
      time: LATE_CLICKS_MS,
    });
    const timer = setTimeout(async () => {
      closed = "time";
      resolve({ slot: null, click: latest });
      await latest.editReply({ message: menu, content: "No Pokémon was revived.", components: [] }).catch(() => {});
    }, CHALLENGE.pickMs);
    collector.on("collect", async (i) => {
      // The menu already says what happened after a pick, so a second click just closes quietly.
      if (closed === "picked") return i.deferUpdate().catch(() => {});
      if (closed) return i.reply({ content: "Too late. No Pokémon was revived.", flags: MessageFlags.Ephemeral }).catch(() => {});
      closed = "picked";
      clearTimeout(timer);
      const slot = Number(i.customId.split(":").at(-1));
      const name = step.fainted.find((f) => f.slot === slot)?.name;
      await i.update({ content: `${name} revived.`, components: [] }).catch(() => {});
      resolve({ slot, click: i });
    });
  });
}

// Replays and drives an Elite Four run from its first Step to its end:
// replay the fight, offer a Revive if anything fainted, play the next fight.
// A replay that fails (a deleted message) stops only the replay. Resolves to
// { outcome, posted, latest } (latest: the newest click, whose reply window
// is freshest), or null if the run was finished elsewhere meanwhile.
async function playRun({ channel, fightClick, step, trainerData, userId, lockUser, enqueueSave, playerName, trainer, aura }) {
  let message = null;
  let replaying = true;
  let posted = true;
  let latest = fightClick;
  for (;;) {
    const shown = step.ended ? step.outcome : step.view;
    if (replaying) {
      const names = challengeNames(shown, playerName);
      const played = await playChallengeFight(channel, message, shown, step.step, names, { ...PLAYBACK, last: step.ended, trainer, aura })
        .catch((err) => {
          console.warn("⚠️ challenge post failed:", err?.message || err);
          posted = false;
          return null;
        });
      if (!played) replaying = false;
      else if (!message && !step.ended) {
        message = played;
        // So a restart or a stale finish can put the result on this message.
        await lockUser(userId, async () => {
          attachRunMessage(trainerData[userId], step.nonce, { channelId: channel.id, messageId: message.id });
          await enqueueSave(trainerData, { force: true });
        });
      }
    }
    if (step.ended) return { outcome: step.outcome, posted, latest };
    let slot;
    if (step.fainted.length) {
      if (replaying) await showChoosing(message, step.view, step.step);
      const answer = await askRevive(latest, step);
      slot = answer.slot;
      latest = answer.click;
    }
    const prev = step;
    step = await lockUser(userId, async () => {
      const next = continueRun({ trainerData, userId, nonce: prev.nonce, step: prev.step + 1, slot });
      if (next.ok) await enqueueSave(trainerData, { force: true });
      return next;
    });
    if (!step.ok) return null;
  }
}

export async function execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave, client) {
  const userId = interaction.user.id;
  const key = interaction.options.getString("opponent");
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const playerName = interaction.member?.displayName ?? interaction.user.username;
  const home = challengeChannelId();
  if (home && interaction.channelId !== home) return ephemeral(refusal("wrong_channel"));

  // Finished first, so the board and the checks below see the result.
  if (isRunStale(trainerData[userId])) await finishStaleRun({ trainerData, userId, lockUser, enqueueSave, client, playerName });

  if (key) return openPreview(interaction, key, { trainerData, lockUser, enqueueSave });

  const nonce = randomUUID();
  const board = await interaction.reply({
    ...(await boardMessage(trainerData[userId] ?? null, playerName)),
    components: [boardMenu(trainerData[userId], nonce)],
    flags: MessageFlags.Ephemeral,
  });
  const picks = board.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: BOARD_MS,
    filter: (i) => i.customId === `challenge_pick:${nonce}` && i.user.id === userId,
  });
  // Each pick is its own interaction, answered with its own preview; the board stays.
  picks.on("collect", async (pick) => {
    try {
      if (isRunStale(trainerData[userId])) await finishStaleRun({ trainerData, userId, lockUser, enqueueSave, client, playerName });
      await openPreview(pick, pick.values[0], { trainerData, lockUser, enqueueSave });
    } catch (err) {
      console.warn("⚠️ challenge pick failed:", err?.message || err);
    }
  });
  picks.on("end", () => interaction.editReply({ components: [] }).catch(() => {}));
}

// The private preview with Fight! and Not now, for /challenge opponent:<key>
// or a pick from the board's dropdown (`interaction` is then the pick).
async function openPreview(interaction, key, { trainerData, lockUser, enqueueSave }) {
  const userId = interaction.user.id;
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const playerName = interaction.member?.displayName ?? interaction.user.username;
  if (interaction.appPermissions && !interaction.appPermissions.has(CHANNEL_PERMISSIONS)) return ephemeral(refusal("no_perms"));
  const early = challengeBlock({ trainerData, userId, key });
  if (early) return ephemeral(refusal(early, trainerData[userId]));

  // A loss never costs more than this preview shows, even if the balance grows before Fight!.
  const shown = previewChallenge(trainerData[userId], key);
  const nonce = randomUUID();
  // Three-teams split: one button per team the player has set. The preview
  // card shows the Casual team (or Ranked when that's the only one).
  const picks = availablePicks(trainerData[userId]);
  const view = cardView(key, shown, trainerData[userId], playerName, picks[0]);
  // The animated VS card takes 2–4 s to render, past Discord's 3-second
  // answer window, so acknowledge first ("thinking…") and render after.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // The collector goes on the preview message itself (editReply returns it).
  // One made from an InteractionResponse listens on the message a dropdown
  // pick came from (the board), so Fight! would go unanswered (discord.js
  // 14.28, InteractionCollector).
  const response = await interaction.editReply({
    ...(await previewMessage(key, shown, view, { exactLoss: true })),
    components: [new ActionRowBuilder().addComponents(
      ...picks.map((p) => new ButtonBuilder().setCustomId(`challenge_fight_${p}:${nonce}`).setLabel(`Fight with ${p === "ranked" ? "Ranked" : "Casual"}`).setStyle(p === "ranked" ? ButtonStyle.Primary : ButtonStyle.Success)),
      new ButtonBuilder().setCustomId(`challenge_cancel:${nonce}`).setLabel("Not now").setStyle(ButtonStyle.Secondary),
    )],
  });
  if (!response) return; // bot_final's wrapper swallowed an expired interaction

  // Fight! runs here, after execute() has returned, so the bot's 25-second
  // command timeout can't overwrite the private result.
  let settled = false;
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: CHALLENGE.previewMs,
    filter: (i) => i.customId.endsWith(nonce),
  });

  collector.on("collect", async (i) => {
    // The first click claims the preview before any await, so a second click
    // (or the expiry) can never act on it, even while a Fight! is still saving.
    if (settled) return i.reply({ content: refusal("settled"), flags: MessageFlags.Ephemeral });
    settled = true;
    if (i.customId.startsWith("challenge_cancel")) {
      collector.stop("cancel");
      return i.update({ content: "Not now.", embeds: [], components: [], attachments: [] });
    }
    // Drop the buttons right away: the save below can wait behind another one.
    await i.update({ content: "⚔️ Your challenge is starting below.", embeds: [], components: [], attachments: [] });
    const isRun = key === "elite4";
    const pick = i.customId.startsWith("challenge_fight_ranked") ? "ranked" : "casual";
    const first = await lockUser(userId, async () => {
      // Read the live record now: the dashboard or another command may have replaced it since the preview.
      const live = trainerData[userId];
      const atStake = live && previewChallenge(live, key);
      // Built before the fight changes the record, so the intro shows the Badge still on the line.
      const card = live && cardView(key, atStake, live, playerName, pick);
      const seed = randomInt(0, 2 ** 31 - 1);
      const out = isRun
        ? startRun({ trainerData, userId, seed, maxLoss: shown.loss, channelId: interaction.channelId, pick })
        : runChallenge({ trainerData, userId, key, seed, maxLoss: shown.loss, pick });
      // Saved before the replay, so a failed or slow replay never changes the result.
      if (out.ok) await enqueueSave(trainerData, { force: true });
      return { ...out, atStake, card };
    });

    collector.stop("fought");
    if (!first.ok) {
      return i.editReply({ content: refusal(first.reason, trainerData[userId]), embeds: [], components: [] }).catch(() => {});
    }
    if (!isRun) logChallenge(userId, first, {}, { playerName, trainerData });

    let posted = true;
    let outcome = first;
    let reply = i; // where the private result goes
    const trainer = first.card?.player.trainerFile ?? null; // the replay's portrait, as on the intro card
    const aura = first.card?.player.tier; // and its Aura, as on the intro card
    try {
      await interaction.channel.send(await previewMessage(key, first.atStake, first.card));
    } catch (err) {
      console.warn("⚠️ challenge post failed:", err?.message || err);
      posted = false;
    }
    if (isRun) {
      // Played even when the intro card failed: the run is open and resolves through its Revives.
      playing.add(first.nonce);
      const played = await playRun({
        channel: interaction.channel, fightClick: i, step: first, trainerData, userId, lockUser, enqueueSave, playerName, trainer, aura,
      }).finally(() => playing.delete(first.nonce));
      if (!played) return; // a stale finish closed it and shows the result
      outcome = played.outcome;
      posted &&= played.posted;
      reply = played.latest;
      logChallenge(userId, outcome, {}, { playerName, trainerData });
    } else if (posted) {
      await playChallenge(interaction.channel, outcome, challengeNames(outcome, playerName), { ...PLAYBACK, trainer, aura }).catch((err) => {
        console.warn("⚠️ challenge post failed:", err?.message || err);
        posted = false;
      });
    }
    // As /battle does: a failed post says so on the "starting below" message,
    // and the result and EXP card arrive as a new private message.
    if (!posted) await i.editReply({ content: "Your challenge counted, but I couldn't post it in this channel.", embeds: [], components: [] }).catch(() => {});
    await reply.followUp(await challengeExpMessage(outcome, challengeNames(outcome, playerName), trainerData[userId]))
      .catch((err) => console.warn("⚠️ challenge result message failed:", err?.message || err));
  });

  collector.on("end", (_, reason) => {
    if (reason === "time" && !settled) interaction.editReply({ content: "Preview expired.", embeds: [], components: [], attachments: [] }).catch(() => {});
  });
}
