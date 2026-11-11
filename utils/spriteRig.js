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
import { nameHash, movePart } from "./trainerMotion.js";

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

/** A moving band's pieces must hold at least this many pixels and be at least this many rows tall… */
export const BAND_MIN_PX = 12;
/** The ear band must move at least this many pixels: a few loose tips sliding read as a glitch, not a drag. */
export const EAR_MIN_PX = 30;
export const BAND_MIN_ROWS = 3;
/** …and spread at most this fraction of the head's width past either side of it. */
export const BAND_SPREAD = 0.35;

const opaqueAt = (px, W, H, x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > ALPHA_MIN;

/**
 * The head's width: the opaque runs across the face rows that hold the eyes,
 * kept to about a head's width round them; with no eyes, the columns of a
 * hand-marked face ([y0, y1, x0, x1]). Null when the head can't be placed.
 */
export function headSpan(px, W, H, face, eyes) {
  if (!face) return null;
  const runsAt = (y) => { const runs = []; let start = -1; for (let x = 0; x <= W; x++) { const o = x < W && opaqueAt(px, W, H, x, y); if (o && start < 0) start = x; if (!o && start >= 0) { runs.push([start, x - 1]); start = -1; } } return runs; };
  if (eyes?.length) {
    const ex0 = Math.min(...eyes.map((e) => e[0])), ex1 = Math.max(...eyes.map((e) => e[2]));
    let a = Infinity, c = -1;
    for (let y = Math.max(0, face[0]); y <= Math.min(H - 1, face[1]); y++) for (const [r0, r1] of runsAt(y)) if (r1 >= ex0 - 2 && r0 <= ex1 + 2) { a = Math.min(a, r0); c = Math.max(c, r1); }
    if (c < 0) return null;
    // Where the head runs straight into wings or arms at eye height, keep it to about a head's width round the eyes.
    const reach = Math.max(8, 2 * (ex1 - ex0 + 1));
    return [Math.max(a, ex0 - reach), Math.min(c, ex1 + reach)];
  }
  // No eyes: only a face marked with its own columns ([y0, y1, x0, x1]) says where the head is.
  return face.length >= 4 ? [face[2], face[3]] : null;
}

/**
 * A moving band: the best row in [lo, hi] where the head's own piece (and
 * only it) can shift sideways. Everything above the row is split into
 * connected parts; only those standing on the head's span move, so wings,
 * a raised arm or a weapon at the same height stay put, and the moving
 * piece must stay about head-wide. Without a face the head can't be told
 * apart, so a band is used only when everything above the row is one piece
 * no wider than `soloWidth` of the sprite. → { y, c, mask } or null.
 */
function pieceBand(px, W, H, b, lo, hi, span, soloWidth, minPx = BAND_MIN_PX) {
  lo = Math.max(1, Math.round(lo)); hi = Math.min(H - 1, Math.round(hi));
  let best = null;
  for (let y = hi; y >= lo; y--) {
    // Connected parts (8-way) of everything above row y.
    const lab = new Int32Array(W * y).fill(-1), parts = [];
    for (let sy = 0; sy < y; sy++) for (let sx = 0; sx < W; sx++) {
      if (!opaqueAt(px, W, H, sx, sy) || lab[sy * W + sx] >= 0) continue;
      const id = parts.length, part = { px: [], rows: [H, -1], foot: [] }, st = [[sx, sy]];
      lab[sy * W + sx] = id;
      while (st.length) {
        const [x, yy] = st.pop();
        part.px.push(yy * W + x); part.rows[0] = Math.min(part.rows[0], yy); part.rows[1] = Math.max(part.rows[1], yy);
        if (yy === y - 1) part.foot.push(x);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = yy + dy;
          if (ny < 0 || ny >= y || !opaqueAt(px, W, H, nx, ny) || lab[ny * W + nx] >= 0) continue;
          lab[ny * W + nx] = id; st.push([nx, ny]);
        }
      }
      parts.push(part);
    }
    let keep = span ? parts.filter((q) => q.foot.some((x) => x >= span[0] && x <= span[1])) : parts.length === 1 ? parts : [];
    keep = keep.filter((q) => q.px.length >= BAND_MIN_PX && q.rows[1] - q.rows[0] + 1 >= BAND_MIN_ROWS);
    if (!keep.length || keep.reduce((n, q) => n + q.px.length, 0) < minPx) continue;
    const xs = keep.flatMap((q) => q.px.map((i) => i % W)), x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (span) { const w = span[1] - span[0] + 1; if (x0 < span[0] - w * BAND_SPREAD || x1 > span[1] + w * BAND_SPREAD) continue; }
    else if (x1 - x0 + 1 > b.w * soloWidth) continue;
    const mask = new Uint8Array(W * H);
    for (const q of keep) for (const i of q.px) mask[i] = 1;
    // Visibility of the break: after the move, row y-1 holds the pixel from x-dx wherever the band was or
    // arrives (movePart fills a vacated pixel from just behind); count the mismatches with row y this adds.
    let c = 0;
    for (const dx of [1, -1]) {
      let added = 0;
      for (let x = 0; x < W; x++) {
        if (!(mask[(y - 1) * W + x] || (x - dx >= 0 && x - dx < W && mask[(y - 1) * W + x - dx]))) continue;
        added += (same(px, W, x - dx, y - 1, x, y) ? 0 : 1) - (same(px, W, x, y - 1, x, y) ? 0 : 1);
      }
      c += Math.max(0, added);
    }
    if (c <= LEAN_MAX_COST && (!best || c < best.c)) best = { y, c, mask };
  }
  return best;
}

