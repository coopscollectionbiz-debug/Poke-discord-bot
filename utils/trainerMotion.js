// ==========================================================
// utils/trainerMotion.js
// Pass 2 of the trainer idle (owner-approved 2026-11-10), on top of the
// breathing in utils/trainerIdle.js:
//   • offsets: every trainer breathes at its own tempo (0.85×–1.2×) and
//     starting point, from a hash of its file name, so trainers shown
//     together never breathe in step;
//   • part motions: small 1-px moves of a part (a saluting or waving hand,
//     a held Poké Ball, a cape caught by wind) and blinks, from
//     data/sprites/trainer-parts.json.
//
// A moved part leaves its old pixels filled from just behind it (the pixel at
// p − d), so an arm stays attached and clear background stays clear. Several
// parts in one event move in the SAME direction (a cape sways one way, never
// bulges both ways). Nothing new is drawn; only the sprite's own pixels move.
// ==========================================================

import { idleCuts } from "./trainerIdle.js";

const ALPHA_MIN = 8;

/** Stable 32-bit hash of a sprite file name. */
export function nameHash(file) {
  let h = 7;
  for (const c of String(file)) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Per-trainer breath timing: tempo 0.85×–1.2× of the base loop, and a phase. */
export function breathTiming(file) {
  const h = nameHash(file);
  const tempo = 0.85 + ((h % 1000) / 1000) * 0.35;
  return {
    rest: Math.round((900 * tempo) / 10) * 10,
    exhale: Math.round((700 * tempo) / 10) * 10,
    lag: 110,
    phase: ((h >>> 10) % 1000) / 1000, // fraction of the loop to start at
  };
}

// ---- Pixel operations (RGBA buffers, W×H) --------------------------------
function opaqueAt(px, W, H, x, y) {
  return x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > ALPHA_MIN;
}

/** Mask of the opaque pixels inside rect [x0, y0, x1, y1] (inclusive). */
export function rectMask(px, W, H, [x0, y0, x1, y1]) {
  const m = new Uint8Array(W * H);
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) if (opaqueAt(px, W, H, x, y)) m[y * W + x] = 1;
  }
  return m;
}

/**
 * Moves the masked pixels by (dx, dy). Each vacated pixel takes the colour of
 * the pixel just behind it (p − d) unless that pixel is part of the moving
 * part too (then the moved part covers it).
 */
export function movePart(px, W, H, mask, dx, dy) {
  const out = new Uint8ClampedArray(px);
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? (y * W + x) * 4 : -1);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const x = i % W, y = (i / W) | 0, b = at(x - dx, y - dy);
    if (b < 0) out.fill(0, i * 4, i * 4 + 4);
    else if (!mask[b / 4]) out.set(px.subarray(b, b + 4), i * 4);
  }
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const t = at((i % W) + dx, ((i / W) | 0) + dy);
    if (t >= 0) out.set(px.subarray(i * 4, i * 4 + 4), t);
  }
  return out;
}

/** Blink: dark pixels in the eye rect take the nearest lighter colour above them. */
export function blinkEyes(px, W, H, [x0, y0, x1, y1], { dark = 90 } = {}) {
  const out = new Uint8ClampedArray(px);
  const lum = (i) => 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4;
    if (px[i + 3] <= ALPHA_MIN || lum(i) > dark) continue;
    for (let yy = y - 1; yy >= Math.max(0, y0 - 3); yy--) {
      const j = (yy * W + x) * 4;
      if (px[j + 3] > ALPHA_MIN && lum(j) > dark) { out.set(px.subarray(j, j + 4), i); break; }
    }
  }
  return out;
}

/** The sprite with one part event applied (a "state"). */
export function applyEvent(px, W, H, ev) {
  if (ev.kind === "blink") return blinkEyes(px, W, H, ev.rect);
  let out = px;
  for (const part of ev.parts ?? []) out = movePart(out, W, H, rectMask(px, W, H, part.rect), part.d[0], part.d[1]);
  return out;
}

