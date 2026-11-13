// ===========================================================
// public/shared/auraPreview.js — a trainer drawn over an Aura, as the bot
// draws it. Used by the Trainers page's Auras tab and the Battle page.
//   Tier Auras: the bot's pixel backdrop (spriteFx.js, data-fx="trainer").
//   Art Auras ("art:<id>"): their spritesheet (/auras-art/<id>/aura.json) on a
//   canvas with the bot's own timing, placement and trainer lighting
//   (/public/shared/auraArt.js).
// Call loadAuraArt (or loadAuraLooks) before rendering, then, once the HTML is
// in the page, scanFx(root) for tier backdrops and startAuraPreviews(root) for art.
// ===========================================================

import { auraFrameAt, sheetFrame, normalizeLight, lightPose, lightStrengthAt, BACK_FEET_FROM_BOTTOM } from "/public/shared/auraArt.js";

export const TRAINER_SPRITES = "/public/sprites/trainers_2/";
const SPRITES = TRAINER_SPRITES;
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

// ---------- previews ----------
// The trainer over the Aura: a tier backdrop (the bot's own pixel recipe) or
// an art Aura's spritesheet. Art plays on a 90×105 canvas exactly as the bot's
// cards do: once per 2.4 s loop whatever the sheet's frame count, the trainer's
// feet on the sheet's feet row, lit when the Aura has "light".
export function auraPreview(look, trainerFile, { alt = "", className = "", art = null } = {}) {
  const cls = `aura-preview${className ? ` ${className}` : ""}`;
  const img = trainerFile ? `<img src="${SPRITES}${esc(trainerFile)}" alt="${esc(alt)}" loading="lazy" />` : "";
  if (!look) return `<div class="${cls}">${img}</div>`;
  if (!look.startsWith("art:")) return `<div class="${cls}" data-fx="trainer" data-fx-tier="${esc(look)}">${img}</div>`;
  const id = look.slice(4), meta = art ?? artMeta.get(id);
  if (!meta) return `<div class="${cls}">${img}</div>`;
  const sky = Array.isArray(meta.sky) && meta.sky.length > 1 ? meta.sky : null;
  const bands = sky ? `linear-gradient(${skyBands(sky).map((c, i, all) => `${c} ${(i / all.length) * 100}% ${((i + 1) / all.length) * 100}%`).join(", ")})` : "none";
  return `<div class="${cls} aura-art" style="--sky:${bands}" data-art="${esc(id)}" data-trainer="${esc(trainerFile ?? "")}"${alt ? ` role="img" aria-label="${esc(alt)}"` : ""}><canvas class="aura-canvas" width="90" height="105" aria-hidden="true"></canvas></div>`;
}

// ---------- art previews: one clock for every canvas on the page ----------
const images = new Map();
const loadImage = (src) => {
  if (!images.has(src)) images.set(src, new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; }));
  return images.get(src);
};
const trainers = new Map(); // file -> { canvas, rgba, w, h, soles }
async function trainerPixels(file) {
  if (!file) return null;
  if (!trainers.has(file)) trainers.set(file, loadImage(SPRITES + file).then((img) => {
    if (!img) return null;
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const rgba = x.getImageData(0, 0, c.width, c.height).data;
    let soles = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 8) soles = Math.floor(i / 4 / c.width) + 1;
    return { canvas: c, rgba, w: c.width, h: c.height, soles };
  }));
  return trainers.get(file);
}
let players = [], ticking = false;
/** Starts every art Aura canvas under root on the shared 2.4 s clock. */
export async function startAuraPreviews(root) {
  const found = [];
  for (const el of root.querySelectorAll("[data-art]")) {
    const meta = artMeta.get(el.dataset.art), cv = el.querySelector("canvas");
    if (!meta || !cv) continue;
    const n = Number.isInteger(meta.frames) && meta.frames > 0 ? meta.frames : 24;
    let light = null;
    try { light = normalizeLight(meta.light); } catch { light = null; } // the bot draws it unlit too
    const [sheet, trainer] = await Promise.all([loadImage(`/auras-art/${encodeURIComponent(el.dataset.art)}/${encodeURIComponent(meta.layers?.back ?? "back.png")}`), trainerPixels(el.dataset.trainer)]);
    if (!sheet) continue;
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    found.push({ cv, ctx, sheet, n, trainer, light, lit: new Map(), last: -1 });
  }
  players = players.filter((p) => p.cv.isConnected).concat(found);
  if (!ticking && players.length) { ticking = true; requestAnimationFrame(tick); }
}
function litTrainer(p, f) {
  const t = p.trainer, k = p.light ? lightStrengthAt(p.light, f) : 0;
  if (!t || !(k > 0)) return t?.canvas ?? null;
  if (!p.lit.has(k)) {
    const c = document.createElement("canvas"); c.width = t.w; c.height = t.h;
    c.getContext("2d").putImageData(new ImageData(lightPose(t.rgba, t.w, t.h, p.light, k), t.w, t.h), 0, 0);
    p.lit.set(k, c);
  }
  return p.lit.get(k);
}
function drawArt(p, f) {
  const { ctx, cv, sheet, n } = p, fw = Math.floor(sheet.naturalWidth / n), fh = sheet.naturalHeight;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(sheet, sheetFrame(f, n) * fw, 0, fw, fh, Math.round((cv.width - fw) / 2), cv.height - fh, fw, fh);
  const t = p.trainer, img = litTrainer(p, f);
  if (t && img) ctx.drawImage(img, Math.round(cv.width / 2 - t.w / 2), cv.height - BACK_FEET_FROM_BOTTOM - t.soles);
}
function tick() {
  players = players.filter((p) => p.cv.isConnected);
  if (!players.length) { ticking = false; return; }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const f = still ? 0 : auraFrameAt(performance.now());
  for (const p of players) if (p.last !== f) { drawArt(p, f); p.last = f; }
  requestAnimationFrame(tick);
}

// Six solid bands interpolated from the sky stops, as the bot draws it (trainerBackdrop.js drawTierSky).
function skyBands(stops, bands = 6) {
  const rgb = stops.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return Array.from({ length: bands }, (_, b) => {
    const q = (b / (bands - 1)) * (rgb.length - 1), i = Math.min(rgb.length - 2, Math.floor(q)), f = q - i;
    return `rgb(${[0, 1, 2].map((k) => Math.round(rgb[i][k] + (rgb[i + 1][k] - rgb[i][k]) * f)).join(",")})`;
  });
}
