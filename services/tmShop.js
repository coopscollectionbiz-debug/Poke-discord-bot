// ==========================================================
// services/tmShop.js — the TM shop (TM system phase T3).
//
// Pure functions; the routes in bot_final.js add the session check, the
// user lock (runInventoryTransaction: one locked, saved, idempotent
// mutation per requestId) and the event log.
//
//   tmShopView(user)       → what the dashboard lists (server-derived only)
//   buyTms(user, {item,qty}) → spend CC, grant TMs (all-or-nothing)
//
// Rules:
//   • Shop switched off (TM_ENABLED unset) → nothing listed, purchases
//     refused. Owned TMs always stay in the bag.
//   • Only "active" TM items are sold (156 launch TMs); held TMs never.
//   • Price comes from the catalog (owner decision D-T6), never the client.
//   • 1–10 per purchase. A weekly counter is always kept
//     (user.tmShop = { week, bought }); the cap applies only when
//     TM_WEEKLY_CAP is set (D-T7: off at launch). The counter field is
//     created by the first purchase, so other players' records never change.
// ==========================================================

import { listCatalog, getCatalogItem } from "../catalog/items.js";
import { getQuantity, grantItem } from "./inventory.js";
import { canLearnByTm } from "../utils/battle/tmData.js";
import { getISOWeekKeyUTC } from "../utils/economyRules.js";
import { isTmEnabled, tmWeeklyCap } from "../config/tmFeatures.js";
import { trackProgress } from "../progression/achievements.js";
import { liveEffects } from "./liveEvents.js";
import { discountedPrice } from "../utils/liveEventRules.js";
import { getSpecies } from "../utils/battle/data.js";
import { getTraining } from "../utils/training.js";
import { learnableMoves } from "./movesets.js";
import { customCopiesOf, plainCount } from "./ownership.js";

export const MAX_TMS_PER_PURCHASE = 10;

// Team fields → the names players see. Casual and Ranked sort to the top of
// the learner list; Showcase is shown but not prioritised (owner, 2026-11-13).
const TEAMS = [["casual", "displayedPokemon"], ["ranked", "battleTeam"], ["showcase", "showcaseTeam"]];
const PRIORITY_TEAMS = new Set(["casual", "ranked"]);

/**
 * The player's Pokémon that can learn one TM, for the shop's buy dialog.
 * One row per species + Variant owned. Rows on the Casual or Ranked team
 * come first (Casual slot order, then Ranked), then everything else by
 * Level, then name. `known` = every copy already knows the move.
 */
export function tmLearners(user, itemId, { env = process.env } = {}) {
  if (!isTmEnabled(env)) return fail(403, "TMs aren't available yet.", "disabled");
  const entry = getCatalogItem(itemId);
  if (!entry || entry.category !== "tm" || entry.status !== "active") return fail(404, "Unknown TM.", "bad_item");
  const move = entry.tm.move;

  // First team slot of each species:variant → [teamOrder, slotIndex].
  const onTeams = new Map();
  TEAMS.forEach(([team, field], order) => {
    (Array.isArray(user?.[field]) ? user[field] : []).forEach((s, i) => {
      const id = Number(typeof s === "object" && s ? s.id : s);
      if (!Number.isInteger(id)) return;
      const key = `${id}:${s?.variant === "shiny" ? "shiny" : "normal"}`;
      const e = onTeams.get(key) ?? { teams: [], rank: null };
      if (!e.teams.includes(team)) e.teams.push(team);
      if (PRIORITY_TEAMS.has(team) && e.rank == null) e.rank = order * 100 + i;
      onTeams.set(key, e);
    });
  });

  const rows = [];
  for (const [sid, counts] of Object.entries(user?.pokemon ?? {})) {
    const id = Number(sid);
    if (!canLearnByTm(id, move)) continue;
    const species = getSpecies(id);
    if (!species) continue;
    for (const variant of ["normal", "shiny"]) {
      if (!(Number(counts?.[variant]) > 0)) continue;
      const copies = [...(plainCount(user, id, variant) > 0 ? [null] : []), ...customCopiesOf(user, id, variant).map((c) => c.uid)];
      const known = copies.length > 0 && copies.every((uid) => learnableMoves(user, id, variant, { uid }).some((m) => m.id === move));
      const t = onTeams.get(`${id}:${variant}`);
      rows.push({ speciesId: id, name: species.name, variant, level: getTraining(user, id, variant).level, teams: t?.teams ?? [], known, rank: t?.rank ?? null });
    }
  }
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.level - a.level || a.name.localeCompare(b.name) || (a.variant === "shiny") - (b.variant === "shiny"));
  return { ok: true, item: itemId, learners: rows.map(({ rank, ...r }) => ({ ...r, priority: rank != null })) };
}
const fail = (status, error, code, extra = {}) => ({ ok: false, status, error, code, ...extra });

