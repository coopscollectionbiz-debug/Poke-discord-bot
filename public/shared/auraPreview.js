// ===========================================================
// public/shared/auraPreview.js — a trainer drawn over an Aura, as the bot
// draws it. Used by the Trainers page's Auras tab and the Battle page.
//   Tier Auras: the bot's pixel backdrop (spriteFx.js, data-fx="trainer").
//   Art Auras ("art:<id>"): their spritesheet from /auras-art/<id>/aura.json.
// Call loadAuraArt for every art look before rendering, then scanFx(root)
// once the HTML is in the page so tier backdrops mount.
// ===========================================================

export const TRAINER_SPRITES = "/public/sprites/trainers_2/";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const artMeta = new Map();

/** An art Aura's aura.json (cached), or null when its art isn't there. */
export async function loadAuraArt(id) {
  if (artMeta.has(id)) return artMeta.get(id);
  const meta = await fetch(`/auras-art/${encodeURIComponent(id)}/aura.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  artMeta.set(id, meta);
  return meta;
}

/** Loads the art for every "art:<id>" look in the list. */
export const loadAuraLooks = (looks) =>
  Promise.all([...new Set(looks.filter((l) => typeof l === "string" && l.startsWith("art:")))].map((l) => loadAuraArt(l.slice(4))));

// Six solid bands interpolated from the sky stops, as the bot draws it (trainerBackdrop.js drawTierSky).
function skyBands(stops, bands = 6) {
  const rgb = stops.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return Array.from({ length: bands }, (_, b) => {
    const q = (b / (bands - 1)) * (rgb.length - 1), i = Math.min(rgb.length - 2, Math.floor(q)), f = q - i;
    return `rgb(${[0, 1, 2].map((k) => Math.round(rgb[i][k] + (rgb[i + 1][k] - rgb[i][k]) * f)).join(",")})`;
  });
}

/**
 * The trainer over an Aura `look` (a tier name, "art:<id>", or null for none).
 * `alt` names the trainer for screen readers; `className` adds classes.
 */
export function auraPreview(look, trainerFile, { alt = "", className = "", art = null } = {}) {
  const cls = `aura-preview${className ? ` ${className}` : ""}`;
  const img = trainerFile ? `<img src="${TRAINER_SPRITES}${esc(trainerFile)}" alt="${esc(alt)}" loading="lazy" />` : "";
  if (!look) return `<div class="${cls}">${img}</div>`;
  if (!look.startsWith("art:")) return `<div class="${cls}" data-fx="trainer" data-fx-tier="${esc(look)}">${img}</div>`;
  const id = look.slice(4), meta = art ?? artMeta.get(id);
  if (!meta) return `<div class="${cls}">${img}</div>`;
  const frames = Number.isInteger(meta.frames) && meta.frames > 0 ? meta.frames : 24;
  const sky = Array.isArray(meta.sky) && meta.sky.length > 1 ? meta.sky : null;
  const bands = sky ? `linear-gradient(${skyBands(sky).map((c, i, all) => `${c} ${(i / all.length) * 100}% ${((i + 1) / all.length) * 100}%`).join(", ")})` : "none";
  return `<div class="${cls} aura-art" style="--sky:${bands};--frames:${frames};--sheet:url('/auras-art/${encodeURIComponent(id)}/${encodeURIComponent(meta.layers?.back ?? "back.png")}')"><span class="aura-sheet"></span>${img}</div>`;
}
