// ==========================================================
// /battle — challenge another trainer to an automatic Battle.
// Casual (default): Casual teams at real Levels, unrated, runs immediately.
// Past 3 casual battles against one Defender in a day, the next needs the
// Defender to accept a Rematch request (the rematch flow below).
// Ranked (ranked:True): Ranked teams at Lv 50, rated, runs immediately.
// Wager: Ranked teams at Lv 50, rated; the Defender must accept first
// (see the wager flow below).
// ==========================================================

import { auraLook } from "../services/auras.js";
import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionFlagsBits,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { logEvent } from "../utils/eventLog.js";
import { recordFight, battleRecord } from "../utils/fightRecordBuild.js";
import { battleBlock, buildBattleTeam, runBattle, withBothLocks, teamFor } from "../utils/battle/runBattle.js";
import { rankedRecord, utcDay } from "../utils/battle/rewards.js";
import { vsSide, battleVsAltText } from "../utils/render/battleVsCard.js";
import { trainerTier, cardTrainerFx } from "../utils/render/trainerTier.js";
import { playBattle, expSummary } from "../utils/battle/playback.js";
import { teamPower } from "../utils/battle/power.js";
import { offerWager, attachMessage, refundWager, acceptStake } from "../utils/battle/wager.js";
import { WAGER, REMATCH, PLAYBACK } from "../utils/battle/tuning.js";
import { openRematch, attachRematchMessage, settleRematch, blockRematch, liftRematchBlock } from "../utils/battle/rematch.js";
import { peekNotices, clearNotices, NOTICE_KINDS } from "../services/notices.js";
import { expView } from "../utils/render/expCard.js";
import { cardImage } from "../utils/render/stage.js";
import { shardDropLine } from "../services/megaShards.js";
import { threaded } from "../utils/render/renderers.js";

export const data = new SlashCommandBuilder()
  .setName("battle")
  .setDescription("Battle another trainer's Team")
  .addUserOption((o) => o.setName("opponent").setDescription("Who to battle").setRequired(true))
  .addBooleanOption((o) =>
    o.setName("ranked").setDescription("Ranked: Ranked teams at Lv 50, changes your Ranked rating"))
  .addIntegerOption((o) =>
    o.setName("wager").setDescription("CC each of you puts in the pot (they must accept). Always ranked").setMinValue(1));

// Battles and wager offers are posted as new channel messages.
const CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles,
];

// Casual battles (and so Rematch requests) work only in this channel when
// it's set (/etc/pokebot.env in production, .env locally), keeping them out of
// #general. Ranked and wager battles work anywhere. Unset, casual works anywhere too.
const casualChannelId = () => process.env.CASUAL_BATTLE_CHANNEL_ID || null;

export function refusal(reason, opponentId) {
  return {
    wrong_channel: `Casual battles happen in <#${casualChannelId()}>. Ranked and wager battles work anywhere.`,
    self: "You can't battle yourself.",
    bot: "You can't battle a bot.",
    no_perms: "I can't post battles in this channel. Try another one.",
    no_team_challenger: "Set a Team on your dashboard before battling.",
    no_team_defender: `<@${opponentId}> hasn't set a team yet.`,
    no_battle_team_challenger: "Ranked and wager battles use your Ranked team. Set it on the Teams page: run /dashboard.",
    no_battle_team_defender: `<@${opponentId}> hasn't set a Ranked team yet, so you can't play a ranked or wager battle with them.`,
    short_battle_team_challenger: "Ranked and wager battles need a full Ranked team of 6. Fill it on the Teams page: run /dashboard.",
    short_battle_team_defender: `<@${opponentId}>'s Ranked team isn't full (6 Pokémon), so you can't play a ranked or wager battle with them.`,
    // Only ranked and wager battles are refused at the Battle cap.
    cap_daily: "You've used all 10 battles for today. Battles reset at midnight UTC. Casual battles still run, but earn no EXP.",
    cap_opponent: `You've battled <@${opponentId}> 3 times today. Try someone else, or ask them for a casual rematch with /battle. It earns no EXP.`,
    defender_cap_daily: `<@${opponentId}> has no battles left today.`,
    defender_cap_opponent: "You two have battled 3 times today.",
    wager_new_account_challenger: "Wager battles need a Discord account at least 7 days old.",
    wager_new_account_defender: `<@${opponentId}>'s Discord account is under 7 days old, so they can't play a wager battle yet.`,
    wager_dex_challenger: "Wager battles unlock once you've registered 25 Pokémon in your Pokédex.",
    wager_dex_defender: `<@${opponentId}> hasn't registered 25 Pokémon yet, so they can't play a wager battle.`,
    insufficient_cc: "You don't have that much CC.",
    pending_exists: "You already have a wager waiting for an answer.",
    post_failed: "I couldn't post the wager here, so your Stake was refunded.",
    rematch_blocked: `<@${opponentId}> didn't accept your last rematch request. You can ask again after midnight UTC, or once they challenge you.`,
    rematch_pending: `You already asked <@${opponentId}> for a rematch. Wait for their answer.`,
    rematch_post_failed: "I couldn't post the rematch request here. Try another channel.",
  }[reason] ?? "That battle can't happen right now.";
}

