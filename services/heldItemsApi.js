// ==========================================================
// services/heldItemsApi.js — dashboard endpoints for held items.
//
//   GET  /api/held-items                 unlocks, catalog, both teams' loadouts
//   POST /api/held-items/claim-starter   the eight free starter unlocks (once)
//   POST /api/held-items/equip           equip / move within a team / remove
//   POST /api/held-items/buy             buy one unlock in the shop
//
// The dashboard (Teams page, shop) is the ONLY way to manage equipment; no
// Discord command can. Every rule is checked here, server-side, inside the
// player's lock (runInventoryTransaction: lock → requestId replay → sync
// mutation → saveAndAck). Writes REQUIRE a requestId (a double click or a
// retried request applies once) and equip takes expectedRev (a stale tab
// gets 409 "stale" with the current loadout instead of overwriting it).
// Kept out of bot_final.js so it can be tested without starting the bot.
// ==========================================================

import { runInventoryTransaction, REQUEST_ID_PATTERN } from "./inventory.js";
import { getQuantity, grantItem } from "./inventory.js";
import { listCatalog, isHeldItem, getCatalogItem } from "../catalog/items.js";
import { HELD_GROUPS } from "../catalog/heldItems.js";
import { isHeldItemCapabilityEnabled, heldItemCapabilities } from "../config/features.js";
import { saveAckFields } from "../utils/saveManager.js";
import { trackProgress } from "../progression/achievements.js";
import {
  ensureStarterHeldItems, starterPending, applyEquip, describeLoadout, equipmentRev, teamSlots,
  EDITABLE_TEAMS, lineKey, ownsHeldItem,
} from "./heldItems.js";
import { liveEffects } from "./liveEvents.js";
import { discountedPrice } from "../utils/liveEventRules.js";

const reply = (status, body) => ({ status, body });
const ID_RE = /^\d{5,25}$/;
const ownKey = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const str = (v, max = 80) => (typeof v === "string" && v.length <= max ? v : null);

/** The catalog rows the dashboard shows (never the raw record). */
export function heldCatalogRows(user) {
  return listCatalog().filter(isHeldItem).map((e) => ({
    id: e.id,
    name: e.name,
    group: e.held.group,
    groupLabel: e.held.groupLabel,
    glyph: e.held.glyph,
    icon: e.icon ? `/public/sprites/${e.icon}` : null,
    iconSmooth: !!e.held.iconSmooth,
    effect: e.held.effect,
    rule: e.held.rule,
    starter: e.held.starter,
    combat: e.held.combat,
    restrictSpecies: e.held.restrictSpecies,
    boostsType: e.held.boostsType,
    rarity: e.rarity,
    price: e.shop?.price?.cc != null ? discountedPrice(liveEffects(), "heldItems", e.shop.price.cc) : null, // a Live event's discount
    owned: getQuantity(user, e.id) > 0,
  }));
}

/** Both editable teams' loadouts. A team the player hasn't set is null. */
export function loadouts(user) {
  return Object.fromEntries(EDITABLE_TEAMS.map((t) => [t, teamSlots(user, t) ? describeLoadout(user, t) : null]));
}

