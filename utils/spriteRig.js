// ==========================================================
// utils/spriteRig.js
// The "rig" idle for static Pokémon sprites (owner-approved 2026-11-10),
// modelled on the hand-animated Gen 5 sprites. Pikachu, for example, runs
// ~1 s bounce cycles at 100 ms frames: the body squats a few px, the head
// leans, and the ears follow a beat later, with a quiet stretch for the blink.
// Hand animation redraws the whole body each frame. This rig can only slide
// bands of the sprite's own pixels, so it never invents a colour:
//   • squash: up to 3 clean body rows drop out, so everything above sinks
//     1–3 px (feet planted, faces never cut — see pokemonCuts);
//   • head lean: everything above a "head" row (below the face) shifts 1 px
//     sideways, at the row where the break is least visible;
//   • follow-through: a higher band (ears, crest, hair; above the face) lags
//     the lean by a frame or two, and sometimes overshoots;
//   • blink: the trainer closed-lid blink, during a rest.
//
// Every Pokémon gets its own performance from a seed (its sprite key):
// frame tempo, number of cycles, which moves each cycle does (bounce, dip,
// sway), how deep, which way it leans, how far the ears lag, how long it
// rests and whether it double-blinks. So no two Pokémon move alike, but each
// one always moves the same way. Frame 0 is always the untouched sprite.
// ==========================================================

import { opaqueBounds, pokemonCuts } from "./spriteBreathing.js";
import { nameHash, movePart, rectMask } from "./trainerMotion.js";

const ALPHA_MIN = 8;
function same(px, W, x1, y1, x2, y2) {
  const in1 = x1 >= 0 && x1 < W, in2 = x2 >= 0 && x2 < W;
  const a = in1 && px[(y1 * W + x1) * 4 + 3] > ALPHA_MIN, b = in2 && px[(y2 * W + x2) * 4 + 3] > ALPHA_MIN;
  if (a !== b) return false;
  if (!a) return true;
  const i = (y1 * W + x1) * 4, j = (y2 * W + x2) * 4;
  return px[i] === px[j] && px[i + 1] === px[j + 1] && px[i + 2] === px[j + 2];
}
const rowDiff = (px, W, a, b) => { let n = 0; for (let x = 0; x < W; x++) if (!same(px, W, x, a, x, b)) n++; return n; };
/** How visible the break is if every row above `c` shifts dx px: mismatches it adds between rows c-1 and c. */
function shearCost(px, W, c, dx) {
  let n = 0;
  for (let x = 0; x < W; x++) if (!same(px, W, x - dx, c - 1, x, c)) n++;
  return Math.max(0, n - rowDiff(px, W, c - 1, c));
}

/** A lean break is used only when it adds at most this many mismatched pixels (both directions together). */
export const LEAN_MAX_COST = 4;
/** Extra squash rows (besides the reviewed low cut) may differ from the row above by at most this many px. */
export const SQUASH_ROW_MAX = 10;

/**
 * Cut rows for the rig, or null when the sprite is too small to move.
 * → { bounds, drops: [rows, lowest first], head, headCost, ears, earCost, low }
 * `head`/`ears` are -1 when no clean row exists (that move is left out).
 */
export function rigCuts(px, W, H, { face = null, minHeight = 20 } = {}) {
  const low = pokemonCuts(px, W, H, { face, minHeight });
  if (!low) return null;
  const b = opaqueBounds(px, W, H);
  const free = (y) => !face || y < face[0] || y > face[1];
  const best = (lo, hi, cost) => {
    let by = -1, bc = Infinity;
    for (let y = Math.max(1, Math.round(lo)); y <= Math.min(H - 1, Math.round(hi)); y++) {
      if (!free(y)) continue;
      const c = cost(y);
      if (c < bc) { bc = c; by = y; }
    }
    return { y: by, c: bc };
  };
  // Squash: the reviewed low cut, plus up to 2 more clean rows below the face, at least 3 apart.
  const drops = [low.waist];
  const from = face ? Math.max(face[1] + 1, b.y0 + b.h * 0.45) : b.y0 + b.h * 0.55, cand = [];
  for (let y = Math.round(from); y <= b.y1 - 2; y++) if (free(y) && y !== low.waist) cand.push({ y, c: rowDiff(px, W, y, y - 1) });
  cand.sort((p, q) => p.c - q.c || q.y - p.y);
  for (const c of cand) {
    if (drops.length >= 3 || c.c > Math.max(SQUASH_ROW_MAX, low.seam)) break;
    if (drops.every((d) => Math.abs(d - c.y) >= 3)) drops.push(c.y);
  }
  drops.sort((p, q) => q - p);
  // Lean: the head band breaks below the face; the ear band above it.
  const lean = (y) => shearCost(px, W, y, 1) + shearCost(px, W, y, -1);
  const headLo = face ? face[1] + 1 : b.y0 + b.h * 0.35;
  const headHi = face ? Math.min(face[1] + 1 + b.h * 0.2, low.waist - 3) : b.y0 + b.h * 0.6;
  const head = best(headLo, headHi, lean);
  const earHi = face ? face[0] - 1 : (head.y > 0 ? head.y - 4 : b.y0 + b.h * 0.3);
  const ears = earHi - b.y0 >= 4 ? best(b.y0 + 2, earHi, lean) : { y: -1, c: Infinity };
  return {
    bounds: b, low, drops,
    head: head.c <= LEAN_MAX_COST ? head.y : -1, headCost: head.c,
    ears: ears.c <= LEAN_MAX_COST ? ears.y : -1, earCost: ears.c,
  };
}

