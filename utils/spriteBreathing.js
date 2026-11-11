// ==========================================================
// utils/spriteBreathing.js
// The procedural "breathing" idle (owner design, 2026-11-10; the same
// algorithm as the trainer idle in utils/trainerIdle.js on the trainer
// branch — keep them identical, or have that module re-export this one).
//
// Every pose is made only from the sprite's own pixels: the upper body drops
// 1 px on the exhale (one row just above the "waist" is dropped), and the
// head follows a beat later (the "neck" row is repeated for that beat). No
// new colours, no redrawing; frame 0 is the untouched sprite.
//
// Cut lines are chosen where the change is invisible: the waist row whose
// dropped row equals the row above it, and the neck row whose repeated row
// equals the row below it. The leftover difference ("seam", in pixels) is
// what the review gate in the generators checks.
// ==========================================================

const ALPHA_MIN = 8;

/** Opaque bounds of an RGBA buffer, or null when it is fully transparent. */
export function opaqueBounds(px, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px[(y * W + x) * 4 + 3] > ALPHA_MIN) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Pixels that differ between rows a and b (colour or opacity). */
function rowDiff(px, W, a, b) {
  let n = 0;
  for (let x = 0; x < W; x++) {
    const i = (a * W + x) * 4, j = (b * W + x) * 4;
    const oa = px[i + 3] > ALPHA_MIN, ob = px[j + 3] > ALPHA_MIN;
    if (oa !== ob || (oa && (px[i] !== px[j] || px[i + 1] !== px[j + 1] || px[i + 2] !== px[j + 2]))) n++;
  }
  return n;
}

function rowWidth(px, W, y) {
  let n = 0;
  for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > ALPHA_MIN) n++;
  return n;
}

/**
 * Cut lines for the breathing idle, or null when the sprite has none
 * (fully transparent, or too short to breathe).
 * → { bounds, waist, neck, waistSeam, neckSeam, seam }
 */
export function idleCuts(px, W, H, { minHeight = 30 } = {}) {
  const b = opaqueBounds(px, W, H);
  if (!b || b.h < minHeight) return null;
  const pick = (lo, hi, cost) => {
    let best = -1, bc = Infinity;
    for (let y = Math.max(1, Math.round(b.y0 + b.h * lo)); y <= Math.min(H - 2, Math.round(b.y0 + b.h * hi)); y++) {
      const w = rowWidth(px, W, y);
      if (!w) continue;
      const c = cost(y) + w / (W * 4); // ties go to the narrower row
      if (c < bc) { bc = c; best = y; }
    }
    return { y: best, seam: best < 0 ? Infinity : Math.floor(bc) };
  };
  const waist = pick(0.42, 0.66, (y) => rowDiff(px, W, y, y - 1));
  const neck = pick(0.12, 0.32, (y) => rowDiff(px, W, y, y + 1));
  if (waist.y < 0 || neck.y < 0 || neck.y >= waist.y) return null;
  return { bounds: b, waist: waist.y, neck: neck.y, waistSeam: waist.seam, neckSeam: neck.seam, seam: Math.max(waist.seam, neck.seam) };
}

/**
 * Rows [top, split] move down by 1 px: out[y] = src[y-1], so row `split` is
 * dropped. With clearTop the vacated top row becomes transparent; without it
 * the top row stays, i.e. appears twice (the neck stretch).
 */
function shiftDown(src, W, top, split, clearTop) {
  const out = new Uint8ClampedArray(src);
  for (let y = split; y > top; y--) out.copyWithin(y * W * 4, (y - 1) * W * 4, y * W * 4);
  if (clearTop) out.fill(0, top * W * 4, (top + 1) * W * 4);
  return out;
}

/** Pose names, in the order breathingPoses returns them. */
export const POSES = Object.freeze(["rest", "headLag", "exhale"]);

/**
 * The three distinct poses of the breathing idle (RGBA buffers, same size as
 * the source), or null when the sprite can't breathe (see idleCuts).
 *   rest    — the original sprite, unchanged
 *   headLag — body down 1 px, head still up (neck row repeated)
 *   exhale  — upper body (head included) down 1 px
 */
export function breathingPoses(px, W, H, opts) {
  const cuts = idleCuts(px, W, H, opts);
  if (!cuts) return null;
  const top = Math.max(0, cuts.bounds.y0 - 1);
  const rest = new Uint8ClampedArray(px);
  const exhale = shiftDown(px, W, top, cuts.waist, true);
  const headLag = shiftDown(px, W, cuts.neck, cuts.waist, false);
  return { poses: [rest, headLag, exhale], cuts };
}

/**
 * The loop as [poseIndex, ms] steps: rest, head-lag, exhale, head-lag.
 * ~1.8 s per breath (the same timing as the trainer idle GIFs).
 */
export const IDLE_LOOP = Object.freeze([[0, 900], [1, 110], [2, 700], [1, 110]]);
