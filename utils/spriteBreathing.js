// ==========================================================
// utils/spriteBreathing.js
// The procedural idle for static Pokémon sprites: the trainer idle's
// clean-step breathing (utils/trainerIdle.js) and closed-lid blink
// (blinkEyes in utils/trainerMotion.js), copied verbatim from the trainer
// clean-steps branch (PR #69). Keep them identical; once #69 is on master
// this module can re-export those instead.
//
// Every pose is made only from the sprite's own pixels. On the exhale the
// upper body drops 1 px (one row just above the waist is dropped); the drop
// moves in up to 3 in-between steps, the head first on the out-breath and
// the waist first on the in-breath. Each step row is one whose dropped row
// equals the row above it, so the step can't be seen. A blink closes each
// eye: the eye takes the lid colour, with a lash line on its bottom row.
// No new colours, no redrawing; frame 0 is the untouched sprite.
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
 * → { bounds, waist, neck, steps, waistSeam, neckSeam, seam }
 * `steps`: up to 3 in-between rows (lowest first), one per band of the torso
 * between neck and waist, each no more visible than the sprite's own seam
 * (min 4 px) and at least 3 rows from the next.
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
  const seam = Math.max(waist.seam, neck.seam);
  // In-between step rows: same rule as the waist (dropped row ≈ the row above).
  const span = waist.y - neck.y, tol = Math.max(4, seam);
  const band = (lo, hi) => {
    let best = -1, bc = Infinity;
    for (let y = Math.round(lo); y <= Math.round(hi); y++) { const c = rowDiff(px, W, y, y - 1); if (c < bc) { bc = c; best = y; } }
    return bc <= tol ? best : -1;
  };
  const steps = [];
  for (const y of [band(neck.y + span * 0.68, waist.y - 2), band(neck.y + span * 0.36, neck.y + span * 0.64), band(neck.y + 2, neck.y + span * 0.32)]) {
    if (y > neck.y && (steps.length === 0 || y < steps.at(-1) - 2)) steps.push(y);
  }
  return { bounds: b, waist: waist.y, neck: neck.y, steps, waistSeam: waist.seam, neckSeam: neck.seam, seam };
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

/** In-between poses for these cuts (at least 1: the neck stretch when no step row is clean). */
export const stepCount = (cuts) => Math.max(1, cuts.steps.length);

/**
 * Breath pose `pose` of any sprite state, using the rest sprite's cut lines:
 *   0      rest (unchanged)
 *   1      exhale: everything above the waist down 1 px
 *   2 + k  step k: only the rows above steps[k] down 1 px (k = 0 is the
 *          lowest, i.e. the most dropped). With no clean step row, the one
 *          step is the classic head-lag (body down, neck row repeated).
 */
export function breathPose(px, W, cuts, pose) {
  if (pose === 0) return px;
  const top = Math.max(0, cuts.bounds.y0 - 1);
  if (pose === 1) return shiftDown(px, W, top, cuts.waist, true);
  const k = pose - 2;
  return cuts.steps.length ? shiftDown(px, W, top, cuts.steps[k], true) : shiftDown(px, W, cuts.neck, cuts.waist, false);
}

/**
 * The distinct breathing poses (RGBA buffers, same size as the source):
 * [rest, exhale, ...steps], or null when the sprite can't breathe.
 */
export function breathingPoses(px, W, H, opts) {
  const cuts = idleCuts(px, W, H, opts);
  if (!cuts) return null;
  return { poses: Array.from({ length: 2 + stepCount(cuts) }, (_, p) => breathPose(px, W, cuts, p)), cuts };
}

// ---- Timing ---------------------------------------------------------------
/** Each half-breath's steps sit on an eased 360 ms curve (smoothstep). */
export const STEP_MS = 360;
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
function unease(v) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < v) lo = m; else hi = m; } return (lo + hi) / 2; }

/** Pose order of one half-breath: out-breath head first (highest step), in-breath waist first. */
const outOrder = (n) => [0, ...Array.from({ length: n }, (_, j) => 2 + n - 1 - j), 1];
const inOrder = (n) => [1, ...Array.from({ length: n }, (_, j) => 2 + j), 0];

/**
 * Standalone loop as [pose, ms] for `n` steps: rest, the out-breath steps,
 * the exhale hold, the in-breath steps. Step k of n shows from
 * unease(k / (n + 1)) of the way through the 360 ms transition, so the steps
 * gather in the middle like an eased move (each ≥ 60 ms for n ≤ 3).
 */