/** A small per-player limiter for writes (no dashboard rate limiter exists). */
export function createRateLimiter({ max = 30, windowMs = 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return (id) => {
    const t = now();
    const list = (hits.get(id) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) { hits.set(id, list); return false; }
    list.push(t);
    hits.set(id, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v.at(-1) > windowMs) hits.delete(k);
    return true;
  };
}

/**
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {Function} deps.lockUser
 * @param {(data:object) => Promise<{saved:boolean, note:string}>} deps.save
 * @param {() => object} [deps.getEnv]
 * @param {(type:string, userId:string, data:object) => void} [deps.logEvent]
 * @param {(id:string) => boolean} [deps.allowWrite] rate limiter
 */
export function createHeldItemHandlers({ getTrainerData, lockUser, save, getEnv = () => process.env, logEvent = () => {}, allowWrite = createRateLimiter() }) {
  function authUser(id, isAuthorized) {
    if (!ID_RE.test(id)) return reply(400, { success: false, error: "Missing or invalid id" });
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (!ownKey(getTrainerData(), id)) return reply(404, { success: false, error: "User not found" });
    return null;
  }
  function writeGate(body, isAuthorized, capability) {
    const id = str(body?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return { bad };
    if (!isHeldItemCapabilityEnabled(capability, getEnv(), id)) return { bad: reply(403, { success: false, error: "Held items aren't available yet.", code: "disabled" }) };
    const requestId = body?.requestId;
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) return { bad: reply(400, { success: false, error: "Missing or invalid request id." }) };
    if (!allowWrite(id)) return { bad: reply(429, { success: false, error: "Too many changes at once. Wait a moment and try again.", code: "rate_limited" }) };
    return { id, requestId };
  }
  const txFail = (tx) => reply(tx.status ?? 400, { success: false, error: tx.error, code: tx.code, ...(tx.holder ? { holder: tx.holder } : {}), ...(tx.current ? tx.current : {}) });

  /** GET: everything the Teams page and shop need. Read-only (never grants). */
  function view({ query, isAuthorized }) {
    const id = str(query?.id, 30) ?? "";
    const bad = authUser(id, isAuthorized);
    if (bad) return bad;
    const env = getEnv();
    if (!isHeldItemCapabilityEnabled("dashboard", env, id)) return reply(200, { success: true, enabled: false });
    const user = getTrainerData()[id];
    const caps = heldItemCapabilities(env, id);
    return reply(200, {
      success: true,
      enabled: true,
      capabilities: caps,
      groups: Object.entries(HELD_GROUPS).sort((a, b) => a[1].order - b[1].order).map(([key, g]) => ({ key, label: g.label })),
      items: heldCatalogRows(user),
      starterPending: starterPending(user, { env }),
      rev: equipmentRev(user),
      teams: loadouts(user),
      cc: user.cc ?? 0,
    });
  }

  /** POST { id, requestId }: grant the starter unlocks (idempotent). */
  async function claimStarter({ body, isAuthorized }) {
    const g = writeGate(body, isAuthorized, "starter");
    if (g.bad) return g.bad;
    const env = getEnv();
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(), userId: g.id, lock: lockUser, save, requestId: g.requestId, payloadKey: "held-starter",
      mutate: (user) => {
        const r = ensureStarterHeldItems(user, { env });
        return { ok: true, granted: r.granted };
      },
    });
    if (!tx.ok) return txFail(tx);
    if (!tx.replayed && tx.result.granted.length) logEvent("held_item_starter", g.id, { granted: tx.result.granted });
    const user = getTrainerData()[g.id];
    return reply(200, { ...saveAckFields({ saved: tx.saved, note: tx.note }), success: true, replayed: !!tx.replayed, granted: tx.result.granted, items: heldCatalogRows(user) });
  }

  /**
   * POST { id, requestId, team, pokeId, variant, itemId|null, move?, expectedRev }
   * itemId null removes. move:true takes the item from the team-mate holding it.
   */
  async function equip({ body, isAuthorized }) {
    const g = writeGate(body, isAuthorized, "dashboard");
    if (g.bad) return g.bad;
    const team = str(body?.team, 20);
    if (!EDITABLE_TEAMS.includes(team)) return reply(400, { success: false, error: "Unknown team." });
    const pokeId = Number(body?.pokeId);
    if (!Number.isInteger(pokeId) || pokeId < 1 || pokeId > 99999) return reply(400, { success: false, error: "Unknown Pokémon." });
    const variant = body?.variant === "shiny" ? "shiny" : "normal";
    const itemId = body?.itemId === null ? null : str(body?.itemId, 64);
    if (itemId === undefined || (body?.itemId !== null && itemId === null)) return reply(400, { success: false, error: "Unknown item." });
    const move = body?.move === true;
    const expectedRev = body?.expectedRev;
    if (!Number.isSafeInteger(expectedRev) || expectedRev < 0) return reply(400, { success: false, error: "Missing revision. Reload the page." });
    // The slot's copy when the page names one (the item belongs to that Pokémon on this team).
    const uid = typeof body?.uid === "string" && /^c_[A-Za-z0-9]{10}$/.test(body.uid) ? body.uid : null;
    const line = uid ? `u:${uid}` : lineKey(pokeId, variant);
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(), userId: g.id, lock: lockUser, save, requestId: g.requestId,
      payloadKey: `held-equip:${team}:${line}:${itemId ?? "-"}:${move ? 1 : 0}:${expectedRev}`,
      mutate: (user) => {
        // All-or-nothing: every check runs before the single change below.
        // (The starter grant is its own request, claim-starter, so a refused
        // equip never leaves a half-applied change in memory.)
        if (equipmentRev(user) !== expectedRev) {
          return { ok: false, status: 409, code: "stale", error: "Your items changed in another tab or window. Here's the latest.", current: { rev: equipmentRev(user), teams: loadouts(user) } };
        }
        const r = applyEquip(user, { teamId: team, line, itemId, move });
        if (!r.ok) return { ...r, current: { rev: equipmentRev(user), teams: loadouts(user) } };
        return { ok: true, change: { team, line, item: r.item, from: r.from, replaced: r.replaced, changed: r.changed } };
      },
    });
    if (!tx.ok) return txFail(tx);
    if (!tx.replayed && tx.result.change.changed) logEvent("held_item_equip", g.id, { team, item: itemId ?? null, moved: !!tx.result.change.from });
    const user = getTrainerData()[g.id];
    return reply(200, { ...saveAckFields({ saved: tx.saved, note: tx.note }), success: true, replayed: !!tx.replayed, change: tx.result.change, rev: equipmentRev(user), teams: loadouts(user), items: heldCatalogRows(user) });
  }

  /** POST { id, requestId, itemId }: buy one unlock (price from the catalog only). */
  async function buy({ body, isAuthorized }) {
    const g = writeGate(body, isAuthorized, "shop");
    if (g.bad) return g.bad;
    const itemId = str(body?.itemId, 64);
    const entry = itemId ? getCatalogItem(itemId) : null;
    if (!isHeldItem(entry)) return reply(400, { success: false, error: "That isn't a held item." });
    const listPrice = entry.shop?.eligible ? entry.shop?.price?.cc : null;
    if (!Number.isSafeInteger(listPrice) || listPrice <= 0) return reply(400, { success: false, error: `${entry.name} isn't sold in the shop.`, code: "not_for_sale" });
    const price = discountedPrice(liveEffects(), "heldItems", listPrice); // a Live event's discount
    const env = getEnv();
    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(), userId: g.id, lock: lockUser, save, requestId: g.requestId, payloadKey: `held-buy:${itemId}`,
      mutate: (user) => {
        if (ownsHeldItem(user, itemId)) return { ok: false, status: 409, code: "already_owned", error: `You already own ${entry.name}. One unlock works on every team.` };
        const cc = Number.isSafeInteger(user.cc) ? user.cc : 0;
        if (cc < price) return { ok: false, status: 400, code: "insufficient_cc", error: `Not enough CC: ${entry.name} costs ${price.toLocaleString()} CC.` };
        const granted = grantItem(user, itemId, 1, { env });
        if (!granted.ok) return { ok: false, status: 409, code: granted.code ?? "refused", error: granted.error };
        user.cc = cc - price;
        trackProgress(user, [{ type: "purchase" }]);
        return { ok: true, cc: user.cc, itemId, price };
      },
    });
    if (!tx.ok) return txFail(tx);
    if (!tx.replayed) logEvent("held_item_purchase", g.id, { item: itemId, cost: price });
    const user = getTrainerData()[g.id];
    return reply(200, { ...saveAckFields({ saved: tx.saved, note: tx.note }), success: true, replayed: !!tx.replayed, cc: tx.result.cc, itemId, items: heldCatalogRows(user) });
  }

  return { view, claimStarter, equip, buy };
}
