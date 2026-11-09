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
export function generateToken(userId, channelId, type = "dashboard") {
  // ✅ strong, unguessable, URL-safe
  const token = crypto.randomBytes(18).toString("base64url");
  activeTokens.set(token, {
    id: userId,
    channelId,
    type,
    expires: Date.now() + 10 * 60 * 1000,
  });
  return token;
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

export function requireDashboardSession(req, userId) {
  const sessionToken = req.cookies?.dashboard_session;
  if (!sessionToken) return false;
  // Player dashboard tokens are the legacy default "dashboard" type.
  return validateToken(String(userId), sessionToken, "dashboard");
}

/**
 * Admin session check. Unlike requireDashboardSession this doesn't
 * require the caller to supply a userId — admin endpoints usually
 * operate on arbitrary users, so we trust the cookie itself.
 *
 * Returns the authenticated admin user's Discord ID on success, or
 * null if the session is missing/invalid/expired/wrong-type.
 */
export function requireAdminSession(req) {
  const sessionToken = req.cookies?.admin_session;
  if (!sessionToken) return null;
  const entry = activeTokens.get(sessionToken);
  if (!entry) return null;
  if (entry.type !== "admin") return null;
  if (Date.now() > entry.expires) {
    activeTokens.delete(sessionToken);
    return null;
  }
  return entry.id;
}

