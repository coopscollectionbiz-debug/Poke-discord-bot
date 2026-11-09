// ==========================================================
// /challenge — fight Kanto's Gym Leaders, the Elite Four, Blue, and Red.
// With no opponent: a private progress board. With one: a private preview
// (prize, exact CC a loss costs) with Fight! and Not now. Nothing is held
// while the preview is open; Fight! re-checks everything under the lock,
// saves the result, then posts a public intro card and the replay. An Elite
// Four run plays one fight at a time, with a private Revive menu after each
// win; the run waits on the player's record (challenge.run) between fights.
// ==========================================================

import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionFlagsBits,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { logEvent } from "../utils/eventLog.js";
import { CHALLENGES, CHALLENGE_KEYS, opponentName, displaySprite } from "../utils/challenge/roster.js";
import {
  challengeBlock, previewChallenge, runChallenge, isUnlocked,
  startRun, continueRun, finishOpenRun, isRunStale, attachRunMessage,
} from "../utils/challenge/runChallenge.js";
import { badgeEmoji } from "../utils/challenge/badgeEmojis.js";
import { GYM_BADGES, earnedBadgeKeys } from "../public/picker-pokemon/badges.js";
import {
  playChallenge, playChallengeFight, showChoosing, showRunResult, challengeNames, prizeText,
} from "../utils/battle/playback.js";
import { utcDay } from "../utils/battle/rewards.js";
import { CHALLENGE, PLAYBACK } from "../utils/battle/tuning.js";
import { spritePaths } from "../spriteconfig.js";

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

export function refusal(reason, user) {
  return {
    no_team: "Set a Team on your dashboard first.",
    locked_elite4: `Earn all 8 Badges first. You have ${earnedBadgeKeys(user).length}.`,
    locked_blue: "Clear the Elite Four to challenge Blue.",
    cap: `You've used all ${CHALLENGE.perDay} challenges today. They reset at midnight UTC.`,
    pending_wager: "Finish your pending wager first.",
    no_perms: "I can't post challenges in this channel. Try another one.",
    settled: "This challenge already happened.",
    run_open: "Finish your Elite Four run first.",
  }[reason] ?? "That challenge can't happen right now.";
}

