// ==========================================================
// services/expeditionsApi.js: dashboard + /quest handlers for Expeditions.
// GET  /api/expeditions?id=        Missions, running Expeditions, caps, and
//                                  the player's copies for the party picker
// POST /api/expeditions/send       { id, mission: 0-3, uids: [..1-3], requestId? }
// POST /api/expeditions/claim      { id, expedition, requestId? }
// A repeated requestId returns the first result and never sends or pays twice.
// ==========================================================

import { ensureExpeditions, expeditionView, sendExpedition, claimExpedition, expeditionsEnabled } from "./expeditions.js";
import { runInventoryTransaction, REQUEST_ID_PATTERN, grantItem } from "./inventory.js";
import { saveAckFields } from "../utils/saveManager.js";
import { grantQuestCc, makeRollCatch } from "./questsApi.js";
import { applyGains } from "../utils/battle/runBattle.js";
import { tmItemDefinitions } from "../catalog/tms.js";
import { allCopies, slotsHolding } from "./box.js";
import { getSpeciesEntry } from "../utils/speciesCatalog.js";
import { TYPE_ID_TO_NAME } from "../utils/battle/data.js";

const reply = (status, body) => ({ status, body });
const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^\d{5,25}$/;
const EXP_ID_RE = /^x[a-z0-9]{1,14}$/;
const TEAM_NAME = { displayedPokemon: "Casual", battleTeam: "Ranked", showcaseTeam: "Showcase" };

// Basic-tier TMs on sale (catalog/tms.js); an Expedition TM is one of these.
let BASIC_TMS = null;
const basicTms = () => (BASIC_TMS ??= tmItemDefinitions().filter((d) => d.shop?.tier === "basic" && d.status === "active").map((d) => d.id));
export const pickBasicTm = (rng) => { const l = basicTms(); return l.length ? l[rng.int(l.length)] : null; };

/** The player's copies, for the party picker (names, types, Levels, which Teams hold them). */
export function pickerCopies(user) {
  return allCopies(user).map((c) => {
    const sp = getSpeciesEntry(c.id);
    return {
      uid: c.uid, id: c.id, shiny: c.variant === "shiny", level: c.level, trained: !!c.trained,
      name: sp?.name ?? `#${c.id}`,
      types: (sp?.types ?? []).map((t) => TYPE_ID_TO_NAME[t] ?? String(t)),
      teams: [...new Set(slotsHolding(user, c.uid).map((s) => TEAM_NAME[s.field]).filter(Boolean))],
    };
  });
}

export function createExpeditionHandlers({ getTrainerData, lockUser, save, loadPool, logEvent = () => {}, now = Date.now, env = process.env, rand = Math.random }) {
  const guard = (id, isAuthorized, requestId = null) => {
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (requestId != null && !REQUEST_ID_PATTERN.test(String(requestId))) return reply(400, { success: false, error: "Invalid request id" });
    if (!ownKey(getTrainerData(), id)) return reply(404, { success: false, error: "User not found" });
    return null;
  };

  async function view({ query, isAuthorized }) {
    const id = typeof query?.id === "string" ? query.id : "";
    const stop = guard(id, isAuthorized);
    if (stop) return stop;
    return lockUser(id, async () => {
      const user = getTrainerData()[id];
      const t = now();
      // Off and nothing running: nothing to show.
      if (!expeditionsEnabled(env) && !(user.expeditions?.running?.length)) return reply(200, { success: true, enabled: false });
      ensureExpeditions(user, t);
      return reply(200, { success: true, ...expeditionView(user, { now: t, env }), copies: pickerCopies(user) });
    });
  }

  async function send({ body, isAuthorized }) {
    const id = typeof body?.id === "string" ? body.id : "";
    const requestId = body?.requestId ?? null;
    const stop = guard(id, isAuthorized, requestId);
    if (stop) return stop;
    const mission = Number(body?.mission);
    const uids = Array.isArray(body?.uids) ? body.uids.map(String) : null;
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(), userId: id, lock: lockUser, save, requestId,
      payloadKey: `exp-send:${mission}:${(uids ?? []).join(",")}`,
      mutate: (user) => sendExpedition(user, { mission, uids }, { now: now(), env, rand }),
    });
    if (!tx.ok) { const { ok, status = 400, ...rest } = tx; return reply(status, { success: false, ...rest }); }
    if (!tx.replayed) logEvent("expedition_send", id, { mission: tx.result.expedition.mission.id, hours: tx.result.expedition.mission.hours, party: uids.length, chance: tx.result.expedition.chance });
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...tx.result, ok: undefined });
  }

  async function claim({ body, isAuthorized }) {
    const id = typeof body?.id === "string" ? body.id : "";
    const requestId = body?.requestId ?? null;
    const stop = guard(id, isAuthorized, requestId);
    if (stop) return stop;
    const expedition = body?.expedition;
    if (typeof expedition !== "string" || !EXP_ID_RE.test(expedition)) return reply(400, { success: false, error: "Unknown Expedition." });
    const pool = await loadPool();
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(), userId: id, lock: lockUser, save, requestId,
      payloadKey: `exp-claim:${expedition}`,
      mutate: (user) => claimExpedition(user, expedition, {
        now: now(), grantCc: grantQuestCc, grantItem: (u, item, n) => grantItem(u, item, n, { env }), rollCatch: makeRollCatch(pool),
        applyExp: (u, members, gains) => applyGains(u, members, gains), pickTm: pickBasicTm,
      }),
    });
    if (!tx.ok) { const { ok, status = 400, ...rest } = tx; return reply(status, { success: false, ...rest }); }
    const r = tx.result;
    if (!tx.replayed) {
      logEvent("expedition_claim", id, {
        mission: r.expedition.mission.id, hours: r.expedition.mission.hours, success: r.expedition.success, bonus: r.expedition.bonus,
        cc: r.cc, stones: r.items.evolution_stone ?? 0, dust: r.items.shiny_dust ?? 0, pokemon: r.pokemon.length, tms: r.tms.length,
      });
    }
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...r, ok: undefined });
  }

  return { view, send, claim };
}
