// ==========================================================
// utils/render/shinyBackdrop.js
// The backdrop behind every SHINY Pokémon on rendered cards: the Legendary
// tier's rising gold motes and twinkling stars from the approved trainer
// tier ladder (owner, 2026-11-10; reference: STYLES.ladderFinal in the
// trainer audit's _tools/proto-bg.mjs). The Legendary amber halo is not
// part of it — only the motes and the starry sky.
//
// Drawn as pixel art like the sprites: at half resolution (2×2 px cells),
// tint amounts stepped to a few levels with a 2×2 ordered dither, blended
// over whatever the card already drew. Nothing ever passes behind the
// Pokémon: stars sit only in open cells and motes rise only in open columns,
// outside a silhouette made from EVERY frame of the sprite (dilated 3 cells).
// The loop is seamless over the card's frame count.
//
// SHINY_FX=0 turns the backdrop off everywhere.
// ==========================================================

import { spriteScale } from "./sprites.js";

export const SHINY_GOLD = [250, 204, 21]; // #facc15, the Legendary tier colour
const CELL = 2; // backdrop pixel = 2×2 card px (the sprites' own pixel size at 2×)
const DILATE = 3; // cells of clear space kept around the Pokémon
const MARGIN = 2; // cells kept clear inside the box edge
const LEVELS = [0, 0.07, 0.13, 0.2, 0.3, 0.45, 0.7];
const BAYER = [[0, 2], [3, 1]];
const REF_AREA = 120 * 104; // the prototype's open area (cells) for 8 motes + 8 stars

export const shinyFxEnabled = (env = process.env) => env.SHINY_FX !== "0";

/** Deterministic 0..1 noise (the prototype's). */
const rand = (seed) => { const s = Math.sin(seed * 12.9898) * 43758.5453; return s - Math.floor(s); };

/** A tint amount quantised to LEVELS with ordered dither between levels. */
function stepped(t, x, y) {
  let i = 0;
  while (i < LEVELS.length - 1 && LEVELS[i + 1] <= t) i++;
  if (i === LEVELS.length - 1) return LEVELS[i];
  const lo = LEVELS[i], hi = LEVELS[i + 1];
  return ((t - lo) / (hi - lo)) * 4 > BAYER[y & 1][x & 1] + 0.5 ? hi : lo;
}

/** Union alpha of every frame of an animated sprite (from loadAnimatedSprite), cached per GIF. */
const unionCache = new WeakMap();
function unionAlpha(anim) {
  if (unionCache.has(anim.gif)) return unionCache.get(anim.gif);
  const { gif, width, height } = anim;
  const px = new Uint8ClampedArray(width * height * 4);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < gif.numFrames(); i++) {
    gif.decodeAndBlitFrameRGBA(i, px); // compositing order does not matter for a union
    for (let p = 0; p < alpha.length; p++) if (px[p * 4 + 3] > 8) alpha[p] = 1;
  }
  const out = { alpha, W: width, H: height };
  unionCache.set(anim.gif, out);
  return out;
}

