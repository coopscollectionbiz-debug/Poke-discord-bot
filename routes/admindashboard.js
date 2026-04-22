// ==========================================================
// routes/admindashboard.js — Admin API router
// ==========================================================
//
// PURPOSE
// -------
// Provides read-only analytics endpoints for the admin dashboard:
//   • GET /api/admin/users       — per-user summary list
//   • GET /api/admin/user/:id    — full record for drill-down
//   • GET /api/admin/stats       — server-wide aggregates
//   • GET /api/admin/events      — timestamped event log
//
// DUAL AUTH MODEL
// ---------------
// Every endpoint accepts EITHER of:
//
//   1. A session cookie minted via /admindashboard slash command +
//      /auth/admin redirect. This is the normal, human-facing path.
//      Handled by requireAdminSession(req) — returns the admin's
//      Discord user ID or null.
//
//   2. A shared-secret header/query/cookie: x-admin-token /
//      ?token=... / admin_token cookie, compared against the
//      ADMIN_DASH_TOKEN env var. This is the script-friendly path
//      for curl/ops tooling where spinning up a Discord session
//      isn't practical.
//
// Either passing grants full access. The write-endpoint TODO will
// be added later behind the same guard.
//
// WHY READ-ONLY FOR NOW
// ---------------------
// Shipping read-only means the admin dashboard cannot cause any
// game state changes, which dramatically limits blast radius if
// something goes wrong. Write endpoints can be added later as a
// deliberate, testable follow-up.
// ==========================================================

import express from "express";
import { getRank } from "../utils/rankSystem.js";
import { readEvents } from "../utils/eventLog.js";

/**
 * Mount the admin dashboard API onto an Express app.
 *
 * @param {import("express").Express} app
 * @param {object} deps
 * @param {() => object} deps.getTrainerData - Returns the live trainerData map
 * @param {(req: import("express").Request) => string|null} deps.requireAdminSession - Cookie session checker
 */
