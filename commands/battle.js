// ==========================================================
// /battle — challenge another trainer's Team to an automatic Battle.
// Open battle: runs immediately, no CC. Wager battle: the Defender must
// accept first (see the wager flow below).
// ==========================================================

import {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { logEvent } from "../utils/eventLog.js";
import { battleBlock, buildTeam, runBattle, withBothLocks } from "../utils/battle/runBattle.js";
import { playBattle } from "../utils/battle/playback.js";
import { teamPower } from "../utils/battle/power.js";
import { offerWager, attachMessage, refundWager, acceptStake } from "../utils/battle/wager.js";
import { WAGER } from "../utils/battle/tuning.js";

export const data = new SlashCommandBuilder()
  .setName("battle")
  .setDescription("Battle another trainer's Team")
  .addUserOption((o) => o.setName("opponent").setDescription("Who to battle").setRequired(true))
  .addIntegerOption((o) =>
    o.setName("wager").setDescription("CC each of you puts in the pot (they must accept)").setMinValue(1));

export function refusal(reason, opponentId) {
  return {
    self: "You can't battle yourself.",
    bot: "You can't battle a bot.",
    no_team_challenger: "Set a Team on your dashboard before battling.",
    no_team_defender: `<@${opponentId}> hasn't set a team yet.`,
    cap_daily: "You've used all 10 battles for today. Battles reset at midnight UTC.",
    cap_opponent: `You've battled <@${opponentId}> 3 times today. Try someone else.`,
    defender_cap_daily: `<@${opponentId}> has no battles left today.`,
    defender_cap_opponent: "You two have battled 3 times today.",
    insufficient_cc: "You don't have that much CC.",
    pending_exists: "You already have a wager waiting for an answer.",
  }[reason] ?? "That battle can't happen right now.";
}

export function displayNames(interaction, opponent) {
  return {
    [interaction.user.id]: interaction.member?.displayName ?? interaction.user.username,
    [opponent.id]: interaction.options.getMember("opponent")?.displayName ?? opponent.username,
  };
}

export async function execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave, client) {
  const opponent = interaction.options.getUser("opponent", true);
  const wager = interaction.options.getInteger("wager");
  const challengerId = interaction.user.id;
  const refuse = (reason) => interaction.reply({ content: refusal(reason, opponent.id), flags: MessageFlags.Ephemeral });

  if (opponent.bot) return refuse("bot");

  await ensureUserInitialized(challengerId, interaction.user.username, trainerData, client);
  const mode = wager != null ? "wager" : "open";
  const early = battleBlock({ trainerData, challengerId, defenderId: opponent.id, mode });
  if (early) return refuse(early);
  if (mode === "wager") return offer(interaction, trainerData, lockUser, enqueueSave, opponent, wager);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const seed = randomInt(0, 2 ** 31 - 1);
  const outcome = await withBothLocks(lockUser, challengerId, opponent.id, async () => {
    const out = runBattle({ trainerData, challengerId, defenderId: opponent.id, mode, seed });
    // Save before the replay starts, so a crash mid-animation can't lose results.
    if (out.ok) await enqueueSave(trainerData, { force: true });
    return out;
  });
  if (!outcome.ok) return interaction.editReply(refusal(outcome.reason, opponent.id));

  logEvent("battle", challengerId, {
    defenderId: opponent.id, mode, seed, winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
  });
  await interaction.editReply("⚔️ Your battle is starting below.");
  await playBattle(interaction.channel, outcome, displayNames(interaction, opponent));
}

// ----------------------------------------------------------
// Wager battles: hold the Challenger's Stake, post an offer the Defender
// must accept within 15 minutes, then run the battle with both Stakes.
// ----------------------------------------------------------
async function offer(interaction, trainerData, lockUser, enqueueSave, opponent, stake) {
  const challengerId = interaction.user.id;
  const defenderId = opponent.id;
  const challenger = trainerData[challengerId];
  const nonce = randomUUID();
  const names = displayNames(interaction, opponent);
  const save = () => enqueueSave(trainerData, { force: true });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const offered = await lockUser(challengerId, async () => {
    const r = offerWager(challenger, { defenderId, stake, channelId: interaction.channelId, nonce, now: Date.now() });
    if (r.ok) await save();
    return r;
  });
  if (!offered.ok) return interaction.editReply(refusal(offered.reason, defenderId));

  const defenderCc = trainerData[defenderId]?.cc ?? 0;
  const acceptLabel = defenderCc >= 1 && defenderCc < stake ? `Accept All-in (${defenderCc} CC)` : `Accept (${stake} CC)`;
  const power = (id) => teamPower(buildTeam(trainerData[id]));
  // A new channel message (not an edited reply) so the Defender is notified.
  const message = await interaction.channel.send({
    content: `⚔️ <@${challengerId}> challenges <@${defenderId}> to a Wager battle for ${stake} CC!`,
    embeds: [new EmbedBuilder().setColor(0xf1c40f).setDescription(
      `Power rating: ${names[challengerId]} ${power(challengerId)} · ${names[defenderId]} ${power(defenderId)}\n` +
      "The winner takes the pot. This offer expires in 15 minutes.")],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wager_accept:${nonce}`).setLabel(acceptLabel).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`wager_decline:${nonce}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
    )],
  });
  await lockUser(challengerId, async () => { attachMessage(challenger, nonce, message.id); await save(); });
  await interaction.editReply("⚔️ Wager offered. Your Stake is held until they answer.");

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
    if (i.customId.startsWith("wager_decline")) {
      collector.stop("declined");
      await lockUser(challengerId, async () => { if (refundWager(challenger, nonce)) await save(); });
      return i.update({ content: `<@${defenderId}> declined. Stake refunded.`, embeds: [], components: [] });
    }

    await i.deferUpdate();
    const outcome = await withBothLocks(lockUser, challengerId, defenderId, async () => {
      // A second click (or a click after expiry) finds the offer already settled.
      if (challenger.pendingWager?.nonce !== nonce) return { error: "no_wager" };
      // Teams and caps are checked again now: either player may have changed since the offer.
      const block = battleBlock({ trainerData, challengerId, defenderId, mode: "wager" });
      if (block) {
        refundWager(challenger, nonce);
        await save();
        return { canceled: block };
      }
      const accepted = acceptStake(challenger, trainerData[defenderId], nonce, Date.now());
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
      const why = outcome.canceled.startsWith("no_team") ? "a Team is empty" : "one of you is out of battles";
      return closeOffer(`Wager canceled — ${why}. Stake refunded.`);
    }
    logEvent("battle", challengerId, {
      defenderId, mode: "wager", stake: outcome.stake, seed: outcome.seed,
      winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
    });
    await closeOffer(`✅ <@${defenderId}> accepted! The battle is below.`);
    await playBattle(interaction.channel, outcome, names);
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "time") return;
    const refunded = await lockUser(challengerId, async () => {
      const amount = refundWager(challenger, nonce);
      if (amount) await save();
      return amount;
    });
    if (refunded) await closeOffer("Wager expired. Stake refunded.");
  });
}
