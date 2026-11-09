// ==========================================================
// services/achievementsApi.js — achievement view + claim (Release C)
//
// One service for Discord (/achievements) and the dashboard:
//   view  – read-only; never writes (eligible-but-unrecorded unlocks are
//           shown as unlocked and recorded by the next game action or claim)
//   claim – lockUser → replay check → claimAchievement (all-or-nothing)
//           → saveAndAck → "saved" / "saved with a delay"
// Rewards stay unclaimable until approved (config/achievementRewards.js).
// ==========================================================

import { achievementView, claimAchievement } from "../progression/achievements.js";
import { CATEGORIES, ACHIEVEMENT_ID_PATTERN } from "../catalog/achievements.js";
import { runInventoryTransaction, REQUEST_ID_PATTERN } from "./inventory.js";
import { saveAckFields } from "../utils/saveManager.js";
import { defaultRewardPolicy } from "../config/achievementRewards.js";

const reply = (status, body) => ({ status, body });
const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^\d{5,25}$/;

/**
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {Function} deps.lockUser
 * @param {(data:object) => Promise<{saved:boolean, note:string}>} deps.save
 * @param {{ isApproved: (entry) => boolean }} [deps.policy]
 */
export function createAchievementHandlers({ getTrainerData, lockUser, save, policy = defaultRewardPolicy }) {
  /** Read-only view. */
  function view({ query, isAuthorized }) {
    const id = typeof query?.id === "string" ? query.id : "";
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    const td = getTrainerData();
    if (!ownKey(td, id)) return reply(404, { success: false, error: "User not found" });
    const cat = query?.category;
    if (cat != null && cat !== "" && !ownKey(CATEGORIES, cat)) return reply(400, { success: false, error: "Unknown category" });
    return reply(200, { success: true, ...achievementView(td[id], { policy, category: cat || null }) });
  }

  /** Claim one achievement's reward (the only way rewards are granted). */
  async function claim({ body, isAuthorized }) {
    const id = typeof body?.id === "string" ? body.id : "";
    const achievementId = body?.achievementId;
    const requestId = body?.requestId ?? null;
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (typeof achievementId !== "string" || !ACHIEVEMENT_ID_PATTERN.test(achievementId)) return reply(400, { success: false, error: "Invalid achievement id" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return reply(400, { success: false, error: "Invalid request id" });
    if (!ownKey(getTrainerData(), id)) return reply(404, { success: false, error: "User not found" });

    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `ach-claim:${achievementId}`,
      mutate: (user) => claimAchievement(user, achievementId, { policy }),
    });
    if (!tx.ok) {
      const { ok, status = 400, ...rest } = tx;
      return reply(status, { success: false, ...rest });
    }
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, persisted: tx.persisted, ...tx.result, ok: undefined });
  }

  return { view, claim };
}