/** Sold TM catalog entries (status active, shop eligible). */
export const sellableTms = () => listCatalog().filter((i) => i.category === "tm" && i.status === "active" && i.shop?.eligible);

/** This week's purchases (0 when the counter is from another week). */
export function tmBoughtThisWeek(user, now = new Date()) {
  const s = user?.tmShop;
  return s && s.week === getISOWeekKeyUTC(now) && Number.isSafeInteger(s.bought) && s.bought > 0 ? s.bought : 0;
}

/** Species ids (any variant) the player owns at least one copy of. */
function ownedSpecies(user) {
  return Object.entries(user?.pokemon ?? {})
    .filter(([, e]) => (Number(e?.normal) || 0) > 0 || (Number(e?.shiny) || 0) > 0)
    .map(([id]) => Number(id));
}

/**
 * What the dashboard shows. `teaches` = how many of the player's owned
 * species can learn the move (computed here, never trusted from a client).
 */
export function tmShopView(user, { env = process.env, now = new Date() } = {}) {
  const enabled = isTmEnabled(env);
  const cap = tmWeeklyCap(env);
  const bought = tmBoughtThisWeek(user, now);
  const base = { enabled, cc: Number(user?.cc) || 0, weekly: { bought, cap, remaining: cap == null ? null : Math.max(0, cap - bought) }, maxPerPurchase: MAX_TMS_PER_PURCHASE };
  if (!enabled) return { ...base, tms: [] };
  const owned = ownedSpecies(user);
  const tms = sellableTms().map((i) => ({
    item: i.id,
    move: i.tm.move,
    name: i.name,
    number: i.tm.number,
    type: i.tm.type,
    category: i.tm.category,
    power: i.tm.power,
    accuracy: i.tm.accuracy,
    tier: i.shop.tier,
    price: discountedPrice(liveEffects(), "tms", i.shop.price.cc), // a Live event's discount
    owned: getQuantity(user, i.id),
    teaches: owned.filter((sid) => canLearnByTm(sid, i.tm.move)).length,
    description: i.description,
  }));
  return { ...base, tms };
}

/**
 * Buy `qty` of one TM. IN PLACE on success only; every check runs first.
 * @returns {{ok:true, item, qty, cost, cc, quantity, weekly} | {ok:false, status, error, code}}
 */
export function buyTms(user, { item, qty = 1 } = {}, { env = process.env, now = new Date() } = {}) {
  if (!isTmEnabled(env)) return fail(403, "The TM shop isn't open yet.", "disabled");
  const entry = getCatalogItem(item);
  if (!entry || entry.category !== "tm") return fail(400, "Unknown TM.", "unknown_tm");
  if (entry.status !== "active" || !entry.shop?.eligible) return fail(400, `${entry.name} isn't for sale.`, "not_for_sale");
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_TMS_PER_PURCHASE) return fail(400, `Buy 1–${MAX_TMS_PER_PURCHASE} at a time.`, "bad_quantity");

  const cap = tmWeeklyCap(env);
  const bought = tmBoughtThisWeek(user, now);
  if (cap != null && bought + qty > cap) {
    return fail(400, `You can buy ${Math.max(0, cap - bought)} more TM${cap - bought === 1 ? "" : "s"} this week (limit ${cap}).`, "weekly_cap", { remaining: Math.max(0, cap - bought) });
  }
  const price = discountedPrice(liveEffects(now.getTime()), "tms", entry.shop.price.cc); // a Live event's discount
  const cost = price * qty;
  const cc = Number(user.cc) || 0;
  if (cc < cost) return fail(400, `Not enough CC — ${qty > 1 ? `${qty} × ` : ""}${entry.name} costs ${cost.toLocaleString("en-US")} CC.`, "insufficient_cc", { cc });

  const granted = grantItem(user, entry.id, qty);
  if (!granted.ok) return fail(400, granted.error ?? "Couldn't add the TM to your bag.", granted.code ?? "grant_refused");
  user.cc = cc - cost;
  user.tmShop = { week: getISOWeekKeyUTC(now), bought: bought + qty };
  trackProgress(user, [{ type: "purchase", n: qty }]);
  return {
    ok: true,
    item: entry.id,
    name: entry.name,
    qty,
    price,
    cost,
    cc: user.cc,
    quantity: granted.quantity,
    weekly: { bought: bought + qty, cap, remaining: cap == null ? null : Math.max(0, cap - bought - qty) },
  };
}
