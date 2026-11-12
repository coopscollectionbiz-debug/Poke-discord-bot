// ==========================================================
// public/shared/moveMeta.js — one standard way to show a move's details
// everywhere (teach dialog, TM shop, Teams moves editor, Collection detail):
//
//   Thunder Punch                       ← the move name (caller's markup)
//   [ELECTRIC] [✸ PHYSICAL] 75 power · 100%   ← moveMeta(m)
//
// Category icons are original drawings in the spirit of the games' move
// categories: a burst for Physical, rings for Special, a dot for Status.
// Styles: .cc-movemeta / .cc-cat in public/shared/components.css.
// ==========================================================

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICONS = {
  // eight-point burst
  physical: '<path d="M8 .8l1.6 3.4 3.6-1.3-1.3 3.6L15.2 8l-3.3 1.5 1.3 3.6-3.6-1.3L8 15.2l-1.6-3.4-3.6 1.3 1.3-3.6L.8 8l3.3-1.5-1.3-3.6 3.6 1.3z"/><circle cx="8" cy="8" r="2.4" fill="var(--cc-cat-core, #0000)"/>',
  // two rings and a core
  special: '<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.4"/>',
  // half-filled disc
  status: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z"/>',
};

/** Type chip, coloured by public/shared/tokens.css (keys are lowercase). */
export function typeChip(type) {
  if (!type) return "";
  return `<span class="cc-type" data-type="${esc(String(type).toLowerCase())}">${esc(type)}</span>`;
}

/** Physical / Special / Status badge with its icon. */
export function categoryBadge(category) {
  const key = String(category ?? "").toLowerCase();
  if (!ICONS[key]) return "";
  const label = key[0].toUpperCase() + key.slice(1);
  return `<span class="cc-cat" data-cat="${key}" title="${label} move"><svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${ICONS[key]}</svg>${label}</span>`;
}

/**
 * The standard bottom line for a move: type, category, power, accuracy, then
 * any extras (e.g. "Lv 32", "TM", "You have 2"). Missing values are skipped.
 * m: { type, category, power, accuracy? }  extra: array of plain strings.
 */
export function moveMeta(m, { extra = [] } = {}) {
  const bits = [];
  if (m?.power) bits.push(`${esc(m.power)} power`);
  if (m?.accuracy === true) bits.push("never misses");
  else if (Number.isFinite(m?.accuracy)) bits.push(`${esc(m.accuracy)}%`);
  for (const x of extra) if (x) bits.push(esc(x));
  return `<span class="cc-movemeta">${typeChip(m?.type)}${categoryBadge(m?.category)}${bits.length ? `<span class="cc-movemeta-nums">${bits.join(" · ")}</span>` : ""}</span>`;
}
