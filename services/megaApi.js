// ==========================================================
// services/megaApi.js — dashboard endpoints for Mega Evolution (Phase M1).
//
//   GET  /api/mega            view: Mega cards + stones (capability "dashboard")
//   POST /api/mega/unlock     use a Mega Stone (capability "unlock")
//   POST /api/mega/preferred  choose a line's preferred Mega (capability "dashboard")
//   GET  /api/mega/shop             Mega Shard shop view (capability "rewards")
//   POST /api/mega/shop/buy-shards  buy shards with CC (capability "rewards")
//   POST /api/mega/shop/buy-stone   spend shards on a Mega Stone (capability "rewards")
//
// Every check is server-side; the client's idea of what is unlocked is never
// trusted. Writes go through runInventoryTransaction: lockUser → requestId
// replay → synchronous mutation → saveAndAck. Unlock REQUIRES a requestId so
// double clicks, Discord/browser retries and resubmits apply at most once.
// While a capability is off the endpoint refuses; the view says only
// { enabled: false } and exposes nothing.
// ==========================================================

import { runInventoryTransaction, REQUEST_ID_PATTERN } from "./inventory.js";
import { saveAckFields } from "../utils/saveManager.js";
import { useMegaStone, buildMegaCards, megaStoneBag, STONE_ID_PATTERN } from "./mega.js";
import { setPreferredMega, LINE_PATTERN } from "./megaUnlocks.js";
import { MEGA_ID_PATTERN } from "../utils/megas.js";
import { isMegaCapabilityEnabled, megaCapabilities } from "../config/features.js";
import { megaCollectionProgress } from "../utils/megaDisplay.js";
import { megaShopView, buyShards, buyMegaStone } from "./megaShards.js";

const reply = (status, body) => ({ status, body });
const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^\d{5,25}$/;
const str = (v, max = 80) => (typeof v === "string" && v.length <= max ? v : null);

/**
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {Function} deps.lockUser
 * @param {(data:object) => Promise<{saved:boolean, note:string}>} deps.save
 * @param {() => object} [deps.getEnv]   environment source (tests inject flags)
 */
