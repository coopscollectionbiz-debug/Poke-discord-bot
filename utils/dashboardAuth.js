// ==========================================================
// utils/dashboardAuth.js — dashboard/admin access tokens
// Moved verbatim from bot_final.js so commands (/dashboard,
// /admindashboard) can import them without importing the bot itself.
// One in-memory Map per process (module singleton), as before.
// ==========================================================

import crypto from "crypto";

const activeTokens = new Map();

/** Remove expired tokens; returns how many were removed (GC loop in bot_final.js). */
export function pruneExpiredTokens(now = Date.now()) {
  let removed = 0;
  for (const [token, entry] of activeTokens.entries()) {
    if (!entry || typeof entry.expires !== "number" || now > entry.expires) {
      activeTokens.delete(token);
      removed++;
    }
  }
  return removed;
}

/**
 * Generate a secure token linked to both the user and the channel.
 *
 * The `type` field lets us distinguish between regular player
 * dashboard tokens and admin dashboard tokens. Even though they
 * share the same activeTokens Map, requireAdminSession enforces
 * type === "admin" so a leaked player token can't be used to hit
 * admin endpoints.
 *
 * @param {string} userId - The Discord user ID
 * @param {string} channelId - The Discord channel ID where the command was used
 * @param {string} [type="dashboard"] - Token type: "dashboard" (default) or "admin"
 */
export function generateToken(userId, channelId, type = "dashboard", meta = {}) {
  // ✅ strong, unguessable, URL-safe
  const token = crypto.randomBytes(18).toString("base64url");
  activeTokens.set(token, {
    id: userId,
    channelId,
    type,
    name: typeof meta?.name === "string" ? meta.name.slice(0, 100) : "",
    expires: Date.now() + LINK_TTL_MS,
  });
  return token;
}

/** A link from /dashboard or /admindashboard works for 10 minutes. */
export const LINK_TTL_MS = 10 * 60 * 1000;
/** Opened sessions slide: each use moves expiry this far out… */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** …but never past this long after the link was opened. */
export const SESSION_MAX_MS = 4 * 60 * 60 * 1000;
// Admin and player sessions share the same window.
export const ADMIN_IDLE_MS = SESSION_IDLE_MS;
export const ADMIN_MAX_MS = SESSION_MAX_MS;
export const DASHBOARD_IDLE_MS = SESSION_IDLE_MS;
export const DASHBOARD_MAX_MS = SESSION_MAX_MS;

function slide(entry, now) {
  entry.expires = Math.min(now + SESSION_IDLE_MS, entry.sessionStart + SESSION_MAX_MS);
}

function activate(token, type, now) {
  const entry = activeTokens.get(token);
  if (!entry || entry.type !== type) return false;
  if (entry.sessionStart == null) entry.sessionStart = now;
  slide(entry, now);
  return true;
}

/**
 * Start an admin session from a just-validated admin link (/auth/admin).
 * From here on requireAdminSession slides the expiry.
 */
export function activateAdminSession(token, now = Date.now()) {
  return activate(token, "admin", now);
}

/**
 * Start a player dashboard session from a just-validated link
 * (/auth/dashboard). From here on requireDashboardSession slides the
 * expiry: 30 minutes after the last use, 4 hours at most.
 */
export function activateDashboardSession(token, now = Date.now()) {
  return activate(token, "dashboard", now);
}

/**
 * Validate that a token belongs to a specific user and isn't expired.
 * If expectedType is provided, also enforces that the token was
 * issued for that type (prevents a dashboard token from being used
 * on an admin endpoint).
 *
 * @param {string} userId - The Discord user ID to match
 * @param {string} token - The token to check
 * @param {string|null} [expectedType=null] - If set, entry.type must match
 */
export function validateToken(userId, token, expectedType = null) {
  const entry = activeTokens.get(token);
  if (!entry) return false;
  if (entry.id !== userId) return false;
  if (expectedType && entry.type !== expectedType) return false;
  if (Date.now() > entry.expires) {
    activeTokens.delete(token);
    return false;
  }
  return true;
}

/**
 * Retrieve the channel ID stored with a token
 */
export function getChannelIdForToken(token) {
  const entry = activeTokens.get(token);
  return entry ? entry.channelId : null;
}

/**
 * Player dashboard check: the dashboard_session cookie must belong to
 * userId. A valid opened session slides (see activateDashboardSession);
 * a link that was never opened still dies 10 minutes after /dashboard.
 */
export function requireDashboardSession(req, userId, now = Date.now()) {
  const sessionToken = req?.cookies?.dashboard_session;
  if (!sessionToken) return false;
  const entry = activeTokens.get(sessionToken);
  if (!entry) return false;
  // Player dashboard tokens are the legacy default "dashboard" type.
  if (entry.type !== "dashboard") return false;
  if (entry.id !== String(userId)) return false;
  if (now > entry.expires) {
    activeTokens.delete(sessionToken);
    return false;
  }
  if (entry.sessionStart != null) slide(entry, now);
  return true;
}

/**
 * Admin session check. Unlike requireDashboardSession this doesn't
 * require the caller to supply a userId — admin endpoints usually
 * operate on arbitrary users, so we trust the cookie itself.
 *
 * Returns the authenticated admin user's Discord ID on success, or
 * null if the session is missing/invalid/expired/wrong-type.
 */
export function requireAdminSession(req, now = Date.now()) {
  const session = adminSessionOf(req, now);
  return session ? session.id : null;
}

/**
 * The admin session behind this request ({ id, name, expires }) or null.
 * A valid session slides: expiry moves to 30 minutes from now, capped at
 * 4 hours after the link was opened (ADMIN_IDLE_MS / ADMIN_MAX_MS).
 */
export function adminSessionOf(req, now = Date.now()) {
  const sessionToken = req?.cookies?.admin_session;
  if (!sessionToken) return null;
  const entry = activeTokens.get(sessionToken);
  if (!entry) return null;
  if (entry.type !== "admin") return null;
  if (now > entry.expires) {
    activeTokens.delete(sessionToken);
    return null;
  }
  if (entry.sessionStart != null) slide(entry, now);
  return { id: entry.id, name: entry.name || "", expires: entry.expires };
}