export function mountAdminDashboard(app, deps) {
  const { getTrainerData, requireAdminSession } = deps;
  const router = express.Router();

  // ----------------------------------------------------------
  // 🔐 Auth: session cookie OR shared-secret token
  // ----------------------------------------------------------
  const ADMIN_TOKEN = process.env.ADMIN_DASH_TOKEN || "";

  /**
   * Middleware that passes if ANY auth method succeeds:
   *   - valid admin_session cookie (via requireAdminSession)
   *   - ADMIN_DASH_TOKEN matches query ?token / x-admin-token header / admin_token cookie
   */
  function requireAuth(req, res, next) {
    // Path 1: Discord-linked session
    const adminUserId = requireAdminSession(req);
    if (adminUserId) {
      req.adminUserId = adminUserId;
      return next();
    }

    // Path 2: shared-secret token
    if (ADMIN_TOKEN) {
      const supplied =
        req.query.token ||
        req.headers["x-admin-token"] ||
        (req.cookies ? req.cookies["admin_token"] : null);
      if (supplied && supplied === ADMIN_TOKEN) {
        req.adminUserId = "shared-token";
        return next();
      }
    }

    return res.status(403).json({ error: "Admin authentication required" });
  }

  // ----------------------------------------------------------
  // 🧮 Helpers
  // ----------------------------------------------------------

  /**
   * Given a user record, find the most recent of their cooldown
   * timestamps. Used for "last active" sorting and 24h/7d buckets.
   */
  function lastActiveOf(u) {
    const candidates = [
      toNumber(u?.lastDaily),
      toNumber(u?.lastRecruit),
      toNumber(u?.lastQuest),
      toNumber(u?.lastWeeklyPack),
    ].filter((n) => n > 0);
    return candidates.length ? Math.max(...candidates) : 0;
  }

  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Count unique Pokemon species (not variant count).
   */
  function pokemonSpeciesCount(u) {
    return u?.pokemon ? Object.keys(u.pokemon).length : 0;
  }

  /**
   * trainers is normalized to an array post-normalizeUserSchema.
   * Fall back defensively in case we're reading pre-normalized data.
   */
  function trainerCount(u) {
    if (!u?.trainers) return 0;
    if (Array.isArray(u.trainers)) return u.trainers.length;
    return Object.keys(u.trainers).length;
  }

  // ==========================================================
  // 📋 GET /api/admin/users — summary list
  // ==========================================================
  // Returns ONE row per user with just the fields needed for the
  // table view. Full records come from /api/admin/user/:id when
  // the admin clicks into a row. This keeps the response small
  // even at many hundreds of users.
  router.get("/api/admin/users", requireAuth, (req, res) => {
    const trainerData = getTrainerData() || {};

    const users = Object.entries(trainerData).map(([userId, u]) => ({
      userId,
      name: u?.name ?? "",
      rank: u?.rank ?? getRank(toNumber(u?.tp)),
      tp: toNumber(u?.tp),
      cc: toNumber(u?.cc),
      pokemonCount: pokemonSpeciesCount(u),
      trainerCount: trainerCount(u),
      lastActive: lastActiveOf(u),
      onboardingComplete: !!u?.onboardingComplete,
    }));

    res.json({ users, total: users.length });
  });

  // ==========================================================
  // 🔍 GET /api/admin/user/:id — full record drill-down
  // ==========================================================
  router.get("/api/admin/user/:id", requireAuth, (req, res) => {
    const trainerData = getTrainerData() || {};
    const user = trainerData[req.params.id];
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ userId: req.params.id, user });
  });

  // ==========================================================
  // 📊 GET /api/admin/stats — server-wide aggregates
  // ==========================================================
  // Computed on each request. At ~200 users this is cheap enough
  // that caching would be premature. If it ever slows down, wrap
  // in a 60-second in-memory cache.
  router.get("/api/admin/stats", requireAuth, (req, res) => {
    const trainerData = getTrainerData() || {};
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    let totalUsers = 0;
    let totalCC = 0;
    let totalTP = 0;
    let totalPokemonSpecies = 0;
    let totalPokemonVariants = 0;
    let totalTrainers = 0;
    let onboarded = 0;
    let active24h = 0;
    let active7d = 0;
    const topByTp = [];

    for (const [userId, u] of Object.entries(trainerData)) {
      totalUsers++;
      totalCC += toNumber(u?.cc);
      totalTP += toNumber(u?.tp);
      totalPokemonSpecies += pokemonSpeciesCount(u);
      totalTrainers += trainerCount(u);
      if (u?.onboardingComplete) onboarded++;

      // Variants = sum of normal + shiny counts across all species.
      // Gives a truer "pokemon owned" total than species count alone.
      if (u?.pokemon) {
        for (const v of Object.values(u.pokemon)) {
          totalPokemonVariants += toNumber(v?.normal) + toNumber(v?.shiny);
        }
      }

      const last = lastActiveOf(u);
      if (last > 0) {
        if (now - last <= DAY) active24h++;
        if (now - last <= 7 * DAY) active7d++;
      }

      topByTp.push({
        userId,
        name: u?.name ?? "",
        tp: toNumber(u?.tp),
        rank: u?.rank ?? getRank(toNumber(u?.tp)),
      });
    }

    // Top 10 by TP.
    topByTp.sort((a, b) => b.tp - a.tp);
    const topTen = topByTp.slice(0, 10);

    res.json({
      totalUsers,
      onboarded,
      totalCC,
      totalTP,
      totalPokemonSpecies,
      totalPokemonVariants,
      totalTrainers,
      active24h,
      active7d,
      topByTp: topTen,
    });
  });

  // ==========================================================
  // 📜 GET /api/admin/events — event log with filters
  // ==========================================================
  // Query params:
  //   type     — event type filter (e.g. "roll", "donate")
  //   userId   — only events for this user
  //   since    — epoch ms lower bound
  //   until    — epoch ms upper bound
  //   limit    — default 100, max 1000
  //   offset   — for pagination
  router.get("/api/admin/events", requireAuth, async (req, res) => {
    const limit = Math.min(1000, Math.max(1, toNumber(req.query.limit) || 100));
    const offset = Math.max(0, toNumber(req.query.offset) || 0);

    const filters = {
      type: req.query.type || null,
      userId: req.query.userId || null,
      since: req.query.since ? toNumber(req.query.since) : null,
      until: req.query.until ? toNumber(req.query.until) : null,
      limit,
      offset,
    };

    const { total, events } = await readEvents(filters);
    res.json({ total, events, limit, offset });
  });

  app.use(router);
}
