// ==========================================================
// routes/admindashboard.js — Admin API router
// ==========================================================
//
// Reads (GET):
//   /api/admin/session          — who is signed in, when the session ends
//   /api/admin/stats            — server-wide aggregates (Overview)
//   /api/admin/users            — one summary row per player (Players)
//   /api/admin/player/:id       — one player, shaped for the player page
//   /api/admin/user/:id         — one player's raw record (Summary → Raw record)
//   /api/admin/catalog          — Pokémon, items, trainers and cooldowns for pickers
//   /api/admin/audit            — Admin changes (filter by userId/adminId/batchId)
//   /api/admin/events           — the 30-day event log (shown as "Activity log")
//   /api/admin/live-events      — Live events (routes/liveEventsAdmin.js has the writes too)
//
// Writes (POST, JSON):
//   /api/admin/change/preview   — dry run of one change on one player
//   /api/admin/change           — apply it
//   /api/admin/bulk/preview     — who a bulk grant would reach
//   /api/admin/bulk             — apply a bulk grant to an exact list
//
// AUTH
// ----
// Reads accept the Discord admin session (cookie from /admindashboard) or
// the shared ADMIN_DASH_TOKEN in the x-admin-token header (scripts).
// Writes accept ONLY the Discord session, so every Admin change is tied to
// a person, and refuse requests whose Origin is another site.
// Design: docs/design/admin-dashboard-overhaul.md.
// ==========================================================

import { AURAS } from "../catalog/auras.js";
import express from "express";
import { getRank } from "../utils/rankSystem.js";
import { readEvents } from "../utils/eventLog.js";
import { appendAudit as defaultAppendAudit, readAudit as defaultReadAudit } from "../utils/adminAudit.js";
import { createAdminHandlers } from "../services/adminApi.js";
import { COOLDOWNS, cooldownState, lastActiveOf, teamSlotsOf, speciesLabel } from "../services/adminChanges.js";
import { getSpeciesEntry, allSpeciesIds, isAcquirable } from "../utils/speciesCatalog.js";
import { getTraining } from "../utils/training.js";
import { listCatalog, isHoldable, CATEGORIES } from "../catalog/items.js";
import { listInventory } from "../services/inventory.js";
import { normalizeTrainers } from "../services/assets.js";
import { loadTrainerSprites } from "../utils/dataLoader.js";
import { rankedRecord } from "../utils/battle/rewards.js";
import { copiesOf, slotsHolding } from "../services/box.js";
import { mountLiveEventRoutes } from "./liveEventsAdmin.js";

const toNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const BASE_RANK = "Novice Trainer";

/**
 * Mount the admin dashboard API onto an Express app.
 *
 * @param {import("express").Express} app
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {(req) => string|null} deps.requireAdminSession
 * @param {(req) => ({id:string, name:string, expires:number}|null)} [deps.adminSessionOf]
 * @param {(id:string, fn:Function) => Promise<any>} [deps.lockUser]
 * @param {(data:object) => Promise<{saved:boolean, note:string}>} [deps.save]
 * @param {() => string|null} [deps.writeBlocked] - why writes are refused right now, or null
 * @param {(userId:string, tp:number) => Promise<{ok:boolean, reason?:string}>} [deps.syncRole]
 * @param {Function} [deps.appendAudit]
 * @param {Function} [deps.readAudit]
 */
