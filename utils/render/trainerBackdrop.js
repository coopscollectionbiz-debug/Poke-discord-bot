// ==========================================================
// utils/render/trainerBackdrop.js
// The animated background behind Epic, Legendary and Mythic trainers on
// rendered cards (owner-approved tier ladder, revised 2026-11-12 from the aura
// locker: Epic A, Legendary B, Mythic C):
//   Epic       the tier's sky colour + rising motes
//   Legendary  the sky + a stepped gold glow + motes + twinkles
//   Mythic     the sky + a stepped crimson glow + motes + twinkles + meteors
//              that shed embers, and one bright hero meteor a loop (mid-flight
//              on frame 0, so still cards show it)
// The sky is a static banded gradient (drawTierSky), drawn once under the
// region; the frames here carry everything that sits on top of it.
// Rare and below get no backdrop.
//
// Pixel art on a grid aligned to the trainer sprite's own pixels: tint
// amounts are stepped and 2×2-dithered (no smooth gradients, so nothing bands
// in the GIF), and the grid is drawn scaled with smoothing off. Elements are
// placed only where the trainer's silhouette mask is clear, so nothing ever
// passes behind the trainer. Loops seamlessly over `frames`.
// ==========================================================

import { createCanvas, ImageData } from "@napi-rs/canvas";
import { loadAuraArt } from "./auraArt.js";
import { sheetFrame, BACK_FEET_FROM_BOTTOM } from "../../public/shared/auraArt.js";

// A look is a tier key ("epic" …) or an Aura's art ("art:<id>", ids are case-sensitive). See catalog/auras.js.
const lookKey = (k) => { const s = String(k ?? ""); return s.startsWith("art:") ? s : s.toLowerCase(); };
const artOf = (k) => (k.startsWith("art:") ? loadAuraArt(k.slice(4)) : null);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const C = (...h) => h.map(hex);

/** Per-tier recipe: sky stops (top → bottom), glow (inner, outer), and each effect's colours. */
const TIERS = {
  epic: { sky: C("#05030b", "#0c0618", "#160a26", "#200d33", "#2a1040"), motes: 12, mote: C("#c084fc", "#a855f7") },
  legendary: { sky: C("#060402", "#0f0904", "#1a1006", "#26170a", "#33200c"), glow: C("#f59e0b", "#b45309"), motes: 12, mote: C("#fde047", "#f59e0b"), twinkles: 8, twinkle: C("#fde68a", "#fef3c7", "#facc15") },
  mythic: { sky: C("#05020a", "#0c0412", "#170718", "#250a1d", "#340d22"), glow: C("#be123c", "#881337"), motes: 12, mote: C("#fb7185", "#e11d48", "#f9a8d4"), twinkles: 8, twinkle: C("#fecdd3", "#fda4af", "#f9a8d4"), meteors: true, meteor: C("#e11d48", "#fb7185"), head: hex("#fff1f2") },
};
/** Stepped glow: three still bands (never swells), at these radii and tint amounts. */
const GLOW_R = [0.42, 0.68, 0.95], GLOW_A = [0.12, 0.07, 0.04];
export const hasBackdrop = (tier) => { const k = lookKey(tier); return Boolean(TIERS[k] || artOf(k)); };
/** Each backdrop tier's colour (its halo), for things that match it: floors, borders, records. */
export const BACKDROP_TINT = Object.freeze({ epic: "#a855f7", legendary: "#f59e0b", mythic: "#ef4444" });
export const backdropTint = (tier) => { const k = lookKey(tier); return BACKDROP_TINT[k] ?? artOf(k)?.tint ?? null; };