function staticAlpha(sprite) {
  const ctx = sprite.image.getContext?.("2d");
  if (!ctx) return null;
  const d = ctx.getImageData(0, 0, sprite.width, sprite.height).data;
  const alpha = new Uint8Array(sprite.width * sprite.height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = d[p * 4 + 3] > 8 ? 1 : 0;
  return { alpha, W: sprite.width, H: sprite.height };
}

/**
 * The backdrop for one shiny sprite placed like drawSprite(ctx, sprite, cx,
 * floorY, boxW, boxH, { scale }) — the same placement maths — inside that box.
 * `anim` (optional): the sprite's loadAnimatedSprite() result, so the
 * clear-space mask covers every frame. `seed`: keeps the layout stable per
 * Pokémon. → { draw(ctx, frame, totalFrames) } or null.
 */
export function shinyBackdrop({ sprite, anim = null, cx, floorY, boxW, boxH, scale = 2, seed = 1 }) {
  if (!sprite || sprite.placeholder || boxW < 24 || boxH < 24) return null;
  const s = spriteScale(sprite.width, sprite.height, boxW, boxH, scale);
  const w = Math.round(sprite.width * s), h = Math.round(sprite.height * s);
  const sx = Math.round(cx - w / 2), sy = Math.round(floorY - h);
  const box = { x: Math.round(cx - boxW / 2), y: Math.round(floorY - boxH) };
  const LW = Math.floor(boxW / CELL), LH = Math.floor(boxH / CELL);

  // Silhouette in card pixels → blocked cells.
  const animated = anim && anim.gif?.numFrames?.() > 1 && sprite.box;
  const sil = animated ? unionAlpha(anim) : staticAlpha(sprite);
  if (!sil) return null;
  const k = w / sprite.width;
  const ox = animated ? sx - sprite.box.x * k : sx, oy = animated ? sy - sprite.box.y * k : sy;
  const solid = new Uint8Array(LW * LH);
  for (let gy = 0; gy < sil.H; gy++) for (let gx = 0; gx < sil.W; gx++) {
    if (!sil.alpha[gy * sil.W + gx]) continue;
    const cx0 = Math.floor((ox + gx * k - box.x) / CELL), cy0 = Math.floor((oy + gy * k - box.y) / CELL);
    const cx1 = Math.floor((ox + (gx + 1) * k - 1 - box.x) / CELL), cy1 = Math.floor((oy + (gy + 1) * k - 1 - box.y) / CELL);
    for (let y = Math.max(0, cy0); y <= Math.min(LH - 1, cy1); y++) for (let x = Math.max(0, cx0); x <= Math.min(LW - 1, cx1); x++) solid[y * LW + x] = 1;
  }
  const open = (x, y, r = 0) => {
    for (let dy = -r - DILATE; dy <= r + DILATE; dy++) for (let dx = -r - DILATE; dx <= r + DILATE; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= LW || Y >= LH) continue;
      if (solid[Y * LW + X]) return false;
    }
    return x >= MARGIN && y >= MARGIN && x < LW - MARGIN && y < LH - MARGIN;
  };

  const count = Math.max(3, Math.min(8, Math.round((8 * LW * LH) / REF_AREA)));
  // Stars: deterministic open cells (radius 1 for the sparkle arms).
  const stars = [];
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 200; t++) {
      const x = Math.round(MARGIN + rand(seed * 97 + i * 131 + t * 13 + 1) * (LW - 2 * MARGIN - 1));
      const y = Math.round(MARGIN + rand(seed * 61 + i * 71 + t * 7 + 3) * (LH - 2 * MARGIN - 1));
      if (open(x, y, 1) && !stars.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 6)) { stars.push({ x, y, ph: rand(i * 5 + 2 + seed) }); break; }
    }
  }
  // Motes: columns open (with wobble room) over the whole rise.
  const yLow = LH - 1 - MARGIN, yHigh = MARGIN, wob = 2;
  const columnOpen = (x) => { for (let y = yHigh; y <= yLow; y++) for (let d = -wob; d <= wob; d++) if (!open(x + d, y)) return false; return true; };
  const cols = [];
  for (let x = MARGIN + wob; x < LW - MARGIN - wob; x++) if (columnOpen(x)) cols.push(x);
  const motes = [];
  if (cols.length) for (let i = 0; i < count; i++) {
    const x = cols[Math.floor(rand(seed * 13 + i * 29 + 5) * cols.length)];
    motes.push({ x, r: rand(i * 7 + 1 + seed), laps: 1 + (i % 2) }); // 1 or 2 rises per loop: seamless
  }
  if (!stars.length && !motes.length) return null;

  return {
    stars: stars.length,
    motes: motes.length,
    draw(ctx, frame = 0, total = 24) {
      const tint = new Map(); // cell → strongest tint this frame
      const plot = (x, y, a) => {
        if (x < 0 || y < 0 || x >= LW || y >= LH || solid[y * LW + x]) return;
        const key = y * LW + x;
        if (a > (tint.get(key) ?? 0)) tint.set(key, a);
      };
      for (const m of motes) {
        const t = ((frame / total) * m.laps + m.r) % 1;
        const y = Math.round(yLow - t * (yLow - yHigh));
        const x = Math.round(m.x + Math.sin((t + m.r) * Math.PI * 2) * wob);
        const a = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1; // fade in / out
        plot(x, y, 0.75 * a);
      }
      for (const st of stars) {
        const ph = (frame / total + st.ph) % 1;
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(ph * Math.PI * 2)); // never fully off
        plot(st.x, st.y, a);
        if (a > 0.6) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) plot(st.x + dx, st.y + dy, a * 0.5);
      }
      const [r, g, b] = SHINY_GOLD;
      for (const [key, t] of tint) {
        const x = key % LW, y = (key - x) / LW;
        const a = stepped(Math.min(1, t), x, y);
        if (a <= 0) continue;
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.fillRect(box.x + x * CELL, box.y + y * CELL, CELL, CELL);
      }
    },
  };
}