export function mountAdminDashboard(app, deps) {
  const {
    getTrainerData,
    requireAdminSession,
    adminSessionOf = (req) => {
      const id = requireAdminSession(req);
      return id ? { id, name: "", expires: 0 } : null;
    },
    lockUser = async (_id, fn) => fn(),
    save = async () => ({ saved: false, note: "Saving isn't connected." }),
    writeBlocked = () => null,
    syncRole,
    appendAudit = defaultAppendAudit,
    readAudit = defaultReadAudit,
  } = deps;
  const router = express.Router();

  // ----------------------------------------------------------
  // Auth
  // ----------------------------------------------------------
  /** Reads: Discord session, or the shared token in a header. */
  function requireRead(req, res, next) {
    const session = adminSessionOf(req);
    if (session) {
      req.admin = session;
      return next();
    }
    const token = process.env.ADMIN_DASH_TOKEN || "";
    const supplied = req.headers["x-admin-token"];
    if (token && supplied && supplied === token) {
      req.admin = { id: "shared-token", name: "shared token", readOnly: true };
      return next();
    }
    return res.status(403).json({ ok: false, error: "Session expired. Run /admindashboard in Discord for a new link." });
  }

  /** Writes: Discord session only, same site, JSON, bot ready to save. */
  function requireWrite(req, res, next) {
    const session = adminSessionOf(req);
    if (!session) return res.status(403).json({ ok: false, error: "Session expired. Run /admindashboard in Discord for a new link." });
    const origin = req.headers.origin;
    if (origin) {
      let host = "";
      try {
        host = new URL(origin).host;
      } catch {}
      if (host !== req.headers.host) return res.status(403).json({ ok: false, error: "Request came from another site." });
    }
    if (!req.is("application/json")) return res.status(415).json({ ok: false, error: "Send JSON." });
    const blocked = writeBlocked();
    if (blocked) return res.status(503).json({ ok: false, error: blocked });
    req.admin = session;
    return next();
  }

  const json = express.json({ limit: "256kb" });

  // ----------------------------------------------------------
  // Catalog (pickers). Built once; trainer sprites load lazily.
  // ----------------------------------------------------------
  const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  let trainerCatalog = null;
  async function getTrainerCatalog() {
    if (trainerCatalog) return trainerCatalog;
    const sprites = (await loadTrainerSprites()) || {};
    const list = [];
    for (const [group, info] of Object.entries(sprites)) {
      const files = (Array.isArray(info?.sprites) ? info.sprites : [])
        .map((s) => (typeof s === "string" ? s : s && !s.disabled && s.file ? s.file : null))
        .filter(Boolean);
      files.forEach((file, i) => {
        list.push({
          key: file,
          name: files.length > 1 ? `${titleCase(group)} (${i + 1})` : titleCase(group),
          tier: String(info?.tier || "Common"),
        });
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    trainerCatalog = { list, byKey: new Map(list.map((t) => [t.key.toLowerCase(), t])) };
    return trainerCatalog;
  }
  const trainerKeys = async () => new Map([...(await getTrainerCatalog()).byKey].map(([k, t]) => [k, t.key]));
  const trainerName = (key) => trainerCatalog?.byKey.get(String(key).toLowerCase())?.name ?? key;

  let speciesCatalog = null;
  function getSpeciesCatalog() {
    speciesCatalog ??= allSpeciesIds()
      .filter(Number.isInteger)
      .map((id) => {
        const e = getSpeciesEntry(id);
        return { id, name: e?.name ?? `#${id}`, tier: e?.tier ?? "common", generation: e?.generation ?? null, released: isAcquirable(id) };
      });
    return speciesCatalog;
  }

  const handlers = createAdminHandlers({
    getTrainerData,
    lockUser,
    save,
    appendAudit,
    syncRole,
    getTrainerKeys: trainerKeys,
    trainerName,
  });

  const send = (res, r) => res.status(r.status).json(r.body);
  // Rank follows TP (the stored rank can lag behind until the next role sync).
  const rankOf = (u) => getRank(toNumber(u?.tp)) || BASE_RANK;
  const copiesOf = (u) => Object.values(u?.pokemon || {}).reduce((n, e) => n + toNumber(e?.normal) + toNumber(e?.shiny), 0);

  // ==========================================================
  // Reads
  // ==========================================================
  router.get("/api/admin/session", requireRead, (req, res) => {
    res.json({ ok: true, id: req.admin.id, name: req.admin.name, expires: req.admin.expires ?? null, readOnly: !!req.admin.readOnly });
  });

  router.get("/api/admin/users", requireRead, (req, res) => {
    const td = getTrainerData() || {};
    const users = Object.entries(td).map(([userId, u]) => ({
      userId,
      name: u?.name ?? "",
      rank: rankOf(u),
      tp: toNumber(u?.tp),
      cc: toNumber(u?.cc),
      pokemonCount: copiesOf(u),
      speciesCount: Object.values(u?.pokemon || {}).filter((e) => toNumber(e?.normal) + toNumber(e?.shiny) > 0).length,
      trainerCount: normalizeTrainers({ trainers: u?.trainers }).length,
      lastActive: lastActiveOf(u),
      onboardingComplete: !!u?.onboardingComplete,
    }));
    res.json({ ok: true, users, total: users.length });
  });

  router.get("/api/admin/user/:id", requireRead, (req, res) => {
    const user = (getTrainerData() || {})[req.params.id];
    if (!user) return res.status(404).json({ ok: false, error: "Player not found." });
    res.json({ ok: true, userId: req.params.id, user });
  });

  router.get("/api/admin/player/:id", requireRead, async (req, res) => {
    const id = req.params.id;
    const user = (getTrainerData() || {})[id];
    if (!user) return res.status(404).json({ ok: false, error: "Player not found." });
    const tc = await getTrainerCatalog();

    const pokemon = [];
    for (const [sid, counts] of Object.entries(user.pokemon || {})) {
      const n = Number(sid);
      if (!Number.isInteger(n)) continue;
      const e = getSpeciesEntry(n);
      for (const variant of ["normal", "shiny"]) {
        const count = toNumber(counts?.[variant]);
        if (count <= 0) continue;
        pokemon.push({
          id: n,
          variant,
          name: e?.name ?? speciesLabel(n),
          tier: e?.tier ?? "common",
          count,
          level: getTraining(user, n, variant).level,
          teams: teamSlotsOf(user, n, variant).map((s) => `${s.label} ${s.slot}`),
          // Every copy (docs/adr/0001): its Level, TM training and team slots.
          copies: copiesOf(user, n, variant).map((c) => ({
            uid: c.uid, level: c.level, trained: c.trained,
            teams: slotsHolding(user, c.uid).map((s) => ({ displayedPokemon: "Casual", battleTeam: "Ranked", showcaseTeam: "Showcase" }[s.field] + ` ${s.index + 1}`)),
          })),
        });
      }
    }
    pokemon.sort((a, b) => a.id - b.id || Number(a.variant === "shiny") - Number(b.variant === "shiny"));

    const items = listInventory(user).map((r) => ({ id: r.id, name: r.name, category: r.categoryLabel, rarity: r.rarity, quantity: r.quantity, icon: r.icon, known: r.known }));
    const displayed = String(user.displayedTrainer ?? "").toLowerCase();
    const trainers = normalizeTrainers({ trainers: user.trainers }).map((key) => {
      const t = tc.byKey.get(key.toLowerCase());
      return { key, name: t?.name ?? key, tier: t?.tier ?? "", displayed: key.toLowerCase() === displayed, known: !!t };
    });
    const now = Date.now();
    const cooldowns = Object.entries(COOLDOWNS).map(([key, label]) => ({ key, label, state: cooldownState(user, key, now) }));
    const ranked = rankedRecord(user);

    res.json({
      ok: true,
      player: {
        userId: id,
        name: user.name ?? "",
        cc: toNumber(user.cc),
        tp: toNumber(user.tp),
        rank: rankOf(user),
        lastActive: lastActiveOf(user),
        onboardingComplete: !!user.onboardingComplete,
        battleRating: ranked.rating,
        rankedWins: ranked.wins,
        rankedLosses: ranked.losses,
        pendingWager: user.pendingWager ? { stake: toNumber(user.pendingWager.stake), expiresAt: toNumber(user.pendingWager.expiresAt) } : null,
        teamSize: Array.isArray(user.displayedPokemon) ? user.displayedPokemon.length : 0,
        battleTeamSize: Array.isArray(user.battleTeam) ? user.battleTeam.length : null,
        copies: copiesOf(user),
      },
      pokemon,
      items,
      trainers,
      cooldowns,
    });
  });

  router.get("/api/admin/catalog", requireRead, async (req, res) => {
    const t = await getTrainerCatalog();
    const items = listCatalog()
      .filter((e) => isHoldable(e.id))
      .map((e) => ({ id: e.id, name: e.name, category: CATEGORIES[e.category]?.label ?? e.category, rarity: e.rarity, maxStack: e.maxStack ?? null, icon: e.icon ?? null }));
    res.json({
      ok: true,
      species: getSpeciesCatalog(),
      items,
      trainers: t.list,
      cooldowns: Object.entries(COOLDOWNS).map(([key, label]) => ({ key, label })),
      auras: AURAS.filter((a) => !(a.kind === "event" && a.retired)).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    });
  });

  router.get("/api/admin/stats", requireRead, (req, res) => {
    const td = getTrainerData() || {};
    const now = Date.now();
    const DAY = 86_400_000;
    const s = { totalUsers: 0, onboarded: 0, totalCC: 0, totalTP: 0, totalPokemonSpecies: 0, totalPokemonVariants: 0, totalTrainers: 0, active24h: 0, active7d: 0 };
    const topByTp = [];
    for (const [userId, u] of Object.entries(td)) {
      s.totalUsers++;
      s.totalCC += toNumber(u?.cc);
      s.totalTP += toNumber(u?.tp);
      s.totalTrainers += normalizeTrainers({ trainers: u?.trainers }).length;
      if (u?.onboardingComplete) s.onboarded++;
      for (const v of Object.values(u?.pokemon || {})) {
        const c = toNumber(v?.normal) + toNumber(v?.shiny);
        s.totalPokemonVariants += c;
        if (c > 0) s.totalPokemonSpecies++;
      }
      const last = lastActiveOf(u);
      if (last > 0) {
        if (now - last <= DAY) s.active24h++;
        if (now - last <= 7 * DAY) s.active7d++;
      }
      topByTp.push({ userId, name: u?.name ?? "", tp: toNumber(u?.tp), rank: rankOf(u) });
    }
    topByTp.sort((a, b) => b.tp - a.tp);
    res.json({ ok: true, ...s, topByTp: topByTp.slice(0, 10) });
  });

  router.get("/api/admin/audit", requireRead, async (req, res) => {
    const limit = Math.min(500, Math.max(1, toNumber(req.query.limit) || 100));
    const offset = Math.max(0, toNumber(req.query.offset) || 0);
    const pick = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const r = await readAudit({ userId: pick(req.query.userId), adminId: pick(req.query.adminId), batchId: pick(req.query.batchId), limit, offset });
    res.json({ ok: true, ...r, limit, offset });
  });

  router.get("/api/admin/events", requireRead, async (req, res) => {
    const limit = Math.min(1000, Math.max(1, toNumber(req.query.limit) || 100));
    const offset = Math.max(0, toNumber(req.query.offset) || 0);
    const { total, events } = await readEvents({
      type: req.query.type || null,
      userId: req.query.userId || null,
      since: req.query.since ? toNumber(req.query.since) : null,
      until: req.query.until ? toNumber(req.query.until) : null,
      limit,
      offset,
    });
    res.json({ ok: true, total, events, limit, offset });
  });

  // ==========================================================
  // Writes
  // ==========================================================
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

  router.post("/api/admin/change/preview", requireWrite, json, async (req, res) => {
    const b = body(req);
    send(res, await handlers.preview({ userId: String(b.userId ?? ""), change: b.change, allowUnreleased: b.allowUnreleased === true }));
  });

  router.post("/api/admin/change", requireWrite, json, async (req, res) => {
    const b = body(req);
    send(res, await handlers.apply({ admin: req.admin, userId: String(b.userId ?? ""), change: b.change, reason: b.reason, allowUnreleased: b.allowUnreleased === true, requestId: b.requestId }));
  });

  router.post("/api/admin/bulk/preview", requireWrite, json, async (req, res) => {
    const b = body(req);
    send(res, await handlers.bulkPreview({ change: b.change, target: { ...(b.target || {}), allowUnreleased: b.allowUnreleased === true } }));
  });

  router.post("/api/admin/bulk", requireWrite, json, async (req, res) => {
    const b = body(req);
    send(res, await handlers.bulkApply({ admin: req.admin, change: b.change, userIds: b.userIds, reason: b.reason, allowUnreleased: b.allowUnreleased === true, requestId: b.requestId }));
  });

  // Live events (routes/liveEventsAdmin.js), same auth.
  mountLiveEventRoutes(router, { requireRead, requireWrite, json });

  app.use(router);
  return { handlers };
}