const BAYER = [[0, 2], [3, 1]];
const LEVELS = [0, 0.07, 0.13, 0.2, 0.3, 0.45, 0.7, 0.85];
/** Tint amount → one of a few levels, ordered-dithered between neighbours. */
function stepped(t, x, y) {
  let i = 0;
  while (i < LEVELS.length - 1 && LEVELS[i + 1] <= t) i++;
  if (i === LEVELS.length - 1) return LEVELS[i];
  const lo = LEVELS[i], hi = LEVELS[i + 1];
  return ((t - lo) / (hi - lo)) * 4 > BAYER[y & 1][x & 1] + 0.5 ? hi : lo;
}
function rand(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * @param tier     trainer tier ("epic" | "legendary" | "mythic"; others → null)
 * @param gridW/H  grid size in sprite pixels
 * @param mask     Uint8Array(gridW*gridH), 1 where the (dilated) trainer is
 * @param halo     { cx, cy, rx, ry } halo ellipse in grid units, or
 *                 { from: [x, y], to: [x, y] }: a diagonal gradient, brightest
 *                 at `from` and gone by `to` (grid units): the background of
 *                 a whole region (a card half, a playback row)
 * @param floorRow grid row of the trainer's feet; elements stay above it
 * @param feetRow  art Auras only: grid row of the bottom edge of the trainer's
 *                 feet, where back.png's feet row goes (public/shared/auraArt.js);
 *                 omitted: the sheet's bottom sits on floorRow + 2 (older callers)
 * @param mirror   art Auras only: draw the art mirrored (the opponent's VS half)
 * @param frames   loop length in frames
 * @param spread   wide regions: 8 meteors per loop, each in its own column
 *                 (interleaved order), and 3× the motes and twinkles, spaced
 *                 evenly across the width
 * @returns { frame(f) → canvas (gridW×gridH, RGBA, transparent where empty) } or null
 */
export function createBackdrop({ tier, gridW, gridH, mask, halo, floorRow, frames, spread = false, variant = null, feetRow = null, mirror = false }) {
  const art = artOf(lookKey(tier));
  if (art) return artBackdrop(art, { gridW, gridH, halo, floorRow, frames, variant, feetRow, mirror });
  const recipe = TIERS[lookKey(tier)];
  if (!recipe) return null;
  const W = gridW, H = gridH, N = frames;
  const inner = { x0: 2, y0: 2, x1: W - 3, y1: Math.min(H - 3, floorRow - 2) };
  const isOpen = (x, y, r = 0) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < inner.x0 || Y < inner.y0 || X > inner.x1 || Y > inner.y1 || mask[Y * W + X]) return false;
    }
    return true;
  };
  const openSpot = (seed, r) => {
    for (let t = 0; t < 300; t++) {
      const x = Math.round(inner.x0 + rand(seed * 97 + t * 13 + 1) * (inner.x1 - inner.x0));
      const y = Math.round(inner.y0 + rand(seed * 61 + t * 7 + 3) * (inner.y1 - inner.y0));
      if (isOpen(x, y, r)) return [x, y];
    }
    return null;
  };

  // Fixed placements, computed once.
  const twinkles = [];
  const dense = spread ? 3 : 1;
  const nTw = (recipe.twinkles ?? 0) * dense;
  for (let i = 0; i < nTw; i++) {
    let s = openSpot(i + 11, 2);
    if (spread) { // each in its own slice of the width
      const x0 = inner.x0 + ((inner.x1 - inner.x0) * i) / nTw, w = (inner.x1 - inner.x0) / nTw;
      s = null;
      for (let t = 0; t < 200 && !s; t++) {
        const x = Math.round(x0 + rand(i * 97 + t * 13 + 1) * w), y = Math.round(inner.y0 + rand(i * 61 + t * 7 + 3) * (inner.y1 - inner.y0));
        if (isOpen(x, y, 2)) s = [x, y];
      }
    }
    if (s) twinkles.push({ x: s[0], y: s[1], phase: rand(i * 5 + 2), c: recipe.twinkle[i % recipe.twinkle.length] });
  }
  const nMotes = recipe.motes * dense;
  const motes = Array.from({ length: nMotes }, (_, i) => ({ r: rand(i * 7 + 1), x: spread ? (i + 0.2 + 0.6 * rand(i * 13 + 5)) / nMotes : rand(i * 13 + 5), c: recipe.mote[i % recipe.mote.length] }));
  const meteors = recipe.meteors ? meteorPaths() : [];
  const hero = recipe.meteors ? heroPath() : null;

  // The hero: one long, bright streak across the top a loop, mid-flight on frame 0.
  function heroPath() {
    const ang = (40 * Math.PI) / 180, dx = -Math.cos(ang), dy = Math.sin(ang), travel = 30, tail = 13;
    const cands = [];
    for (let y = Math.round(inner.y1 * 0.06); y <= Math.round(inner.y1 * 0.3); y++) for (let x = inner.x0; x <= inner.x1; x++) {
      let ok = true;
      for (let s = 0; s <= travel && ok; s++) for (let t = -1; t <= tail; t++) if (!isOpen(Math.round(x + dx * (s - t)), Math.round(y + dy * (s - t)))) { ok = false; break; }
      if (ok) cands.push([x, y]);
    }
    if (!cands.length) return null;
    const [x0, y0] = cands[Math.floor(rand(911) * cands.length)];
    return { x0, y0, travel, tail, dx, dy, start: (N - 4 + N) % N, life: 9 };
  }

  // The glow is still: work it out once.
  const glowT = new Float32Array(W * H), glowC = new Array(W * H).fill(null);
  if (recipe.glow) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let d;
    if (halo.from) {
      const [x0, y0] = halo.from, ddx = halo.to[0] - x0, ddy = halo.to[1] - y0;
      d = Math.max(0, ((x - x0) * ddx + (y - y0) * ddy) / (ddx * ddx + ddy * ddy));
    } else d = Math.hypot((x - halo.cx) / halo.rx, (y - halo.cy) / halo.ry);
    d += ((BAYER[y & 1][x & 1] + 0.5) / 4) * 0.06; // a 2×2 dither where bands meet
    const b = d < GLOW_R[0] ? 0 : d < GLOW_R[1] ? 1 : d < GLOW_R[2] ? 2 : -1;
    if (b >= 0) { glowT[y * W + x] = GLOW_A[b]; glowC[y * W + x] = recipe.glow[b === 2 ? 1 : 0]; }
  }

  // All meteors fall down-left at 40°; heights rotate through four bands,
  // with long streaks up top and short ones in the gaps beside the trainer.
  function meteorPaths() {
    const ang = (40 * Math.PI) / 180, dx = -Math.cos(ang), dy = Math.sin(ang);
    const bands = [[0.06, 0.24, 30, 13], [0.25, 0.49, 18, 9], [0.5, 0.74, 18, 9], [0.75, 0.92, 14, 8]];
    const n = spread ? 8 : Math.max(1, Math.round((N * 5) / 40)); // the approved rate: 5 per 4 s
    // spread: column k of n, interleaved (0, n/2, 1, n/2+1, ...) so back-to-back meteors are far apart.
    const half = Math.ceil(n / 2);
    const column = (k) => (k % 2 ? half + (k - 1) / 2 : k / 2);
    const colW = (inner.x1 - inner.x0) / n;
    const starts = [2, 10, 17, 25, 33, 6, 14, 21].slice(0, n).map((s) => Math.round((s * N) / 40) % N);
    const order = [0, 2, 1, 3, 0, 2, 3, 1];
    const fits = (x0, y0, travel, tail) => {
      for (let s = 0; s <= travel; s++) for (let t = -1; t <= tail; t++) {
        if (!isOpen(Math.round(x0 + dx * (s - t)), Math.round(y0 + dy * (s - t)))) return false;
      }
      return true;
    };
    const out = [];
    for (let k = 0; k < n; k++) {
      for (const bi of [order[k], ...[0, 1, 2, 3].filter((i) => i !== order[k])]) {
        const [lo, hi, travel, tail] = bands[bi];
        const cands = [];
        const xa = spread ? Math.round(inner.x0 + colW * column(k)) : inner.x0;
        const xb = spread ? Math.round(inner.x0 + colW * (column(k) + 1)) : inner.x1;
        for (let y = Math.round(inner.y1 * lo); y <= Math.round(inner.y1 * hi); y++) for (let x = xa; x <= xb; x++) {
          if (fits(x, y, travel, tail)) cands.push([x, y]);
        }
        if (!cands.length) continue;
        const [x0, y0] = cands[Math.floor(rand(k * 53 + 7) * cands.length)];
        out.push({ x0, y0, travel, tail, dx, dy, start: starts[k], life: Math.min(9, Math.max(6, Math.round(travel / 4))) });
        break;
      }
    }
    return out;
  }

  const tint = new Float32Array(W * H), col = new Array(W * H);
  const plot = (x, y, a, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H || mask[y * W + x]) return;
    const i = y * W + x;
    if (a > tint[i]) { tint[i] = a; col[i] = c; }
  };
  const sparkle = (x, y, a, arm, c) => {
    plot(x, y, a, c);
    for (let k = 1; k <= arm; k++) {
      const ak = a * (1 - k / (arm + 1));
      plot(x - k, y, ak, c); plot(x + k, y, ak, c); plot(x, y - k, ak, c); plot(x, y + k, ak, c);
    }
  };

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  return {
    frame(f) {
      tint.set(glowT);
      for (let i = 0; i < W * H; i++) col[i] = glowC[i];
      // Motes: rise from near the floor and fade, one lap per loop.
      for (const m of motes) {
        const t = (f / N + m.r) % 1;
        const y = Math.round(inner.y1 - 4 - t * (inner.y1 - inner.y0 - 6));
        const x = Math.round(inner.x0 + 4 + m.x * (inner.x1 - inner.x0 - 8) + Math.sin((t + m.r) * Math.PI * 2) * 2);
        const a = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
        plot(x, y, 0.75 * a, m.c);
      }
      // Twinkles: brighten and dim in turn, never fully off.
      for (const s of twinkles) {
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(((f / N + s.phase) % 1) * Math.PI * 2));
        sparkle(s.x, s.y, a, a > 0.6 ? 1 : 0, s.c);
      }
      // Meteors: ease in with a growing tail, glide, ease out, and leave embers that fade.
      const streak = (m, bright) => {
        const step = (((f - m.start) % N) + N) % N;
        if (step <= m.life) {
          const p = step / m.life;
          const ramp = Math.min(1, (p + 0.12) / 0.4) * Math.min(1, (1 - p + 0.08) / 0.43);
          const len = Math.max(2, Math.round(m.tail * Math.min(1, (p + 0.15) / 0.45)));
          const hx = m.x0 + m.dx * m.travel * p, hy = m.y0 + m.dy * m.travel * p;
          for (let t = 1; t <= len; t++) plot(Math.round(hx - m.dx * t), Math.round(hy - m.dy * t), ((bright ? 0.95 : 0.85) - (t / m.tail) * 0.7) * ramp, t % 3 === 1 ? recipe.meteor[1] : recipe.meteor[0]);
          sparkle(Math.round(hx), Math.round(hy), ramp, ramp > (bright ? 0.5 : 0.6) ? 1 : 0, recipe.head);
        }
        for (let q = 0.2; q < 1; q += bright ? 0.12 : 0.25) {
          const age = step - q * m.life;
          if (age > 0 && age <= 6) plot(Math.round(m.x0 + m.dx * m.travel * q), Math.round(m.y0 + m.dy * m.travel * q + age * 0.3), 0.55 * (1 - age / 6), recipe.meteor[1]);
        }
      };
      for (const m of meteors) streak(m, false);
      if (hero) streak(hero, true);
      // To RGBA: colour at the stepped tint as alpha (composited over the panel).
      const img = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!tint[i]) continue;
        const a = stepped(Math.min(1, tint[i]), x, y);
        if (!a) continue;
        const c = col[i] ?? recipe.mote[0];
        img.set([c[0], c[1], c[2], Math.round(a * 255)], i * 4);
      }
      ctx.putImageData(new ImageData(img, W, H), 0, 0);
      return canvas;
    },
    /** For tests: the meteor paths, the hero's (Mythic only) and the twinkles. */
    meteors,
    hero,
    twinkles,
  };
}

