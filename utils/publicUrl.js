// ==========================================================
// utils/publicUrl.js — the bot's public base URL for links and for the
// absolute image URLs Discord embeds need.
//
// Preference order:
//   1. PUBLIC_URL           — explicit (same variable /admindashboard uses)
//   2. RENDER_EXTERNAL_URL  — deprecated alias, honoured only when it is not
//                             an onrender.com address (the Render hosts are
//                             retired and return 503/404)
//   3. FLY_APP_NAME         — injected by Fly.io → https://<app>.fly.dev
//   4. the production host (the VPS behind nginx; see RUNBOOK.md)
// ==========================================================

export const DEFAULT_PUBLIC_URL = "https://bot.coopscollection.com";

export function publicBaseUrl(env = process.env) {
  const legacy = env.RENDER_EXTERNAL_URL && !/\.onrender\.com/i.test(env.RENDER_EXTERNAL_URL) ? env.RENDER_EXTERNAL_URL : "";
  const raw = env.PUBLIC_URL || legacy || (env.FLY_APP_NAME ? `https://${env.FLY_APP_NAME}.fly.dev` : "") || DEFAULT_PUBLIC_URL;
  return String(raw).replace(/\/+$/, "");
}