export function displayNames(interaction, opponent) {
  return {
    [interaction.user.id]: interaction.member?.displayName ?? interaction.user.username,
    [opponent.id]: interaction.options.getMember("opponent")?.displayName ?? opponent.username,
  };
}

// A player's EXP goes in a message only they can see, sent once the replay
// ends so it doesn't show level-ups early. Discord accepts follow-ups for 15
// minutes after the interaction, so a Challenger whose Wager was accepted
// near the end of the offer window can miss theirs; the EXP still counts.
// The message is a rendered EXP card (utils/render/expCard.js) under a
// one-line caption; if rendering fails, the plain-text summary goes instead.
export async function expMessage(outcome, userId, names, user, { render = threaded.exp } = {}) {
  const text = expSummary(outcome, userId, names);
  const shards = shardDropLine(outcome.megaShards?.[userId] ?? 0); // "" unless a Mega Shard dropped
  const withShards = (s) => (shards ? `${s}\n${shards}` : s);
  try {
    const view = expView(outcome, userId, names, user);
    const card = await cardImage((animate) => render(view, { animate }), "exp");
    return { content: withShards(text.split("\n")[0]), files: [new AttachmentBuilder(card.buffer, { name: card.name })], flags: MessageFlags.Ephemeral };
  } catch (err) {
    console.warn("⚠️ EXP card render failed; sending text:", err?.message || err);
    return { content: withShards(text), flags: MessageFlags.Ephemeral };
  }
}

// Each side's displayed trainer, for the replay's portraits.
export const trainersOf = (trainerData, outcome) => outcome.sides.map((s) => trainerData[s.userId]?.displayedTrainer ?? null);
/** Both players' equipped Aura looks, in side order. */
export const aurasOf = (trainerData, outcome) => outcome.sides.map((s) => auraLook(trainerData[s.userId]));

/**
 * A player's record for the VS card, read (never created) before the battle
 * changes it: casual W–L and streak, or for a rated mode (Ranked, Wager)
 * this season's Ranked rating, W–L and win streak.
 */
export function vsRecord(user, mode) {
  if (mode === "open") {
    const c = user?.casual ?? {};
    return { wins: c.wins ?? 0, losses: c.losses ?? 0, streak: c.streak ?? 0 };
  }
  const r = rankedRecord(user);
  return { ...r, streak: r.wins + r.losses > 0 ? Number(user?.stats?.winStreak) || 0 : 0 };
}

/** Both players' records before the battle, by user id. */
export const vsRecords = (trainerData, ids, mode) => Object.fromEntries(ids.map((id) => [id, vsRecord(trainerData[id], mode)]));

/**
 * The VS card's view (utils/render/battleVsCard.js). `sides` are
 * [{ userId, members }] in Challenger, Defender order; `records` from
 * vsRecords; `pot` the Wager pot in CC.
 */