/** A tier's sky colour at t (0 top → 1 bottom), as [r, g, b]. */
function skyAt(stops, t) {
  const q = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(q)), f = q - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f));
}
export const tierSky = (tier) => { const k = lookKey(tier); return TIERS[k]?.sky ?? artOf(k)?.sky?.map(hex) ?? null; };

/**
 * The tier's sky: a static banded gradient over `rect` in u-pixel cells, six
 * solid bands with a 2×2 ordered dither where each meets the next (no smooth
 * gradient, so nothing bands in the GIF). `clip(ctx)` traces the region's
 * shape when it isn't a rectangle. Returns false below Epic.
 */
export function drawTierSky(ctx, tier, rect, { u = 4, clip = null, bands = 6 } = {}) {
  const stops = tierSky(tier);
  if (!stops) return false;
  const rows = Math.ceil(rect.h / u), cols = Math.ceil(rect.w / u);
  const band = Array.from({ length: bands }, (_, i) => `rgb(${skyAt(stops, i / (bands - 1)).join(",")})`);
  ctx.save();
  if (clip) clip(ctx);
  else { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); }
  ctx.clip();
  for (let gy = 0; gy < rows; gy++) {
    const q = (gy / Math.max(1, rows - 1)) * (bands - 1), i = Math.min(bands - 1, Math.floor(q)), z = (q - i - 0.6) / 0.4;
    const y = rect.y + gy * u;
    if (z <= 0 || i >= bands - 1) { ctx.fillStyle = band[i]; ctx.fillRect(rect.x, y, rect.w, u); continue; }
    for (let gx = 0; gx < cols; gx++) { ctx.fillStyle = band[z * 4 > BAYER[gy & 1][gx & 1] + 0.5 ? i + 1 : i]; ctx.fillRect(rect.x + gx * u, y, u, u); }
  }
  ctx.restore();
  return true;
}

