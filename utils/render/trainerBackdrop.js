// ==========================================================
// utils/render/trainerBackdrop.js
// The animated background behind Epic, Legendary and Mythic trainers on
// rendered cards (owner-approved "tier ladder", 2026-11-10):
//   Epic       purple halo + sparse motes
//   Legendary  amber halo + gold motes + twinkles
//   Mythic     red/pink halo, motes and twinkles + a one-way meteor shower
// Rare and below get no backdrop.
//
// Pixel art on a grid aligned to the trainer sprite's own pixels: tint
// amounts are stepped and 2×2-dithered (no smooth gradients, so nothing bands
// in the GIF), and the grid is drawn scaled with smoothing off. Elements are
// placed only where the trainer's silhouette mask is clear, so nothing ever
// passes behind the trainer. Loops seamlessly over `frames`.
// ==========================================================

import { createCanvas, ImageData } from "@napi-rs/canvas";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PURPLE = hex("#a855f7"), AMBER = hex("#f59e0b"), GOLD = hex("#facc15"), RED = hex("#ef4444"), PINK = hex("#f472b6");

/** Per-tier recipe. Halo strength k; Mythic red is scaled 0.96 by luminance. */
const TIERS = {
  epic: { halo: PURPLE, haloK: 1, accent: PURPLE, motes: 8 },
  legendary: { halo: AMBER, haloK: 0.55 / 0.6, accent: GOLD, motes: 8, twinkles: 8 },
  mythic: { halo: RED, haloK: (0.7 * 0.96) / 0.6, accent: RED, alt: PINK, motes: 12, twinkles: 8, meteors: true },
};
export const hasBackdrop = (tier) => Boolean(TIERS[String(tier ?? "").toLowerCase()]);
/** Each backdrop tier's colour (its halo), for things that match it: floors, borders, records. */
export const BACKDROP_TINT = Object.freeze({ epic: "#a855f7", legendary: "#f59e0b", mythic: "#ef4444" });
export const backdropTint = (tier) => BACKDROP_TINT[String(tier ?? "").toLowerCase()] ?? null;

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
 * @param frames   loop length in frames
 * @param spread   wide regions: 8 meteors per loop, each in its own column
 *                 (interleaved order), and 3× the motes and twinkles, spaced
 *                 evenly across the width
 * @returns { frame(f) → canvas (gridW×gridH, RGBA, transparent where empty) } or null
 */
export function createBackdrop({ tier, gridW, gridH, mask, halo, floorRow, frames, spread = false }) {
  const recipe = TIERS[String(tier ?? "").toLowerCase()];
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
    if (s) twinkles.push({ x: s[0], y: s[1], phase: rand(i * 5 + 2), alt: recipe.alt && i % 2 === 1 });
  }
  const nMotes = recipe.motes * dense;
  const motes = Array.from({ length: nMotes }, (_, i) => ({ r: rand(i * 7 + 1), x: spread ? (i + 0.2 + 0.6 * rand(i * 13 + 5)) / nMotes : rand(i * 13 + 5), alt: recipe.alt && i % 3 === 0 }));
  const meteors = recipe.meteors ? meteorPaths() : [];

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
      tint.fill(0);
      col.fill(null);
      // Halo: a soft, still glow in the tier's halo colour.
      const k = 0.6 * recipe.haloK;
      if (halo.from) {
        const [x0, y0] = halo.from, ddx = halo.to[0] - x0, ddy = halo.to[1] - y0, len2 = ddx * ddx + ddy * ddy;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const t = ((x - x0) * ddx + (y - y0) * ddy) / len2;
          if (t < 1) { const i = y * W + x; tint[i] = 0.3 * (1 - Math.max(0, t)) * k; col[i] = recipe.halo; }
        }
      } else for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - halo.cx) / halo.rx, (y - halo.cy) / halo.ry);
        if (d < 1) { const i = y * W + x; tint[i] = 0.24 * (1 - d) * k; col[i] = recipe.halo; }
      }
      // Motes: rise from near the floor and fade, one lap per loop.
      for (const m of motes) {
        const t = (f / N + m.r) % 1;
        const y = Math.round(inner.y1 - 4 - t * (inner.y1 - inner.y0 - 6));
        const x = Math.round(inner.x0 + 4 + m.x * (inner.x1 - inner.x0 - 8) + Math.sin((t + m.r) * Math.PI * 2) * 2);
        const a = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
        plot(x, y, 0.75 * a, m.alt ? PINK : recipe.accent);
      }
      // Twinkles: brighten and dim in turn, never fully off.
      for (const s of twinkles) {
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(((f / N + s.phase) % 1) * Math.PI * 2));
        sparkle(s.x, s.y, a, a > 0.6 ? 1 : 0, s.alt ? PINK : recipe.accent);
      }
      // Meteors: ease in with a growing tail, glide, ease out.
      for (const m of meteors) {
        const step = (((f - m.start) % N) + N) % N;
        if (step > m.life) continue;
        const p = step / m.life;
        const ramp = Math.min(1, (p + 0.12) / 0.4) * Math.min(1, (1 - p + 0.08) / 0.43);
        const len = Math.max(2, Math.round(m.tail * Math.min(1, (p + 0.15) / 0.45)));
        const hx = m.x0 + m.dx * m.travel * p, hy = m.y0 + m.dy * m.travel * p;
        for (let t = 1; t <= len; t++) plot(Math.round(hx - m.dx * t), Math.round(hy - m.dy * t), (0.85 - (t / m.tail) * 0.7) * ramp, t % 3 === 1 ? PINK : RED);
        sparkle(Math.round(hx), Math.round(hy), ramp, ramp > 0.6 ? 1 : 0, [255, 245, 245]);
      }
      // To RGBA: colour at the stepped tint as alpha (composited over the panel).
      const img = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!tint[i]) continue;
        const a = stepped(Math.min(1, tint[i]), x, y);
        if (!a) continue;
        const c = col[i] ?? recipe.accent;
        img.set([c[0], c[1], c[2], Math.round(a * 255)], i * 4);
      }
      ctx.putImageData(new ImageData(img, W, H), 0, 0);
      return canvas;
    },
    /** For tests: the meteor paths (Mythic only). */
    meteors,
    twinkles,
  };
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
export function regionBackdrop({ tier, rect, u = 4, occupied, from, to, floor, frames, dil = 2, clip = null }) {
  const t = String(tier ?? "").toLowerCase();
  if (!TIERS[t]) return null;
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
    tier: t, gridW, gridH, mask, frames, spread: true,
    halo: { from: g(from), to: g(to) },
    floorRow: Math.min(gridH - 2, Math.floor((floor - rect.y) / u)),
  });
  const shape = (ctx) => {
    if (clip) clip(ctx);
    else { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); }
  };
  return {
    tint: BACKDROP_TINT[t],
    /** The flat tier wash: static, so cards draw it once under everything. */
    drawWash(ctx) {
      ctx.save();
      shape(ctx);
      ctx.clip();
      ctx.fillStyle = `${BACKDROP_TINT[t]}12`;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
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
