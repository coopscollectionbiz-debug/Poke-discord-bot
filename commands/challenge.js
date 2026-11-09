// ==========================================================
// /challenge — fight Kanto's Gym Leaders, the Elite Four, Blue, and Red.
// With no opponent: a private progress board. With one: a private preview
// (prize, exact CC a loss costs) with Fight! and Not now. Nothing is held
// while the preview is open; Fight! re-checks everything under the lock,
// saves the result, then posts a public intro card and the replay.
// ==========================================================

import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionFlagsBits,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { logEvent } from "../utils/eventLog.js";
import { CHALLENGES, CHALLENGE_KEYS, opponentName, displaySprite } from "../utils/challenge/roster.js";
import { challengeBlock, previewChallenge, runChallenge, isUnlocked } from "../utils/challenge/runChallenge.js";
import { badgeEmoji } from "../utils/challenge/badgeEmojis.js";
import { GYM_BADGES, earnedBadgeKeys } from "../public/picker-pokemon/badges.js";
import { playChallenge, challengeNames, prizeText } from "../utils/battle/playback.js";
import { utcDay } from "../utils/battle/rewards.js";
import { CHALLENGE } from "../utils/battle/tuning.js";
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

export async function execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave) {
  const userId = interaction.user.id;
  const key = interaction.options.getString("opponent");
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

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
    if (i.customId.startsWith("challenge_cancel")) {
      if (settled) return i.followUp({ content: refusal("settled"), flags: MessageFlags.Ephemeral });
      settled = true;
      collector.stop("cancel");
      return i.update({ content: "Not now.", embeds: [], components: [] });
    }
    await i.deferUpdate();
    const outcome = await lockUser(userId, async () => {
      if (settled) return { ok: false, reason: "settled" };
      settled = true;
      // Read the live record now: the dashboard or another command may have replaced it since the preview.
      const live = trainerData[userId];
      const atStake = live && previewChallenge(live, key);
      const out = runChallenge({ trainerData, userId, key, seed: randomInt(0, 2 ** 31 - 1), maxLoss: shown.loss });
      // Saved before the replay, so a failed or slow replay never changes the result.
      if (out.ok) await enqueueSave(trainerData, { force: true });
      return { ...out, atStake };
    });

    if (outcome.reason === "settled") return i.followUp({ content: refusal("settled"), flags: MessageFlags.Ephemeral });
    collector.stop("fought");
    if (!outcome.ok) {
      return i.editReply({ content: refusal(outcome.reason, trainerData[userId]), embeds: [], components: [] }).catch(() => {});
    }
    await i.editReply({ content: privateResult(outcome), embeds: [], components: [] }).catch(() => {});

    logEvent("challenge", userId, {
      key, seed: outcome.seed, reached: outcome.fights.length, cleared: outcome.cleared, prize: !!outcome.prize, ccLost: outcome.ccLost,
    });
    const playerName = interaction.member?.displayName ?? interaction.user.username;
    try {
      await interaction.channel.send({ embeds: [previewEmbed(key, outcome.atStake)] });
      await playChallenge(interaction.channel, outcome, challengeNames(outcome, playerName));
    } catch (err) {
      console.warn("⚠️ challenge post failed:", err?.message || err);
      await i.editReply({ content: `${privateResult(outcome)}\nIt counted, but I couldn't post it in this channel.`, embeds: [], components: [] })
        .catch(() => {});
    }
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") interaction.editReply({ content: "Preview expired.", embeds: [], components: [] }).catch(() => {});
  });
}