/**
 * A tier backdrop filling a whole region of a card (a card half, a playback
 * row) rather than the panel behind one trainer: a flat wash in the tier
 * colour, a diagonal glow from the trainer's corner (`from`, `to` in card
 * pixels), and the denser, spread-out effects. `occupied(x, y)` is true on
 * card pixels holding content; effects stay clear of them (dilated by `dil`
 * grid cells), so nothing passes behind a trainer, a Pokémon or text.
 * `clip(ctx)` traces the region's shape (a path) when it isn't a rectangle.
 * Returns { drawWash(ctx), draw(ctx, frame) } or null below Epic.
 */
export function regionBackdrop({ tier, rect, u = 4, occupied, from, to, floor, frames, dil = 2, clip = null, variant = null, mirror = false }) {
  const t = lookKey(tier);
  if (!hasBackdrop(t)) return null;
  const gridW = Math.floor(rect.w / u), gridH = Math.floor(rect.h / u);
  const raw = new Uint8Array(gridW * gridH), mask = new Uint8Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
    outer: for (let dy = 0; dy < u; dy++) for (let dx = 0; dx < u; dx++) {
      if (occupied(rect.x + gx * u + dx, rect.y + gy * u + dy)) { raw[gy * gridW + gx] = 1; break outer; }
    }
  }
  for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
    if (!raw[gy * gridW + gx]) continue;
    for (let dy = -dil; dy <= dil; dy++) for (let dx = -dil; dx <= dil; dx++) {
      const X = gx + dx, Y = gy + dy;
      if (X >= 0 && Y >= 0 && X < gridW && Y < gridH) mask[Y * gridW + X] = 1;
    }
  }
  const g = (p) => [(p[0] - rect.x) / u, (p[1] - rect.y) / u];
  const bd = createBackdrop({
    tier: t, gridW, gridH, mask, frames, spread: true, variant, mirror,
    halo: { from: g(from), to: g(to) },
    floorRow: Math.min(gridH - 2, Math.floor((floor - rect.y) / u)),
  });
  const shape = (ctx) => {
    if (clip) clip(ctx);
    else { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); }
  };
  return {
    tint: backdropTint(t),
    /** The tier's sky over the region: static, so cards draw it once under everything. */
    drawWash(ctx) {
      drawTierSky(ctx, t, rect, { u, clip: shape });
    },
    /** One frame of the glow and effects. */
    draw(ctx, f) {
      ctx.save();
      shape(ctx);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bd.frame(((f % frames) + frames) % frames), rect.x, rect.y, gridW * u, gridH * u);
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
    },
  };
}