export function createMegaHandlers({ getTrainerData, lockUser, save, getEnv = () => process.env }) {
  function authUser(id, isAuthorized) {
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (!ownKey(getTrainerData(), id)) return reply(404, { success: false, error: "User not found" });
    return null;
  }

  /** Read-only. */
  function view({ query, isAuthorized }) {
    const id = str(query?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return bad;
    const env = getEnv();
    if (!isMegaCapabilityEnabled("dashboard", env)) return reply(200, { success: true, enabled: false });
    const user = getTrainerData()[id];
    const caps = megaCapabilities(env);
    return reply(200, {
      success: true,
      enabled: true,
      capabilities: { unlock: caps.unlock, team: caps.team, battle: caps.battle, rewards: caps.rewards },
      cards: buildMegaCards(user, { env }),
      stones: megaStoneBag(user),
      // Mega collection progress — separate from the National Pokédex.
      progress: megaCollectionProgress(user, { env }),
    });
  }

  async function unlock({ body, isAuthorized }) {
    const id = str(body?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return bad;
    const env = getEnv();
    if (!isMegaCapabilityEnabled("unlock", env)) return reply(403, { success: false, error: "Mega Evolution isn't available yet." });
    const line = str(body?.line, 16);
    const stoneId = str(body?.stoneId, 60);
    const formId = str(body?.formId, 64);
    const requestId = body?.requestId;
    const choice = body?.choice ?? null;
    if (!line || !LINE_PATTERN.test(line)) return reply(400, { success: false, error: "Invalid Pokémon line (expected <species>:normal or <species>:shiny)" });
    if (!stoneId || !STONE_ID_PATTERN.test(stoneId)) return reply(400, { success: false, error: "Invalid Mega Stone" });
    if (!formId || !MEGA_ID_PATTERN.test(formId)) return reply(400, { success: false, error: "Invalid Mega form" });
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) return reply(400, { success: false, error: "A request id is required" });
    if (choice !== null && (typeof choice !== "object" || Array.isArray(choice) || Object.keys(choice).length !== 1 || !["gender", "appearance"].includes(Object.keys(choice)[0]) || typeof Object.values(choice)[0] !== "string")) {
      return reply(400, { success: false, error: "Invalid choice" });
    }

    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `mega-unlock:${line}:${formId}:${stoneId}:${choice ? JSON.stringify(choice) : ""}`,
      mutate: (user) => useMegaStone(user, { line, stoneId, formId, choice, requestId }, { env }),
    });
    if (!tx.ok) {
      const { ok, status = 400, code, ...rest } = tx;
      return reply(status, { success: false, code, ...rest });
    }
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, persisted: tx.persisted, ...tx.result, ok: undefined });
  }

  async function preferred({ body, isAuthorized }) {
    const id = str(body?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return bad;
    const env = getEnv();
    if (!isMegaCapabilityEnabled("dashboard", env)) return reply(403, { success: false, error: "Mega Evolution isn't available yet." });
    const line = str(body?.line, 16);
    const formId = body?.formId === null ? null : str(body?.formId, 64);
    const requestId = body?.requestId ?? null;
    if (!line || !LINE_PATTERN.test(line)) return reply(400, { success: false, error: "Invalid Pokémon line" });
    if (formId !== null && (!formId || !MEGA_ID_PATTERN.test(formId))) return reply(400, { success: false, error: "Invalid Mega form" });
    if (requestId != null && (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId))) return reply(400, { success: false, error: "Invalid request id" });
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `mega-preferred:${line}:${formId}`,
      mutate: (user) => setPreferredMega(user, line, formId, { env }),
    });
    if (!tx.ok) {
      const { ok, status = 400, code, ...rest } = tx;
      return reply(status, { success: false, code, ...rest });
    }
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...tx.result, ok: undefined });
  }

  // ---------------- Mega Shard shop (capability "rewards") ----------------

  /** Read-only: balance, prices and the battle-eligible stones. */
  function shop({ query, isAuthorized }) {
    const id = str(query?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return bad;
    const env = getEnv();
    if (!isMegaCapabilityEnabled("rewards", env)) return reply(200, { success: true, enabled: false });
    return reply(200, { success: true, ...megaShopView(getTrainerData()[id], { env }) });
  }

  async function shopWrite({ body, isAuthorized }, kind) {
    const id = str(body?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return bad;
    const env = getEnv();
    if (!isMegaCapabilityEnabled("rewards", env)) return reply(403, { success: false, error: "The Mega shop isn't open yet." });
    const requestId = body?.requestId;
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) return reply(400, { success: false, error: "A request id is required" });
    let payloadKey, mutate;
    if (kind === "shards") {
      const qty = body?.quantity;
      if (!Number.isSafeInteger(qty)) return reply(400, { success: false, error: "Invalid quantity" });
      payloadKey = `mega-buy-shards:${qty}`;
      mutate = (user) => buyShards(user, qty, { env });
    } else {
      const stoneId = str(body?.stoneId, 60);
      if (!stoneId || !STONE_ID_PATTERN.test(stoneId)) return reply(400, { success: false, error: "Invalid Mega Stone" });
      payloadKey = `mega-buy-stone:${stoneId}`;
      mutate = (user) => buyMegaStone(user, stoneId, { env });
    }
    const tx = await runInventoryTransaction({ trainerData: getTrainerData(), userId: id, lock: lockUser, save, requestId, payloadKey, mutate });
    if (!tx.ok) {
      const { ok, status = 400, code, ...rest } = tx;
      return reply(status, { success: false, code, ...rest });
    }
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...tx.result, ok: undefined });
  }

  return {
    view, unlock, preferred, shop,
    buyShards: (req) => shopWrite(req, "shards"),
    buyStone: (req) => shopWrite(req, "stone"),
  };
}
