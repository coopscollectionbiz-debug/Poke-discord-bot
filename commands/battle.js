// ==========================================================
// /battle — challenge another trainer's Team to an automatic Battle.
// Open battle: runs immediately, no CC. Wager battle: the Defender must
// accept first (see the wager flow below).
// ==========================================================

import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionFlagsBits,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { logEvent } from "../utils/eventLog.js";
import { battleBlock, buildTeam, runBattle, withBothLocks } from "../utils/battle/runBattle.js";
import { playBattle, expSummary } from "../utils/battle/playback.js";
import { teamPower } from "../utils/battle/power.js";
import { offerWager, attachMessage, refundWager, acceptStake } from "../utils/battle/wager.js";
import { WAGER, PLAYBACK } from "../utils/battle/tuning.js";
import { expView, renderExpCard } from "../utils/render/expCard.js";

export const data = new SlashCommandBuilder()
  .setName("battle")
  .setDescription("Battle another trainer's Team")
  .addUserOption((o) => o.setName("opponent").setDescription("Who to battle").setRequired(true))
  .addIntegerOption((o) =>
    o.setName("wager").setDescription("CC each of you puts in the pot (they must accept)").setMinValue(1));

// Battles and wager offers are posted as new channel messages.
const CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles,
];

export function refusal(reason, opponentId) {
  return {
    self: "You can't battle yourself.",
    bot: "You can't battle a bot.",
    no_perms: "I can't post battles in this channel. Try another one.",
    no_team_challenger: "Set a Team on your dashboard before battling.",
    no_team_defender: `<@${opponentId}> hasn't set a team yet.`,
    cap_daily: "You've used all 10 battles for today. Battles reset at midnight UTC.",
    cap_opponent: `You've battled <@${opponentId}> 3 times today. Try someone else.`,
    defender_cap_daily: `<@${opponentId}> has no battles left today.`,
    defender_cap_opponent: "You two have battled 3 times today.",
    insufficient_cc: "You don't have that much CC.",
    pending_exists: "You already have a wager waiting for an answer.",
    post_failed: "I couldn't post the wager here, so your Stake was refunded.",
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
export async function expMessage(outcome, userId, names, user, { render = renderExpCard } = {}) {
  const text = expSummary(outcome, userId, names);
  try {
    const png = await render(expView(outcome, userId, names, user));
    return { content: text.split("\n")[0], files: [new AttachmentBuilder(png, { name: "exp.png" })], flags: MessageFlags.Ephemeral };
  } catch (err) {
    console.warn("⚠️ EXP card render failed; sending text:", err?.message || err);
    return { content: text, flags: MessageFlags.Ephemeral };
  }
}

// Each side's displayed trainer, for the replay's portraits.
export const trainersOf = (trainerData, outcome) => outcome.sides.map((s) => trainerData[s.userId]?.displayedTrainer ?? null);

async function sendExp(reply, outcome, userId, names, user) {
  return reply.followUp(await expMessage(outcome, userId, names, user))
    .catch((err) => console.warn("⚠️ EXP message failed:", err?.message || err));
}

export async function execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave) {
  const opponent = interaction.options.getUser("opponent", true);
  const wager = interaction.options.getInteger("wager");
  const challengerId = interaction.user.id;
  const refuse = (reason) => interaction.reply({ content: refusal(reason, opponent.id), flags: MessageFlags.Ephemeral });

  if (opponent.bot) return refuse("bot");
  if (interaction.appPermissions && !interaction.appPermissions.has(CHANNEL_PERMISSIONS)) return refuse("no_perms");

  const mode = wager != null ? "wager" : "open";
  const early = battleBlock({ trainerData, challengerId, defenderId: opponent.id, mode });
  if (early) return refuse(early);
  if (mode === "wager") return offer(interaction, trainerData, lockUser, enqueueSave, opponent, wager);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const seed = randomInt(0, 2 ** 31 - 1);
  const outcome = await withBothLocks(lockUser, challengerId, opponent.id, async () => {
    const out = runBattle({ trainerData, challengerId, defenderId: opponent.id, mode, seed });
    // Results are applied and saved before the replay, so a failed or slow
    // replay never changes them. (A hard crash before the next Discord backup
    // can still lose them, like any other action: startup loads that backup.)
    if (out.ok) await enqueueSave(trainerData, { force: true });
    return out;
  });
  if (!outcome.ok) return interaction.editReply(refusal(outcome.reason, opponent.id));

  logEvent("battle", challengerId, {
    defenderId: opponent.id, mode, seed, winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
  });
  await interaction.editReply("⚔️ Your battle is starting below.");
  const names = displayNames(interaction, opponent);
  try {
    await playBattle(interaction.channel, outcome, names, { ...PLAYBACK, trainers: trainersOf(trainerData, outcome) });
  } catch (err) {
    console.warn("⚠️ battle post failed:", err?.message || err);
    await interaction.editReply("Your battle counted, but I couldn't post it in this channel.").catch(() => {});
  }
  await sendExp(interaction, outcome, challengerId, names, trainerData[challengerId]); // only the Challenger earns EXP in an Open battle
}

// ----------------------------------------------------------
// Wager battles: hold the Challenger's Stake, post an offer the Defender
// must accept within 15 minutes, then run the battle with both Stakes.
// Other commands and the dashboard replace a player's record in
// trainerData with a copy, so every step re-reads the live record inside
// its lock; never hold a user object across an await.
// ----------------------------------------------------------
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

  const power = (id) => teamPower(buildTeam(trainerData[id]));
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

  const closeOffer = (content) => message.edit({ content, embeds: [], components: [] }).catch(() => {});
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
      const out = runBattle({
        trainerData, challengerId, defenderId, mode: "wager", stake: accepted.stake, seed: randomInt(0, 2 ** 31 - 1),
      });
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
      return closeOffer(`Wager canceled — ${why}. Stake refunded.`);
    }
    logEvent("battle", challengerId, {
      defenderId, mode: "wager", stake: outcome.stake, seed: outcome.seed,
      winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
    });
    await closeOffer(`✅ <@${defenderId}> accepted! The battle is below.`);
    await playBattle(interaction.channel, outcome, names, { ...PLAYBACK, trainers: trainersOf(trainerData, outcome) }).catch((err) =>
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

  // Last, once the buttons are live: if this reply fails, the offer still works.
  await interaction.editReply("⚔️ Wager offered. Your Coop Coin Stake is held until they respond.").catch(() => {});
}