function sinkAbove(px, W, top, split) {
  const out = new Uint8ClampedArray(px);
  for (let y = split; y > top; y--) out.copyWithin(y * W * 4, (y - 1) * W * 4, y * W * 4);
  out.fill(0, top * W * 4, (top + 1) * W * 4);
  return out;
}
const shiftAbove = (px, W, H, cut, dx) => (dx && cut > 0 ? movePart(px, W, H, rectMask(px, W, H, [0, 0, W - 1, cut - 1]), dx, 0) : px);

/**
 * One rig pose: squash `sq` px, head band leaned `head` px, ear band at `ears`
 * px in total (it rides on the head, so it lags when ears ≠ head). Leans
 * happen first, on the rest geometry, then the squash sinks the result.
 */
export function rigPose(px, W, H, rc, { sq = 0, head = 0, ears = 0 }) {
  let out = px;
  if (rc.head > 0 && head) out = shiftAbove(out, W, H, rc.head, head);
  const earExtra = ears - (rc.head > 0 ? head : 0);
  if (rc.ears > 0 && earExtra) out = shiftAbove(out, W, H, rc.ears, earExtra);
  const top = Math.max(0, rc.bounds.y0 - 3);
  for (let i = 0; i < Math.min(sq, rc.drops.length); i++) out = sinkAbove(out, W, top, rc.drops[i]);
  return out;
}

/** Small deterministic PRNG (mulberry32) seeded from the sprite key. */
export function seeded(key) {
  let a = (nameHash(key) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The sprite's performance: { ms, frames: [{ sq, head, ears, blink }] }.
 * Everything is drawn from the sprite's seed. Moves the sprite can't make
 * (no clean head row, no ear band, a 1-row squash) are left out or made
 * smaller, so the same seed still gives that sprite its own rhythm.
 */
export function rigPlan(key, rc, { blink = false } = {}) {
  const r = seeded(key);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const ms = pick([80, 90, 100, 110, 120]);
  const canLean = rc.head > 0 || rc.ears > 0;
  const maxSq = Math.max(1, Math.min(rc.drops.length, int(1, 3)));
  const earLag = int(1, 2), overshoot = r() < 0.4;
  const dirMode = pick(["same", "alternate", "random"]);
  let dir = r() < 0.5 ? 1 : -1;
  const cycles = int(2, 4);
  const restLen = int(4, 9);
  const blinkAt = int(1, restLen - 2), doubleBlink = r() < 0.25;

  const F = [];
  const push = (sq, head, ears, n = 1) => { for (let i = 0; i < n; i++) F.push({ sq, head, ears, blink: false }); };
  // Rest first, so frame 0 is the untouched sprite; the blink falls in it.
  push(0, 0, 0, restLen);
  if (blink) {
    F[blinkAt].blink = true;
    if (doubleBlink && blinkAt + 2 < restLen) F[blinkAt + 2].blink = true;
  }
  for (let c = 0; c < cycles; c++) {
    if (c > 0) dir = dirMode === "alternate" ? -dir : dirMode === "random" ? (r() < 0.5 ? 1 : -1) : dir;
    const style = canLean ? pick(["bounce", "bounce", "dip", "sway"]) : "dip";
    const depth = int(1, maxSq), hold = int(0, 2);
    const h = rc.head > 0 ? dir : 0, e = rc.ears > 0 ? dir : h;
    if (style === "sway") {
      // Lean and come back; the ears drag behind and settle after.
      const len = int(3, 5);
      for (let i = 0; i < len; i++) push(0, h, i < earLag ? 0 : e);
      for (let i = 0; i < earLag; i++) push(0, 0, e);
      if (overshoot) push(0, 0, -e);
    } else {
      // Squash down, hold, rise; on a bounce the head leans at the bottom and the ears follow.
      for (let d = 1; d <= depth; d++) push(d, 0, 0);
      const lean = style === "bounce";
      for (let i = 0; i < hold; i++) push(depth, lean ? h : 0, lean && i >= earLag ? e : 0);
      for (let d = depth - 1; d >= 0; d--) push(d, lean ? h : 0, lean && hold + depth - 1 - d >= earLag ? e : 0);
      if (lean) {
        for (let i = 0; i < earLag; i++) push(0, 0, e);
        if (overshoot) push(0, 0, -e);
      }
    }
    push(0, 0, 0, int(1, 3));
  }
  return { ms, frames: F };
}
