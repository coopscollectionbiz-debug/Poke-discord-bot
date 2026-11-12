// ==========================================================
// utils/spriteBreathing.js
// Shared pieces of the static Pokémon idle (the motion itself is the rig in
// utils/spriteRig.js): the trainer idle's pose machinery and closed-lid blink
// (blinkEyes) re-exported from utils/trainerIdle.js and
// utils/trainerMotion.js, and the Pokémon low cut (pokemonCuts) — the
// reviewed row near the feet that the rig's squash is built on.
//
// Every pose is made only from the sprite's own pixels. A blink closes each
// eye: the eye takes the lid colour, with a lash line on its bottom row.
// ==========================================================

import { opaqueBounds } from "./trainerIdle.js";

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
