// ==========================================================
// utils/battle/wager.js
// Stake bookkeeping for Wager battles. The Challenger's Stake is held
// (deducted) on offer and saved on the user, so a restart can refund it.
// Every refund/accept checks the offer's nonce, so a late click, an
// expiry, and a restart refund can never move the same CC twice.
// ==========================================================

import { WAGER } from "./tuning.js";
import { registeredSpecies } from "../../services/box.js";

const DISCORD_EPOCH = 1_420_070_400_000;
const DAY_MS = 86_400_000;

/** When a Discord account was made, from its id (a snowflake); null for an id that isn't one. */
export function accountCreatedAt(userId) {
  if (!/^\d{15,21}$/.test(String(userId ?? ""))) return null;
  return Number(BigInt(userId) >> 22n) + DISCORD_EPOCH;
}

/**
 * Why this player can't take part in a Wager battle yet, or null.
 * "new_account": their Discord account is under WAGER.minAccountDays old.
 * "dex": fewer than WAGER.minDex species registered.
 * An id that isn't a Discord snowflake (test fixtures) skips the age check.
 */
export function wagerEligibility(user, userId, now = Date.now()) {
  const created = accountCreatedAt(userId);
  if (created != null && now - created < WAGER.minAccountDays * DAY_MS) return "new_account";
  if (registeredSpecies(user ?? {}).length < WAGER.minDex) return "dex";
  return null;
}

export function offerWager(challenger, { defenderId, stake, channelId, nonce, now }) {
  if (!Number.isInteger(stake) || stake < WAGER.minStake) return { ok: false, reason: "invalid_stake" };
  if (challenger.pendingWager) return { ok: false, reason: "pending_exists" };
  if ((challenger.cc ?? 0) < stake) return { ok: false, reason: "insufficient_cc" };
  challenger.cc -= stake;
  challenger.pendingWager = { defenderId, stake, channelId, messageId: null, nonce, expiresAt: now + WAGER.windowMs };
  return { ok: true };
}

export function attachMessage(challenger, nonce, messageId) {
  if (challenger.pendingWager?.nonce === nonce) challenger.pendingWager.messageId = messageId;
}

export function refundWager(challenger, nonce) {
  const pending = challenger.pendingWager;
  if (!pending || pending.nonce !== nonce) return 0;
  challenger.cc = (challenger.cc ?? 0) + pending.stake;
  challenger.pendingWager = null;
  return pending.stake;
}

// All-in: a Defender with less than the Stake puts up everything they have,
// and the Challenger gets the difference back.
export function acceptStake(challenger, defender, nonce, now) {
  const pending = challenger.pendingWager;
  if (!pending || pending.nonce !== nonce) return { ok: false, reason: "no_wager" };
  if (pending.defenderId !== defender.id) return { ok: false, reason: "wrong_defender" };
  if (now > pending.expiresAt) return { ok: false, reason: "expired" };
  if ((defender.cc ?? 0) < WAGER.minStake) return { ok: false, reason: "no_cc" };
  const stake = Math.min(pending.stake, defender.cc);
  const refunded = pending.stake - stake;
  challenger.cc += refunded;
  defender.cc -= stake;
  challenger.pendingWager = null;
  return { ok: true, stake, refunded };
}

/** Undoes acceptStake when the fight can't run: each player gets `stake` back. */
export function returnStakes(challenger, defender, stake) {
  challenger.cc = (challenger.cc ?? 0) + stake;
  defender.cc = (defender.cc ?? 0) + stake;
}

export function refundAllPending(trainerData) {
  const refunded = [];
  for (const [userId, user] of Object.entries(trainerData)) {
    const pending = user?.pendingWager;
    if (!pending) continue;
    refundWager(user, pending.nonce);
    refunded.push({ userId, stake: pending.stake, channelId: pending.channelId, messageId: pending.messageId });
  }
  return refunded;
}