// ---- Breathing poses from fixed cuts -----------------------------------
function shiftDown(src, W, top, split, clearTop) {
  const out = new Uint8ClampedArray(src);
  for (let y = split; y > top; y--) out.copyWithin(y * W * 4, (y - 1) * W * 4, y * W * 4);
  if (clearTop) out.fill(0, top * W * 4, (top + 1) * W * 4);
  return out;
}
/** Pose 0 rest, 1 head-lag, 2 exhale of any state, using the rest sprite's cut lines. */
export function poseOf(px, W, cuts, pose) {
  if (pose === 0) return px;
  const top = Math.max(0, cuts.bounds.y0 - 1);
  return pose === 2 ? shiftDown(px, W, top, cuts.waist, true) : shiftDown(px, W, cuts.neck, cuts.waist, false);
}

// ---- Timelines -----------------------------------------------------------
/**
 * Standalone loop (embeds, web): segments [{ state, pose, ms }] where state is
 * an index into [rest, ...events] (0 = no event). Events sit at `at` (fraction
 * of the loop) for `ms`; the loop is rotated by the trainer's phase.
 */
export function idleTimeline(file, events = []) {
  const t = breathTiming(file);
  const breath = [[0, t.rest], [1, t.lag], [2, t.exhale], [1, t.lag]];
  const total = breath.reduce((s, [, ms]) => s + ms, 0);
  const evs = events.map((e, k) => {
    const a = Math.round(e.at * total);
    return { a, b: Math.min(total, a + e.ms), state: k + 1 };
  });
  const marks = new Set([0, total]);
  let acc = 0;
  for (const [, ms] of breath) marks.add((acc += ms));
  for (const e of evs) { marks.add(e.a); marks.add(e.b); }
  // Phase: start the loop at a trainer-specific point (snapped to 10 ms).
  const start = Math.round((t.phase * total) / 10) * 10;
  marks.add(start);
  const sorted = [...marks].sort((x, y) => x - y);
  const poseAt = (ms) => { let a = 0; for (const [p, d] of breath) { if (ms < a + d) return p; a += d; } return 0; };
  let segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b <= a) continue;
    const ev = evs.find((e) => a >= e.a && a < e.b);
    segs.push({ from: a, state: ev?.state ?? 0, pose: poseAt(a), ms: b - a });
  }
  const k = segs.findIndex((s) => s.from >= start);
  if (k > 0) segs = [...segs.slice(k), ...segs.slice(0, k)];
  // Merge neighbours that show the same frame, then fold slivers (< 60 ms,
  // where an event edge lands next to a breath edge) into the frame before
  // them, so nothing flickers.
  const merged = segs.reduce((o, s) => {
    const l = o.at(-1);
    if (l && l.state === s.state && l.pose === s.pose) l.ms += s.ms;
    else o.push({ state: s.state, pose: s.pose, ms: s.ms });
    return o;
  }, []);
  const out = [];
  for (const s of merged) {
    if (s.ms < 60 && out.length) out.at(-1).ms += s.ms;
    else out.push({ ...s });
  }
  if (out.length > 1 && out[0].ms < 60) { out[1].ms += out[0].ms; out.shift(); }
  return out.reduce((o, s) => {
    const l = o.at(-1);
    if (l && l.state === s.state && l.pose === s.pose) l.ms += s.ms;
    else o.push(s);
    return o;
  }, []);
}

/**
 * Card loop (n frames of 100 ms): [{ state, pose }] per frame. One breath per
 * loop, shifted by the trainer's phase; events at `at` × n for ms / 100 frames.
 */
export function cardSchedule(file, n, events = [], breathPose) {
  const shift = Math.round(breathTiming(file).phase * n);
  return Array.from({ length: n }, (_, f) => {
    let state = 0;
    events.forEach((e, k) => {
      const a = Math.round(e.at * n), len = Math.max(1, Math.round(e.ms / 100));
      if (f >= a && f < a + len) state = k + 1;
    });
    return { state, pose: breathPose((f + shift) % n, n) };
  });
}

/**
 * Everything a renderer or the GIF generator needs for one sprite:
 * { cuts, states: [rest, ...event states] } or null when it can't breathe.
 */
export function motionStates(px, W, H, events = []) {
  const cuts = idleCuts(px, W, H);
  if (!cuts) return null;
  return { cuts, states: [px, ...events.map((e) => applyEvent(px, W, H, e))] };
}
