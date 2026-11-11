// ==========================================================
// utils/spriteBreathing.js
// The procedural idle for static Pokémon sprites: the trainer idle's
// clean-step breathing (utils/trainerIdle.js) and closed-lid blink
// (blinkEyes in utils/trainerMotion.js), re-exported here so Pokémon and
// trainers always move the same way, plus the Pokémon loop (per-sprite
// tempo, no phase offset, one blink where data/sprites/pokemon-blinks.json
// lists eyes).
//
// Every pose is made only from the sprite's own pixels. On the exhale the
// upper body drops 1 px; the drop moves in up to 3 in-between steps, the
// head first on the out-breath and the waist first on the in-breath. A
// blink closes each eye: the eye takes the lid colour, with a lash line on
// its bottom row. Frame 0 is always the untouched sprite.
// ==========================================================

import { breathLoop, opaqueBounds } from "./trainerIdle.js";
import { nameHash } from "./trainerMotion.js";

export { opaqueBounds, idleCuts, stepCount, breathPose, breathingPoses, STEP_MS, breathLoop, IDLE_LOOP } from "./trainerIdle.js";
export { blinkEyes, nameHash } from "./trainerMotion.js";

// ---- Pokémon cut lines (whole-body breath) -------------------------------
// The trainer cuts sit at human proportions (neck at 12–32 % of the height,
// waist at 42–66 %). On Pokémon with big heads (Chespin, Tinkatink,
// Pecharunt…) those rows run through the face, so the top of the head slid
// against the rest of it. Pokémon instead breathe as one piece: everything
// above a row near the feet drops 1 px together (owner-approved 2026-11-10),
// so a head is never split. The clean in-between steps stay, but only in the
// lower body (from 62 % of the height down), well below most faces.

const ALPHA_MIN = 8;
function rowDiff(px, W, a, b) {
  let n = 0;
  for (let x = 0; x < W; x++) {
    const i = (a * W + x) * 4, j = (b * W + x) * 4;
    const oa = px[i + 3] > ALPHA_MIN, ob = px[j + 3] > ALPHA_MIN;
    if (oa !== ob || (oa && (px[i] !== px[j] || px[i + 1] !== px[j + 1] || px[i + 2] !== px[j + 2]))) n++;
  }
  return n;
}
/** Where the in-between steps may sit: rows from STEP_FROM of the height down to just above the low cut. */
export const LOW_CUT = [0.74, 0.9];
export const STEP_FROM = 0.62;

/**
 * Cut lines for the whole-body breath, in the shape breathPose expects:
 * → { bounds, waist, neck, steps, seam } or null when the sprite is too small.
 * `waist` is the low cut (its dropped row matches the row above it, so the
 * change can't be seen); `steps` are up to 2 in-between rows between
 * STEP_FROM and the low cut, each no more visible than the low cut (min 4 px).
 * With no clean step row, the one step is the low cut itself (a single 1 px
 * move). `neck` is the sprite's top row (nothing is held back).
 *
 * `face` [y0, y1]: rows no cut may cross (a face low in the body: Pawmi lying
 * down, Appletun, Mega Kangaskhan's baby…). When the low-cut window falls in
 * the face, the cut goes just below it, or else above it (the body above the
 * face rises and the face stays still).
 */
export function pokemonCuts(px, W, H, { minHeight = 20, face = null } = {}) {
  const b = opaqueBounds(px, W, H);
  if (!b || b.h < minHeight) return null;
  const free = (y) => !face || y < face[0] || y > face[1];
  const best = (lo, hi) => {
    let y0 = -1, c0 = Infinity;
    for (let y = Math.max(1, Math.round(lo)); y <= Math.min(H - 2, Math.round(hi)); y++) {
      if (!free(y)) continue;
      const c = rowDiff(px, W, y, y - 1);
      if (c < c0) { c0 = c; y0 = y; }
    }
    return { y: y0, c: c0 };
  };
  let waist = best(b.y0 + b.h * LOW_CUT[0], b.y0 + b.h * LOW_CUT[1]);
  if (waist.y < 0 && face) waist = best(face[1] + 1, b.y1 - 1);
  if (waist.y < 0 && face) waist = best(b.y0 + b.h * 0.3, face[0] - 1);
  if (waist.y < 0) return null;
  const tol = Math.max(4, waist.c);
  const top = waist.y > (face?.[1] ?? -1) ? Math.max(b.y0 + b.h * STEP_FROM, face ? face[1] + 1 : 0) : b.y0 + (waist.y - b.y0) * STEP_FROM;
  const span = waist.y - 2 - top;
  const steps = [];
  if (span >= 4) {
    for (const [lo, hi] of [[top + span / 2, waist.y - 2], [top, top + span / 2 - 1]]) {
      const st = best(lo, hi);
      if (st.y > 0 && st.c <= tol && (steps.length === 0 || st.y < steps.at(-1) - 2)) steps.push(st.y);
    }
  }
  if (!steps.length) steps.push(waist.y);
  return { bounds: b, waist: waist.y, neck: b.y0, steps, seam: waist.c };
}

// ---- Pokémon loop ---------------------------------------------------------
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
