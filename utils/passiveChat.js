// ==========================================================
// utils/passiveChat.js
// Passive chat rewards (TP / CC / random catch, then maybe a Trainer
// encounter) and the batched rank-role flush, built from injected dependencies so they can be
// tested offline without starting Discord or Express.
//
// Behavior is identical to the inline handlers this replaced in
// bot_final.js, including the startup readiness guards: until player
// data has loaded (isReady() === false) nothing is created, rewarded,
// queued, or synced.
// ==========================================================

import { liveEffects } from "../services/liveEvents.js";
import { scaleEarned } from "./liveEventRules.js";

/**
 * @param {object} deps
 * @param {() => boolean} deps.isReady
 * @param {() => object} deps.getTrainerData - live trainerData map
 * @param {(id: string, user: object) => object} deps.normalizeUserSchema
 * @param {Map<string, number>} deps.cooldowns - per-user last-rewarded message time
 * @param {{ cooldownMs: number, tpGain: number, ccChance: number, ccGain: number }} deps.config
 * @param {(data: object) => any} deps.enqueueSave
 * @param {(job: object) => void} deps.queueRoleUpdate
 * @param {(userObj: object, author: object, message: object) => Promise<"cooldown"|"missed"|"caught"|undefined>} deps.giveRandomReward
 * @param {(message: object) => Promise<any>} [deps.spot] - a Trainer encounter's roll, only after a catch roll that missed
 * @param {() => number} [deps.random]
 * @param {() => number} [deps.now]
 * @param {(fn: () => void) => void} [deps.defer]
 * @param {(now: number) => object} [deps.effects] - running Live event effects
 */
export function createMessageHandler({
  isReady,
  getTrainerData,
  normalizeUserSchema,
  cooldowns,
  config,
  enqueueSave,
  queueRoleUpdate,
  giveRandomReward,
  spot = null,
  random = Math.random,
  now = Date.now,
  defer = setImmediate,
  effects = liveEffects,
}) {
  return async function onMessage(message) {
    if (message.author.bot || !message.guild) return;

    // Until trainerData is loaded, trainerData is {} — rewarding now would build
    // a throwaway record and the role flush would demote the player to the
    // lowest rank (with a public "Rank Up!"). Ignore chat until ready.
    if (!isReady()) return;

    const trainerData = getTrainerData();
    const userId = message.author.id;
    trainerData[userId] = normalizeUserSchema(userId, trainerData[userId]);

    // Prevent spam with cooldown
    const t = now();
    if (cooldowns.has(userId) && t - cooldowns.get(userId) < config.cooldownMs) return;
    cooldowns.set(userId, t);

    const userObj = trainerData[userId];

    // A running Live event may multiply chat TP and CC.
    const fx = effects(t);

    // 🪙 Give base TP for chatting
    userObj.tp += scaleEarned(config.tpGain, fx.tp);
    userObj.lastActiveAt = t; // Last active (saved with the TP below)

    // 💰 Chance to earn CC
    if (random() < config.ccChance) {
      userObj.cc ??= 0;
      userObj.cc += scaleEarned(config.ccGain, fx.cc);

      try {
        await message.react("💰").catch(() => {});
      } catch {}
    }

    // 🔥 fire-and-forget save (safe, debounced) — SAVE AFTER MUTATIONS
    enqueueSave(trainerData);

    queueRoleUpdate({
      guild: message.guild,
      userId,
      tp: userObj.tp,
      channel: message.channel,
    });

    defer(() => {
      Promise.resolve(giveRandomReward(userObj, message.author, message))
        .then((result) => {
          // Never in the same message as a catch, and not on the reward cooldown.
          if (result !== "missed" || !spot) return;
          return Promise.resolve(spot(message)).catch((e) => console.warn("⚠️ Trainer encounter spot failed:", e?.message || e));
        })
        .catch((e) => console.warn("⚠️ tryGiveRandomReward failed:", e?.message || e));
    });
  };
}

/**
 * @param {object} deps
 * @param {() => boolean} deps.isReady
 * @param {Map<string, object>} deps.pending - userId -> { guild, userId, tp, channel }
 * @param {() => object} deps.getTrainerData
 * @param {(tp: number) => string|null} deps.getRank
 * @param {(guild: object, userId: string) => Promise<object>} deps.getMember
 * @param {(member: object, tp: number, channel: object|null) => Promise<any>} deps.updateUserRole
 */
export function createRoleFlush({ isReady, pending, getTrainerData, getRank, getMember, updateUserRole }) {
  return async function flushRoleUpdates() {
    if (!pending.size) return;
    // Never sync roles from unloaded/partial data; jobs stay queued until ready.
    if (!isReady()) return;

    // Snapshot & clear quickly so we don't block incoming events
    const batch = [...pending.values()];
    pending.clear();

    for (const job of batch) {
      try {
        const userObj = getTrainerData()[job.userId];
        if (!userObj) continue;

        const oldRank = userObj.rank || null;
        const newRank = getRank(job.tp || 0);
        if (!newRank) continue;

        userObj.rank = newRank;
        const member = await getMember(job.guild, job.userId);

        // Only announce (via channel) on genuine rank-ups.
        // Silent fix when rank name is unchanged but Discord role is stale.
        const channel = oldRank !== newRank ? job.channel : null;
        await updateUserRole(member, job.tp, channel);
      } catch (err) {
        console.warn("⚠️ role queue flush failed:", err?.message || err);
      }
    }
  };
}