export function vsView(mode, sides, names, trainerData, records, pot = null) {
  return {
    mode,
    pot: mode === "wager" ? pot : null,
    sides: sides.map((s) => {
      const file = trainerData[s.userId]?.displayedTrainer ?? null;
      return vsSide({ name: names[s.userId], trainerFile: file, tier: auraLook(trainerData[s.userId]), members: s.members, record: records[s.userId] ?? vsRecord(null, mode) });
    }),
  };
}

// The replay's VS card, from the records captured before the battle (none: no card).
const vsOf = (outcome, names, trainerData) => (outcome.vsRecords
  ? vsView(outcome.mode, outcome.sides, names, trainerData, outcome.vsRecords, outcome.mode === "wager" ? 2 * outcome.stake : null)
  : null);

async function sendExp(reply, outcome, userId, names, user) {
  return reply.followUp(await expMessage(outcome, userId, names, user))
    .catch((err) => console.warn("⚠️ EXP message failed:", err?.message || err));
}

export async function execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave) {
  try {
    await executeBattle(interaction, trainerData, lockUser, enqueueSave);
  } finally {
    await sendPendingNotices(interaction, trainerData, lockUser, enqueueSave);
  }
}

/**
 * One-time Battle team notices (services/notices.js), e.g. "Dialga was
 * removed from your Battle team" after a re-tier. Sent as an ephemeral
 * follow-up to whatever /battle replied, then cleared. Kept if sending fails.
 */