/**
 * An Aura's art as a backdrop (same shape as the tier backdrops): aura frame f
 * (0–23, the 2.4 s card loop) shows sheet frame sheetFrame(f, n), so every
 * sheet plays once per loop whatever its frame count. The panel art (back) is
 * centred on the trainer with the trainer's feet on its feet row (`feetRow`;
 * older callers: its bottom on floorRow + 2); a region's own variant ("row",
 * "vs") fills the region from its bottom-left. `mirror` flips the art (the
 * opponent's VS half), placement and motion together, once. Art is drawn
 * behind the trainer, so it ignores the mask.
 */
function artBackdrop(art, { gridW, gridH, halo, floorRow, frames, variant, feetRow = null, mirror = false }) {
  const own = variant && art.layers[variant];
  const layer = own || art.layers.back;
  const cx = halo?.cx ?? gridW / 2;
  let x = own ? 0 : Math.round(cx - layer.fw / 2);
  const y = own ? gridH - layer.fh
    : Number.isFinite(feetRow) ? Math.round(feetRow) - (layer.fh - BACK_FEET_FROM_BOTTOM)
      : Math.min(gridH, floorRow + 2) - layer.fh;
  if (mirror) x = gridW - layer.fw - x; // the mirror image of the same placement
  const made = new Map();
  return {
    frame(f) {
      const i = frames === 24 ? sheetFrame(f, layer.n) : Math.floor(((((f % frames) + frames) % frames) * layer.n) / frames);
      if (!made.has(i)) {
        const c = createCanvas(gridW, gridH), g = c.getContext("2d");
        if (mirror) { g.translate(gridW, 0); g.scale(-1, 1); }
        g.drawImage(layer.sheet, i * layer.fw, 0, layer.fw, layer.fh, mirror ? gridW - x - layer.fw : x, y, layer.fw, layer.fh);
        made.set(i, c);
      }
      return made.get(i);
    },
    meteors: 0,
    hero: null,
    twinkles: 0,
  };
}
