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
 * @param halo     { cx, cy, rx, ry } halo ellipse in grid units
 * @param floorRow grid row of the trainer's feet; elements stay above it
 * @param frames   loop length in frames
 * @returns { frame(f) → canvas (gridW×gridH, RGBA, transparent where empty) } or null
 */
export function createBackdrop({ tier, gridW, gridH, mask, halo, floorRow, frames }) {
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
  for (let i = 0; i < (recipe.twinkles ?? 0); i++) {
    const s = openSpot(i + 11, 2);
    if (s) twinkles.push({ x: s[0], y: s[1], phase: rand(i * 5 + 2), alt: recipe.alt && i % 2 === 1 });
  }
  const motes = Array.from({ length: recipe.motes }, (_, i) => ({ r: rand(i * 7 + 1), x: rand(i * 13 + 5), alt: recipe.alt && i % 3 === 0 }));
  const meteors = recipe.meteors ? meteorPaths() : [];

  // All meteors fall down-left at 40°; heights rotate through four bands,
  // with long streaks up top and short ones in the gaps beside the trainer.
  function meteorPaths() {
    const ang = (40 * Math.PI) / 180, dx = -Math.cos(ang), dy = Math.sin(ang);
    const bands = [[0.06, 0.24, 30, 13], [0.25, 0.49, 18, 9], [0.5, 0.74, 18, 9], [0.75, 0.92, 14, 8]];
    const n = Math.max(1, Math.round((N * 5) / 40)); // the approved rate: 5 per 4 s
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
        for (let y = Math.round(inner.y1 * lo); y <= Math.round(inner.y1 * hi); y++) for (let x = inner.x0; x <= inner.x1; x++) {
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
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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