export async function sendPendingNotices(interaction, trainerData, lockUser, enqueueSave, kind = NOTICE_KINDS.BATTLE_TEAM_TRIM) {
  const id = interaction.user.id;
  const pending = peekNotices(trainerData[id], kind);
  if (!pending.length || !(interaction.replied || interaction.deferred)) return;
  try {
    await interaction.followUp({ content: pending.map((n) => `ℹ️ ${n.text}`).join("\n"), flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.warn("⚠️ battle notice follow-up failed:", err?.message || err);
    return;
  }
  await lockUser(id, async () => {
    if (clearNotices(trainerData[id], pending.map((n) => n.id))) await enqueueSave(trainerData);
  });
}

async function executeBattle(interaction, trainerData, lockUser, enqueueSave) {
  const opponent = interaction.options.getUser("opponent", true);
  const wager = interaction.options.getInteger("wager");
  const challengerId = interaction.user.id;
  const refuse = (reason) => interaction.reply({ content: refusal(reason, opponent.id), flags: MessageFlags.Ephemeral });

  if (opponent.bot) return refuse("bot");
  if (interaction.appPermissions && !interaction.appPermissions.has(CHANNEL_PERMISSIONS)) return refuse("no_perms");

  const mode = wager != null ? "wager" : interaction.options.getBoolean("ranked") ? "ranked" : "open";
  const casualHome = casualChannelId();
  if (mode === "open" && casualHome && interaction.channelId !== casualHome) return refuse("wrong_channel");
  const early = battleBlock({ trainerData, challengerId, defenderId: opponent.id, mode });
  if (early && early !== "rematch_needed") return refuse(early);
  if (mode === "wager") return offer(interaction, trainerData, lockUser, enqueueSave, opponent, wager);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (early === "rematch_needed") return requestRematch(interaction, trainerData, lockUser, enqueueSave, opponent);
  const seed = randomInt(0, 2 ** 31 - 1);
  const outcome = await withBothLocks(lockUser, challengerId, opponent.id, async () => {
    const before = vsRecords(trainerData, [challengerId, opponent.id], mode); // for the VS card
    const out = runBattle({ trainerData, challengerId, defenderId: opponent.id, mode, seed });
    if (out.ok) out.vsRecords = before;
    // Results are applied and saved before the replay, so a failed or slow
    // replay never changes them. (A hard crash before the next Discord backup
    // can still lose them, like any other action: startup loads that backup.)
    if (out.ok) await enqueueSave(trainerData, { force: true });
    return out;
  });
  // Two quick /battles at 2 of 3: the second finds the first's battle here, under the locks.
  if (outcome.reason === "rematch_needed") return requestRematch(interaction, trainerData, lockUser, enqueueSave, opponent);
  if (!outcome.ok) return interaction.editReply(refusal(outcome.reason, opponent.id));

  logEvent("battle", challengerId, {
    defenderId: opponent.id, mode, seed, winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
  });
  const names = displayNames(interaction, opponent);
  recordFight(() => battleRecord(outcome, names, trainerData)); // Battle Records; never throws
  await interaction.editReply(startReply(outcome.overCap));
  // The replay (up to PLAYBACK.maxUpdates images, PLAYBACK.delayMs apart) runs
  // after the command returns, as wager battles' do, so a long battle never
  // trips the command timeout. The EXP card still follows the replay.
  replayThenExp(interaction, outcome, challengerId, names, trainerData);
}

// The Challenger's reply once a casual or ranked battle has run. Past the
// daily Battle cap (`overCap`, from runBattle) a casual battle earns no EXP.
// Past the per-Defender cap it never gets here: it needs a Rematch request.
function startReply(overCap) {
  const start = "⚔️ Your battle is starting below.";
  return overCap === "daily" ? `${start} You've used all 10 battles for today, so this one earns no EXP.` : start;
}

/**
 * The replay, then the Challenger's private EXP card (only they earn EXP in
 * casual and ranked battles; none past the Battle cap, so no card). Never throws.
 */
export async function replayThenExp(interaction, outcome, challengerId, names, trainerData, { play = playBattle, exp = sendExp } = {}) {
  try {
    await play(interaction.channel, outcome, names, { ...PLAYBACK, trainers: trainersOf(trainerData, outcome), auras: aurasOf(trainerData, outcome), vs: vsOf(outcome, names, trainerData) });
  } catch (err) {
    console.warn("⚠️ battle post failed:", err?.message || err);
    await interaction.editReply("Your battle counted, but I couldn't post it in this channel.").catch(() => {});
  }
  if (outcome.exp[challengerId]) await exp(interaction, outcome, challengerId, names, trainerData[challengerId]);
}

// ----------------------------------------------------------
// Wager battles: hold the Challenger's Stake, post an offer the Defender
// must accept within 15 minutes, then run the battle with both Stakes.
// Other commands and the dashboard replace a player's record in
// trainerData with a copy, so every step re-reads the live record inside
// its lock; never hold a user object across an await.
// ----------------------------------------------------------
/**
 * The Wager offer's VS card (both Battle teams, rated records, the pot), as
 * an attachment list; empty when it can't render or CARD_TRAINER_FX=0 (the
 * offer's text says it all). The pot shown is twice the full Stake, as the
 * label is: an All-in amount would make the Defender's balance public.
 */
export async function offerCard(trainerData, challengerId, defenderId, names, stake, { render = threaded.battleVs } = {}) {
  if (!cardTrainerFx()) return [];
  try {
    const sides = [challengerId, defenderId].map((userId) => ({ userId, members: teamFor(trainerData[userId], "wager") }));
    const view = vsView("wager", sides, names, trainerData, vsRecords(trainerData, [challengerId, defenderId], "wager"), 2 * stake);
    const card = await cardImage((animate) => render(view, { animate }), "wager-vs", { unique: true });
    return [new AttachmentBuilder(card.buffer, { name: card.name, description: battleVsAltText(view) })];
  } catch (err) {
    console.warn("⚠️ wager VS card failed; sending the offer without it:", err?.message || err);
    return [];
  }
}

async function offer(interaction, trainerData, lockUser, enqueueSave, opponent, stake) {
  const challengerId = interaction.user.id;
  const defenderId = opponent.id;
  const live = () => trainerData[challengerId];
  const nonce = randomUUID();
  const names = displayNames(interaction, opponent);
  const save = () => enqueueSave(trainerData, { force: true });
  const refund = () => lockUser(challengerId, async () => {
    const amount = refundWager(live(), nonce);
    if (amount) await save();
    return amount;
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const offered = await lockUser(challengerId, async () => {
    const r = offerWager(live(), { defenderId, stake, channelId: interaction.channelId, nonce, now: Date.now() });
    if (r.ok) await save();
    return r;
  });
  if (!offered.ok) return interaction.editReply(refusal(offered.reason, defenderId));

  const power = (id) => teamPower(buildBattleTeam(trainerData[id])); // Battle teams, at Lv 50
  // Everything between holding the Stake and listening for the buttons is
  // either inside this try (a failure refunds) or can't throw, so a Stake is
  // never held with nobody listening.
  let message;
  let offeredPower; // Accept refuses a Challenger Team stronger than the offer showed
  try {
    offeredPower = power(challengerId);
    // A new channel message (not an edited reply) so the Defender is notified.
    // The label is always the full Stake: showing an All-in amount would make
    // the Defender's balance public.
    message = await interaction.channel.send({
      content: `⚔️ <@${challengerId}> challenges <@${defenderId}> to a Wager battle for ${stake} CC!`,
      files: await offerCard(trainerData, challengerId, defenderId, names, stake),
      embeds: [new EmbedBuilder().setColor(0xf1c40f).setDescription(
        `Power rating: ${names[challengerId]} ${offeredPower} · ${names[defenderId]} ${power(defenderId)}\n` +
        "Winner takes all. If you don't have enough Coop Coins, accepting puts you all in.\n" +
        "This offer expires in 15 minutes.")],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wager_accept:${nonce}`).setLabel(`Accept (${stake} CC)`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`wager_decline:${nonce}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      )],
    });
    await lockUser(challengerId, async () => { attachMessage(live(), nonce, message.id); await save(); });
  } catch (err) {
    console.warn("⚠️ wager offer post failed:", err?.message || err);
    await refund();
    return interaction.editReply(refusal("post_failed", defenderId)).catch(() => {});
  }

  const closeOffer = (content) => message.edit({ content, embeds: [], components: [], attachments: [] }).catch(() => {});
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: WAGER.windowMs,
    filter: (i) => i.customId.endsWith(nonce),
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== defenderId) {
      return i.reply({ content: "This wager isn't for you.", flags: MessageFlags.Ephemeral });
    }
    await i.deferUpdate();
    if (i.customId.startsWith("wager_decline")) {
      if (!(await refund())) return i.followUp({ content: "This wager is no longer open.", flags: MessageFlags.Ephemeral });
      collector.stop("declined");
      return closeOffer(`<@${defenderId}> declined. Stake refunded.`);
    }

    const outcome = await withBothLocks(lockUser, challengerId, defenderId, async () => {
      // A second click (or a click after expiry) finds the offer already settled.
      if (live()?.pendingWager?.nonce !== nonce) return { error: "no_wager" };
      // Teams and caps are checked again now: either player may have changed since the offer.
      const block = battleBlock({ trainerData, challengerId, defenderId, mode: "wager" })
        || (power(challengerId) > offeredPower ? "team_changed" : null);
      if (block) {
        refundWager(live(), nonce);
        await save();
        return { canceled: block };
      }
      const accepted = acceptStake(live(), trainerData[defenderId], nonce, Date.now());
      if (!accepted.ok) return { error: accepted.reason };
      const before = vsRecords(trainerData, [challengerId, defenderId], "wager"); // for the VS card
      const out = runBattle({
        trainerData, challengerId, defenderId, mode: "wager", stake: accepted.stake, seed: randomInt(0, 2 ** 31 - 1),
      });
      if (out.ok) out.vsRecords = before;
      await save();
      return out;
    });

    if (outcome.error) {
      const text = { expired: "This wager expired.", no_cc: "You need at least 1 CC to accept." }[outcome.error]
        ?? "This wager is no longer open.";
      return i.followUp({ content: text, flags: MessageFlags.Ephemeral });
    }
    collector.stop("answered");
    if (outcome.canceled) {
      const why = outcome.canceled === "team_changed" ? `<@${challengerId}>'s Team got stronger since the offer`
        : outcome.canceled.startsWith("no_team") ? "a Team is empty" : "one of you is out of battles";
      return closeOffer(`Wager canceled because ${why}. Stakes refunded.`);
    }
    logEvent("battle", challengerId, {
      defenderId, mode: "wager", stake: outcome.stake, seed: outcome.seed,
      winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
    });
    recordFight(() => battleRecord(outcome, names, trainerData)); // Battle Records; never throws
    await closeOffer(`✅ <@${defenderId}> accepted! The battle is below.`);
    await playBattle(interaction.channel, outcome, names, { ...PLAYBACK, trainers: trainersOf(trainerData, outcome), auras: aurasOf(trainerData, outcome), vs: vsOf(outcome, names, trainerData) }).catch((err) =>
      console.warn("⚠️ wager battle post failed:", err?.message || err));
    // The Challenger's /battle and the Defender's Accept click are the two interactions to reply on.
    await Promise.all([sendExp(interaction, outcome, challengerId, names, trainerData[challengerId]), sendExp(i, outcome, defenderId, names, trainerData[defenderId])]);
  });

  // Any end other than an answer (timeout, deleted message or channel)
  // refunds the Stake. refundWager is nonce-checked, so this is safe even
  // if an accept or decline already settled the offer.
  collector.on("end", async (_, reason) => {
    if (reason === "answered" || reason === "declined") return;
    if (await refund()) await closeOffer(reason === "time" ? "Wager expired. Stake refunded." : "Wager canceled. Stake refunded.");
  });

  await liftBlock(lockUser, trainerData, save, defenderId, challengerId);
  // Last, once the buttons are live: if this reply fails, the offer still works.
  await interaction.editReply("⚔️ Wager offered. Your Coop Coin Stake is held until they respond.").catch(() => {});
}