export function boardEmbed(user, now = new Date()) {
  const won = user.challenge?.won ?? {};
  const check = (key) => (key in won ? " ✅" : "");
  const missing = GYM_BADGES.length - earnedBadgeKeys(user).length;
  const lines = [
    ...GYM_BADGES.map((b) => `${badgeEmoji(b.key)} **${b.leader}** · ${b.type}${check(b.key)}`),
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

// `preview` is previewChallenge(user, key). The private preview shows the
// exact loss; the public intro card never does (10× it is the balance).
export function previewEmbed(key, preview, { exactLoss = false } = {}) {
  const challenge = CHALLENGES[key];
  const first = challenge.opponents[0];
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(challenge.kind === "elite4" ? "Elite Four" : opponentName(first))
    .setThumbnail(spritePaths.trainers + displaySprite(first));
  if (challenge.badge) embed.setDescription(`${badgeEmoji(key)} ${challenge.badge.badge}\n${challenge.badge.type}`);
  if (challenge.kind === "elite4") embed.setDescription(challenge.opponents.map((o) => o.name).join(" · "));
  return embed.addFields(
    { name: "Win", value: preview.prize ? prizeText(key, preview.prize) : "Rematch: EXP only" },
    { name: "Lose", value: exactLoss ? `${n(preview.loss)} CC (10% of your CC)` : "10% of their CC" },
  );
}

const privateResult = (outcome) => {
  if (!outcome.cleared) return `You lost ${n(outcome.ccLost)} CC.`;
  return outcome.prize ? `You won! 🎁 ${prizeText(outcome.key, outcome.prize)}` : "You won!";
};

const logChallenge = (userId, outcome, extra = {}) => logEvent("challenge", userId, {
  key: outcome.key, seed: outcome.seed, reached: outcome.fights.length, cleared: outcome.cleared, prize: !!outcome.prize, ccLost: outcome.ccLost,
  ...(outcome.breaks && { revives: outcome.breaks.map((b) => (b.offered ? b.slot : "none")) }),
  ...extra,
});

// A run with no step for CHALLENGE.staleRunMs stopped unexpectedly (its
// command hit an error). Finishes it with no Revives and saves; the run's
// message gets the result after the caller's reply, which has 3 seconds.
async function finishStaleRun({ trainerData, userId, lockUser, enqueueSave, client, playerName }) {
  const done = await lockUser(userId, async () => {
    const run = trainerData[userId]?.challenge?.run;
    if (!isRunStale(trainerData[userId])) return null;
    const outcome = finishOpenRun({ trainerData, userId });
    await enqueueSave(trainerData, { force: true });
    return { outcome, channelId: run.channelId, messageId: run.messageId };
  });
  if (!done) return;
  logChallenge(userId, done.outcome, { finished: "stale" });
  if (!done.messageId) return;
  (async () => {
    const channel = await client.channels.fetch(done.channelId);
    const message = await channel.messages.fetch(done.messageId);
    await showRunResult(message, done.outcome, challengeNames(done.outcome, playerName),
      `⚔️ <@${userId}>'s Elite Four run stopped unexpectedly and finished without Revives.`);
  })().catch(() => {});
}

const reviveMenu = (step) => {
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
// the player picks or CHALLENGE.pickMs passes. The collector stays open until
// the buttons are gone, so every click on them gets an answer.
async function askRevive(latest, step) {
  // bot_final's wrapper resolves to nothing when the reply window has expired.
  const menu = await latest.followUp(reviveMenu(step)).catch((err) => console.warn("⚠️ revive menu failed:", err?.message || err));
  if (!menu) return { slot: null, click: latest };
  return new Promise((resolve) => {
    let closed = null; // "picked" or "time"
    const collector = menu.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.customId.startsWith(`challenge_revive:${step.nonce}:`),
    });
    const timer = setTimeout(async () => {
      closed = "time";
      await latest.editReply({ message: menu, content: "No Pokémon was revived.", components: [] }).catch(() => {});
      collector.stop("time");
      resolve({ slot: null, click: latest });
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
      collector.stop("picked");
      resolve({ slot, click: i });
    });
  });
}

// Replays and drives an Elite Four run from its first Step to its end:
// replay the fight, offer a Revive if anything fainted, play the next fight.
// A replay that fails (a deleted message) stops only the replay. Resolves to
// { outcome, posted }, or null if the run was finished elsewhere meanwhile.
async function playRun({ channel, fightClick, step, trainerData, userId, lockUser, enqueueSave, playerName }) {
  let message = null;
  let replaying = true;
  let posted = true;
  let latest = fightClick;
  for (;;) {
    const shown = step.ended ? step.outcome : step.view;
    if (replaying) {
      const names = challengeNames(shown, playerName);
      const played = await playChallengeFight(channel, message, shown, step.step, names, { ...PLAYBACK, last: step.ended })
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
    if (step.ended) return { outcome: step.outcome, posted };
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

  // Finished first, so the board and the checks below see the result.
  if (isRunStale(trainerData[userId])) await finishStaleRun({ trainerData, userId, lockUser, enqueueSave, client, playerName });

  if (!key) return interaction.reply({ embeds: [boardEmbed(trainerData[userId] ?? {})], flags: MessageFlags.Ephemeral });
  if (interaction.appPermissions && !interaction.appPermissions.has(CHANNEL_PERMISSIONS)) return ephemeral(refusal("no_perms"));
  const early = challengeBlock({ trainerData, userId, key });
  if (early) return ephemeral(refusal(early, trainerData[userId]));

  // A loss never costs more than this preview shows, even if the balance grows before Fight!.
  const shown = previewChallenge(trainerData[userId], key);
  const nonce = randomUUID();
  const response = await interaction.reply({
    embeds: [previewEmbed(key, shown, { exactLoss: true })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`challenge_fight:${nonce}`).setLabel("Fight!").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`challenge_cancel:${nonce}`).setLabel("Not now").setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  });

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
      return i.update({ content: "Not now.", embeds: [], components: [] });
    }
    // Drop the buttons right away: the save below can wait behind another one.
    await i.update({ content: "⚔️ Your challenge is starting below.", embeds: [], components: [] });
    const isRun = key === "elite4";
    const first = await lockUser(userId, async () => {
      // Read the live record now: the dashboard or another command may have replaced it since the preview.
      const live = trainerData[userId];
      const atStake = live && previewChallenge(live, key);
      const seed = randomInt(0, 2 ** 31 - 1);
      const out = isRun
        ? startRun({ trainerData, userId, seed, maxLoss: shown.loss, channelId: interaction.channelId })
        : runChallenge({ trainerData, userId, key, seed, maxLoss: shown.loss });
      // Saved before the replay, so a failed or slow replay never changes the result.
      if (out.ok) await enqueueSave(trainerData, { force: true });
      return { ...out, atStake };
    });

    collector.stop("fought");
    if (!first.ok) {
      return i.editReply({ content: refusal(first.reason, trainerData[userId]), embeds: [], components: [] }).catch(() => {});
    }
    if (!isRun) logChallenge(userId, first);

    let posted = true;
    let outcome = first;
    try {
      await interaction.channel.send({ embeds: [previewEmbed(key, first.atStake)] });
    } catch (err) {
      console.warn("⚠️ challenge post failed:", err?.message || err);
      posted = false;
    }
    if (isRun) {
      // Played even when the intro card failed: the run is open and resolves through its Revives.
      const played = await playRun({
        channel: interaction.channel, fightClick: i, step: first, trainerData, userId, lockUser, enqueueSave, playerName,
      });
      if (!played) return; // a stale finish closed it and shows the result
      outcome = played.outcome;
      posted &&= played.posted;
      logChallenge(userId, outcome);
    } else if (posted) {
      await playChallenge(interaction.channel, outcome, challengeNames(outcome, playerName)).catch((err) => {
        console.warn("⚠️ challenge post failed:", err?.message || err);
        posted = false;
      });
    }
    const note = posted ? "" : "\nIt counted, but I couldn't post it in this channel.";
    await i.editReply({ content: `${privateResult(outcome)}${note}`, embeds: [], components: [] }).catch(() => {});
  });

  collector.on("end", (_, reason) => {
    if (reason === "time" && !settled) interaction.editReply({ content: "Preview expired.", embeds: [], components: [] }).catch(() => {});
  });
}