export function breathLoop(n, { rest = 900, exhale = 700 } = {}) {
  // order[k] shows from at[k] to at[k + 1] (at[0] = 0, at[n + 1] = STEP_MS); the hold goes on the first.
  const at = [0, ...Array.from({ length: n }, (_, k) => Math.round((STEP_MS * unease((k + 1) / (n + 1))) / 10) * 10), STEP_MS];
  const seg = (order, hold) => order.slice(0, -1).map((p, k) => [p, (k === 0 ? hold : 0) + at[k + 1] - at[k]]);
  return [...seg(outOrder(n), rest), ...seg(inOrder(n), exhale)];
}

/** The base standalone loop for a sprite with one step (tests, docs). */
export const IDLE_LOOP = Object.freeze(breathLoop(1));

// ---- Blink (verbatim from utils/trainerMotion.js) ----------------------
/**
 * Blink: each eye rect (one per eye, covering its white and pupil) closes.
 * Every pixel takes the lid colour (the nearest light pixel above the eye in
 * its column, or below if there is none), and the bottom row becomes the
 * eye's own darkest colour: a closed lid with its lash line.
 */
export function blinkEyes(px, W, H, rects, { dark = 90 } = {}) {
  const out = new Uint8ClampedArray(px);
  const lum = (i) => 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
  const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > ALPHA_MIN;
  for (const [x0, y0, x1, y1] of rects) {
    let line = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      if (ok(x, y) && (line < 0 || lum(i) < lum(line))) line = i;
    }
    if (line < 0) continue;
    for (let x = x0; x <= x1; x++) {
      let lid = -1;
      for (let y = y0 - 1; y >= Math.max(0, y0 - 3) && lid < 0; y--) if (ok(x, y) && lum((y * W + x) * 4) > dark) lid = (y * W + x) * 4;
      for (let y = y1 + 1; y <= Math.min(H - 1, y1 + 3) && lid < 0; y++) if (ok(x, y) && lum((y * W + x) * 4) > dark) lid = (y * W + x) * 4;
      for (let y = y0; y <= y1; y++) {
        if (!ok(x, y)) continue;
        const src = y === y1 ? line : lid;
        if (src >= 0) out.set(px.subarray(src, src + 4), (y * W + x) * 4);
      }
    }
  }
  return out;
}

// ---- Pokémon loop ---------------------------------------------------------
/** Stable 32-bit hash of a sprite key (same hash as trainerMotion's nameHash). */
export function nameHash(key) {
  let h = 7;
  for (const c of String(key)) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Per-sprite breath tempo, 0.85×–1.2× of the base loop (the trainer rule),
 * so a team shown together never breathes in step. Unlike trainers there is
 * no phase offset: the loop always starts on the rest pose, so frame 0 stays
 * the untouched sprite.
 */
export function breathTiming(key) {
  const tempo = 0.85 + ((nameHash(key) % 1000) / 1000) * 0.35;
  return { rest: Math.round((900 * tempo) / 10) * 10, exhale: Math.round((700 * tempo) / 10) * 10 };
}

/** When the blink falls (fraction of the loop: late in the rest hold before the out-breath) and how long it holds. */
export const BLINK_MS = 120;
export const blinkAt = (key) => 0.08 + ((nameHash(key) >>> 12) % 100) / 100 * 0.2;

/**
 * The standalone loop for one sprite as [{ pose, blink, ms }]: the clean-step
 * breath at the sprite's tempo, and (when it has eyes) one 120 ms blink.
 * Starts on the rest pose with open eyes.
 */
export function pokemonLoop(key, steps, { blink = false } = {}) {
  const breath = breathLoop(steps, breathTiming(key));
  const total = breath.reduce((s, [, ms]) => s + ms, 0);
  const a = Math.round((blinkAt(key) * total) / 10) * 10, b = a + BLINK_MS;
  const out = [];
  let t = 0;
  for (const [pose, ms] of breath) {
    const cuts = blink ? [t, Math.max(t, Math.min(a, t + ms)), Math.max(t, Math.min(b, t + ms)), t + ms] : [t, t + ms];
    for (let i = 0; i < cuts.length - 1; i++) {
      const d = cuts[i + 1] - cuts[i];
      if (d <= 0) continue;
      const shut = blink && cuts[i] >= a && cuts[i] < b;
      const last = out.at(-1);
      if (last && last.pose === pose && last.blink === shut) last.ms += d;
      else out.push({ pose, blink: shut, ms: d });
    }
    t += ms;
  }
  return out;
}