// `opponentId` just sent `userId` a /battle that wasn't refused (a Wager
// offer or a Rematch request), so `userId` may ask them for a rematch again.
// A battle that runs lifts it in runBattle. Runs once the buttons are live,
// with its own catch, so a failure here never leaves an offer unanswerable.
async function liftBlock(lockUser, trainerData, save, userId, opponentId) {
  await lockUser(userId, async () => {
    if (liftRematchBlock(trainerData[userId], opponentId)) await save();
  }).catch((err) => console.warn("⚠️ rematch block lift failed:", err?.message || err));
}

// ----------------------------------------------------------
// Rematch requests (utils/battle/rematch.js): once the Challenger has started
// 3 casual battles against this Defender today, another runs only if the
// Defender accepts within REMATCH.windowMs. It earns no EXP, so no EXP card
// follows. A decline or expiry stops the Challenger asking this Defender
// again until midnight UTC, or until the Defender challenges them. As in the
// wager flow, every step re-reads the live record inside its lock. The
// interaction is already deferred.
// ----------------------------------------------------------
async function requestRematch(interaction, trainerData, lockUser, enqueueSave, opponent) {
  const challengerId = interaction.user.id;
  const defenderId = opponent.id;
  const live = () => trainerData[challengerId];
  const nonce = randomUUID();
  const names = displayNames(interaction, opponent);
  const minutes = REMATCH.windowMs / 60_000;
  const save = () => enqueueSave(trainerData, { force: true });
  // Settles the request (nonce-checked) and, for a decline or expiry, blocks asking again.
  const close = (block) => lockUser(challengerId, async () => {
    const request = settleRematch(live(), defenderId, nonce);
    if (!request) return false;
    if (block) blockRematch(live(), defenderId, request.day);
    await save();
    return true;
  });

  const opened = await lockUser(challengerId, async () => {
    const r = openRematch(live(), { defenderId, channelId: interaction.channelId, nonce, day: utcDay(new Date()) });
    if (r.ok) await save();
    return r;
  });
  if (!opened.ok) return interaction.editReply(refusal(opened.reason, defenderId));

  // As in the wager flow, everything between opening the request and
  // listening for the buttons is inside this try (a failure closes it) or
  // can't throw, so a request is never left open with nobody listening.
  let message;
  try {
    const times = live().battle.vs[defenderId];
    // A new channel message (not an edited reply) so the Defender is notified.
    message = await interaction.channel.send({
      content: `⚔️ <@${challengerId}> asks <@${defenderId}> for a rematch! They've battled you ${times} times today, so no more EXP for them. The request expires in ${minutes} minutes.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rematch_accept:${nonce}`).setLabel("Accept").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`rematch_decline:${nonce}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      )],
    });
    await lockUser(challengerId, async () => { attachRematchMessage(live(), defenderId, nonce, message.id); await save(); });
  } catch (err) {
    console.warn("⚠️ rematch request post failed:", err?.message || err);
    await close(false);
    return interaction.editReply(refusal("rematch_post_failed", defenderId)).catch(() => {});
  }

  const closeRequest = (content) => message.edit({ content, components: [] }).catch(() => {});
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: REMATCH.windowMs,
    filter: (i) => i.customId.endsWith(nonce),
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== defenderId) {
      return i.reply({ content: "This rematch request isn't for you.", flags: MessageFlags.Ephemeral });
    }
    await i.deferUpdate();
    const notOpen = () => i.followUp({ content: "This rematch request is no longer open.", flags: MessageFlags.Ephemeral });
    if (i.customId.startsWith("rematch_decline")) {
      if (!(await close(true))) return notOpen();
      collector.stop("declined");
      return closeRequest(`<@${defenderId}> declined the rematch.`);
    }

    const outcome = await withBothLocks(lockUser, challengerId, defenderId, async () => {
      // A second click (or a click after expiry) finds the request already
      // settled. settleRematch directly: lockUser isn't re-entrant, so
      // close() would wait on the lock this callback holds.
      if (!settleRematch(live(), defenderId, nonce)) return { error: "closed" };
      const before = vsRecords(trainerData, [challengerId, defenderId], "open"); // for the VS card
      const out = runBattle({ trainerData, challengerId, defenderId, mode: "open", rematch: true, seed: randomInt(0, 2 ** 31 - 1) });
      if (out.ok) out.vsRecords = before;
      await save();
      return out;
    });
    if (outcome.error) return notOpen();
    collector.stop("answered");
    // Teams are checked again now; the only refusal left is an emptied Team.
    if (!outcome.ok) return closeRequest(`Rematch canceled. <@${outcome.reason === "no_team_challenger" ? challengerId : defenderId}> has no Team set.`);
    logEvent("battle", challengerId, {
      defenderId, mode: "open", rematch: true, seed: outcome.seed, winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
    });
    recordFight(() => battleRecord(outcome, names, trainerData)); // Battle Records; never throws
    await closeRequest(`✅ <@${defenderId}> accepted! The battle is below.`);
    await playBattle(interaction.channel, outcome, names, { ...PLAYBACK, trainers: trainersOf(trainerData, outcome), auras: aurasOf(trainerData, outcome), vs: vsOf(outcome, names, trainerData) }).catch((err) =>
      console.warn("⚠️ rematch battle post failed:", err?.message || err));
  });

  // Expiry blocks like a decline. Any other end (a deleted message or
  // channel) closes the request without a block. close() is nonce-checked,
  // so this is safe even if an answer already settled it.
  collector.on("end", async (_, reason) => {
    if (reason === "answered" || reason === "declined") return;
    const expired = reason === "time";
    if ((await close(expired)) && expired) await closeRequest("Rematch request expired.");
  });

  await liftBlock(lockUser, trainerData, save, defenderId, challengerId);
  // Last, once the buttons are live: if this reply fails, the request still works.
  await interaction.editReply(`Rematch request sent. If <@${defenderId}> declines or doesn't answer in ${minutes} minutes, you can't ask again until midnight UTC or until they challenge you.`).catch(() => {});
}