/** A lean break is used only when it adds at most this many mismatched pixels (both directions together). */
export const LEAN_MAX_COST = 4;
/** Extra squash rows (besides the reviewed low cut) may differ from the row above by at most this many px. */
export const SQUASH_ROW_MAX = 10;

/**
 * Cut rows for the rig, or null when the sprite is too small to move.
 * → { bounds, drops: [rows, lowest first], head, headCost, headMask, ears, earCost, earMask, low }
 * `head`/`ears` are -1 when no clean row exists (that move is left out).
 * Both bands move only the head's own piece (`headMask`, `earMask`): pieces
 * above the line that belong to something else (wings, a raised arm, a
 * weapon) stay put, so no wing tip or arm slides on its own. `off` switches
 * a move off after review ({ head?: reason, ears?: reason }).
 */
export function rigCuts(px, W, H, { face = null, eyes = null, minHeight = 20, off = null } = {}) {
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
  // Lean: the head's own piece breaks below the face; the ear band (its top) above the face.
  const span = headSpan(px, W, H, face, eyes);
  const headLo = face ? face[1] + 1 : b.y0 + b.h * 0.35;
  const headHi = face ? Math.min(face[1] + 1 + b.h * 0.2, low.waist - 3) : b.y0 + b.h * 0.6;
  // Without a face the head can't be told from the body above the line, so only a known head leans.
  const head = span && !off?.head ? pieceBand(px, W, H, b, headLo, headHi, span, 0) : null;
  const earHi = face ? face[0] - 1 : (head ? head.y - 4 : b.y0 + b.h * 0.3);
  const earLo = b.y0 + Math.max(BAND_MIN_ROWS + 1, (earHi - b.y0) * 0.4);
  const ear = span && !off?.ears && earHi >= earLo ? pieceBand(px, W, H, b, earLo, earHi, span, 0, EAR_MIN_PX) : null;
  return {
    bounds: b, low, drops,
    head: head ? head.y : -1, headCost: head ? head.c : Infinity, headMask: head ? head.mask : null,
    ears: ear ? ear.y : -1, earCost: ear ? ear.c : Infinity, earMask: ear ? ear.mask : null,
  };
}

function sinkAbove(px, W, top, split) {
  const out = new Uint8ClampedArray(px);
  for (let y = split; y > top; y--) out.copyWithin(y * W * 4, (y - 1) * W * 4, y * W * 4);
  out.fill(0, top * W * 4, (top + 1) * W * 4);
  return out;
}

/**
 * One rig pose: squash `sq` px, head band leaned `head` px, ear band at `ears`
 * px in total (it rides on the head, so it lags when ears ≠ head). Leans
 * happen first, on the rest geometry, then the squash sinks the result.
 */
export function rigPose(px, W, H, rc, { sq = 0, head = 0, ears = 0 }) {
  let out = px;
  if (rc.head > 0 && head) out = movePart(out, W, H, rc.headMask, head, 0);
  const earExtra = ears - (rc.head > 0 ? head : 0);
  if (rc.ears > 0 && earExtra) out = movePart(out, W, H, rc.earMask, earExtra, 0);
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
