// ==========================================================
// routes/liveEventsAdmin.js — admin API for Live events
// (docs/design/live-events.md). Mounted by routes/admindashboard.js with
// its auth: reads take a session or the shared token, writes the Discord
// session only. Every write needs a reason and is an audited Admin change.
//
//   GET  /api/admin/live-events               list + settings + picker data
//   POST /api/admin/live-events/preview       validate + Poké Ball odds
//   POST /api/admin/live-events               create
//   POST /api/admin/live-events/:id/edit      edit (scheduled or running)
//   POST /api/admin/live-events/:id/end       End now (running)
//   POST /api/admin/live-events/:id/delete    delete (not started yet)
//   POST /api/admin/live-events/channel       announcement channel
// ==========================================================

import { readFileSync } from "fs";
import {
  listLiveEvents, liveEventSettings, checkLiveEvent, createLiveEvent, updateLiveEvent,
  endLiveEvent, deleteLiveEvent, setAnnounceChannel, getLiveEvent,
} from "../services/liveEvents.js";
import {
  EFFECT_KINDS, DISCOUNT_CATEGORIES, TIERS, TYPES, REGIONS, statusOf, stopAt, combine, oddsSummary, overlaps,
} from "../utils/liveEventRules.js";
import { effectText } from "../utils/liveEventText.js";
import { rollRows } from "../utils/weightedRandom.js";
import { acquirablePokemon } from "../utils/speciesCatalog.js";

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const BALLS = ["pokeball", "greatball", "ultraball"];

const view = (e, now) => ({
  ...e,
  status: statusOf(e, now),
  stopAt: stopAt(e),
  effects: e.effects.map((f) => ({ ...f, text: effectText(f) })),
});

/**
 * Odds a Poké Ball (or Great/Ultra Ball) roll would have at the event's start,
 * with every other event running at that moment, against no events at all.
 * A Novice player (no Rank buffs) so the figures are the plain table.
 */
export function previewOdds(event, others, ball = "pokeball") {
  const at = Math.max(event.startAt, Date.now());
  const peers = others.filter((o) => o.id !== event.id && overlaps(event, o));
  const fx = combine([{ ...event, id: event.id ?? 0, startAt: Math.min(event.startAt, at) }, ...peers], at);
  const pool = acquirablePokemon(Object.values(pokemonData));
  const player = { tp: 0 };
  const normal = rollRows(pool, player, ball, combine([], at));
  const during = rollRows(pool, player, ball, fx);
  return {
    ball,
    alsoRunning: fx.events.filter((e) => e.id !== (event.id ?? 0)).map((e) => e.name),
    normal: oddsSummary(normal),
    during: oddsSummary(during, normal),
  };
}

export function mountLiveEventRoutes(router, { requireRead, requireWrite, json }) {
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});
  const admin = (req) => ({ id: req.admin?.id ?? null, name: req.admin?.name ?? null });
  const send = (res, r) => (r.ok ? res.json({ ok: true, ...r, event: r.event ? view(r.event, Date.now()) : undefined }) : res.status(r.status ?? 400).json({ ok: false, error: r.error }));

  router.get("/api/admin/live-events", requireRead, (req, res) => {
    const now = Date.now();
    res.json({
      ok: true,
      now,
      events: listLiveEvents().map((e) => view(e, now)).sort((a, b) => b.startAt - a.startAt),
      settings: liveEventSettings(),
      kinds: EFFECT_KINDS,
      categories: DISCOUNT_CATEGORIES,
      tiers: TIERS,
      types: TYPES,
      regions: REGIONS,
    });
  });

  router.post("/api/admin/live-events/preview", requireWrite, json, (req, res) => {
    const b = body(req);
    const id = b.id != null ? Number(b.id) : null;
    const existing = id != null ? getLiveEvent(id) : null;
    // A running event keeps its start, as the edit will.
    const raw = existing && statusOf(existing, Date.now()) === "running" ? { ...b.event, startAt: existing.startAt } : b.event;
    const r = checkLiveEvent(raw, id);
    if (r.error) return res.json({ ok: true, valid: false, error: r.error });
    const ball = BALLS.includes(b.ball) ? b.ball : "pokeball";
    const others = listLiveEvents();
    const hasCatch = r.event.effects.some((f) => f.kind === "catchBoost" || f.kind === "catchLimit");
    res.json({
      ok: true,
      valid: true,
      effects: r.event.effects.map(effectText),
      odds: hasCatch ? previewOdds({ ...r.event, id }, others, ball) : null,
    });
  });

  router.post("/api/admin/live-events", requireWrite, json, async (req, res) => {
    const b = body(req);
    send(res, await createLiveEvent(b.event, { admin: admin(req), reason: b.reason }));
  });

  router.post("/api/admin/live-events/channel", requireWrite, json, async (req, res) => {
    send(res, await setAnnounceChannel(body(req).channelId, { admin: admin(req) }));
  });

  router.post("/api/admin/live-events/:id/edit", requireWrite, json, async (req, res) => {
    const b = body(req);
    send(res, await updateLiveEvent(req.params.id, b.event, { admin: admin(req), reason: b.reason }));
  });

  router.post("/api/admin/live-events/:id/end", requireWrite, json, async (req, res) => {
    send(res, await endLiveEvent(req.params.id, { admin: admin(req), reason: body(req).reason }));
  });

  router.post("/api/admin/live-events/:id/delete", requireWrite, json, async (req, res) => {
    send(res, await deleteLiveEvent(req.params.id, { admin: admin(req), reason: body(req).reason }));
  });
}
