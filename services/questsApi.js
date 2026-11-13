// ==========================================================
// services/questsApi.js: dashboard + /quest handlers for the Daily board.
// GET  /api/quests?id=          the board (rolls the day if needed)
// POST /api/quests/claim        { id, what: "task:<id>" | "chest" | "weekly", requestId? }
// A repeated requestId returns the first result and never pays twice.
// ==========================================================

import { ensureQuests, questView, claimQuest, questsEnabled, CLAIM_PATTERN } from "./quests.js";
import { runInventoryTransaction, REQUEST_ID_PATTERN } from "./inventory.js";
import { saveAckFields } from "../utils/saveManager.js";
import { liveEffects } from "./liveEvents.js";
import { scaleEarned } from "../utils/liveEventRules.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { grantCatch } from "../utils/training.js";
import { trackProgress } from "../progression/achievements.js";

const reply = (status, body) => ({ status, body });
const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^\d{5,25}$/;

/** A free random catch (Live event Catch boosts and limits apply, as on every free roll). */
export function makeRollCatch(pool) {
  return (user, ball) => {
    const pick = selectRandomPokemonForUser(pool, user, ball);
    if (!pick) return null;
    const shiny = rollForShiny(user.tp || 0);
    const caught = grantCatch(user, pick.id, shiny ? "shiny" : "normal");
    trackProgress(user, [{ type: "pokemon" }, { type: "shiny", n: shiny ? 1 : 0 }]);
    return { id: pick.id, name: pick.name, tier: String(pick.tier || "common").toLowerCase(), shiny, level: caught?.level ?? null, isNew: !!caught?.isNew };
  };
}

export const grantQuestCc = (user, amount) => {
  const cc = scaleEarned(amount, liveEffects().cc); // a Live event's CC multiplier
  user.cc = (user.cc ?? 0) + cc;
  return cc;
};

/**
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {Function} deps.lockUser
 * @param {(data: object) => Promise<{saved: boolean, note: string}>} deps.save
 * @param {() => Promise<object[]>} deps.loadPool  acquirable species (live generations)
 * @param {(type: string, userId: string, data: object) => any} [deps.logEvent]
 */
export function createQuestHandlers({ getTrainerData, lockUser, save, loadPool, logEvent = () => {}, now = Date.now, env = process.env }) {
  async function view({ query, isAuthorized }) {
    const id = typeof query?.id === "string" ? query.id : "";
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (!questsEnabled(env)) return reply(200, { success: true, enabled: false });
    if (!ownKey(getTrainerData(), id)) return reply(404, { success: false, error: "User not found" });
    // Rolling the day writes user.quests, so it runs in the user's lock.
    return lockUser(id, async () => {
      const user = getTrainerData()[id];
      const t = now();
      ensureQuests(user, id, t);
      return reply(200, { success: true, enabled: true, cc: user.cc ?? 0, ...questView(user, { now: t }) });
    });
  }

  async function claim({ body, isAuthorized }) {
    const id = typeof body?.id === "string" ? body.id : "";
    const what = body?.what;
    const requestId = body?.requestId ?? null;
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (!questsEnabled(env)) return reply(403, { success: false, error: "Quests aren't open yet." });
    if (typeof what !== "string" || !CLAIM_PATTERN.test(what)) return reply(400, { success: false, error: "Unknown quest reward." });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return reply(400, { success: false, error: "Invalid request id" });
    if (!ownKey(getTrainerData(), id)) return reply(404, { success: false, error: "User not found" });

    const pool = what === "chest" || what === "weekly" ? await loadPool() : [];
    const t = now();
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `quest-claim:${what}`,
      mutate: (user) => claimQuest(user, id, what, { now: t, env, grantCc: grantQuestCc, rollCatch: makeRollCatch(pool) }),
    });
    if (!tx.ok) {
      const { ok, status = 400, ...rest } = tx;
      return reply(status, { success: false, ...rest });
    }
    if (!tx.replayed) {
      const r = tx.result;
      logEvent("quest_claim", id, r.pokemon
        ? { what, pokemonId: r.pokemon.id, pokemonName: r.pokemon.name, tier: r.pokemon.tier, shiny: r.pokemon.shiny }
        : { what, ccAwarded: r.cc });
    }
    const user = getTrainerData()[id];
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...tx.result, ok: undefined, board: questView(user, { now: now() }) });
  }

  return { view, claim };
}
