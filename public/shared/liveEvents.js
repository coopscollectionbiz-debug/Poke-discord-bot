// ==========================================================
// public/shared/liveEvents.js — Live events on player pages.
// GET /api/live-events?id= gives what's running, today's discount per shop
// category, and the "Use Live event" choice for Poké Balls.
// The server always charges the real price; pages only show it.
// ==========================================================

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

let cached = null;

/** The player's Live events view, or null if it can't load (pages work without it). */
export async function fetchLiveEvents(userId, { fresh = false } = {}) {
  if (!userId) return null;
  if (cached && !fresh) return cached;
  try {
    const res = await fetch(`/api/live-events?id=${encodeURIComponent(userId)}`, { credentials: "same-origin" });
    const data = await res.json();
    cached = res.ok && data.ok ? data : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** A list price after today's discount for a shop category. */
export const eventPrice = (data, category, price) => Math.max(0, Math.round(Number(price) * (data?.discounts?.[category] ?? 1)));

/** "<s>1,000</s> 500" when discounted, else "1,000". */
export function priceHTML(data, category, price) {
  const now = eventPrice(data, category, price);
  const was = Number(price).toLocaleString("en-US");
  return now < price ? `<s class="cc-was">${was}</s> ${now.toLocaleString("en-US")}` : was;
}

const endsText = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A banner listing what's on (empty string when nothing is). */
export function bannerHTML(data) {
  if (!data?.running?.length) return "";
  return `<div class="cc-live-banner" role="status">
    ${data.running.map((e) => `<div class="cc-live-event"><strong>🎪 ${esc(e.name)}</strong> <span class="cc-live-ends">until ${esc(endsText(e.endAt))}</span>
      <ul>${e.effects.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul></div>`).join("")}
  </div>`;
}

/** Turn "Use Live event" on or off for paid rolls. */
export async function setPaidChoice(userId, on) {
  try {
    const res = await fetch("/api/live-events/opt-in", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: userId, on }),
    });
    const data = await res.json();
    return res.ok && data.ok ? { ok: true, on: data.on } : { ok: false, error: data.error || "Couldn't save that." };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}
