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

import { idleCuts, breathPose, breathLoop, poseAtFrame } from "./trainerIdle.js";

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
    rest: Math.round((900 * tempo) / 10) * 10, // the holds scale with tempo; the 360 ms steps between them don't
    exhale: Math.round((700 * tempo) / 10) * 10,
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

/**
 * Wind sway: inside `rect`, only the rows from `from` (0 = top of the rect,
 * 1 = bottom) down move by d. The part above the cut stays where it hangs from,
 * so hair or cloth bends at the cut instead of sliding as a block.
 */
export function swayMask(px, W, H, [x0, y0, x1, y1], from = 0.5) {
  const cut = Math.round(y0 + (y1 - y0) * from);
  return rectMask(px, W, H, [x0, Math.max(y0, cut), x1, y1]);
}

/** The sprite with one part event applied (a "state"). */
export function applyEvent(px, W, H, ev) {
  if (ev.kind === "blink") return blinkEyes(px, W, H, ev.eyes, { dark: ev.dark ?? 90 });
  let out = px;
  for (const part of ev.parts ?? []) {
    const mask = ev.kind === "sway" ? swayMask(px, W, H, part.rect, part.from ?? 0.5) : rectMask(px, W, H, part.rect);
    out = movePart(out, W, H, mask, part.d[0], part.d[1]);
  }
  return out;
}

// ---- Breathing poses from fixed cuts -----------------------------------
/** Breath pose of any state, using the rest sprite's cut lines (see breathPose in trainerIdle.js). */
export function poseOf(px, W, cuts, pose) {
  return breathPose(px, W, cuts, pose);
}

// ---- Timelines -----------------------------------------------------------
/**
 * Standalone loop (embeds, web): segments [{ state, pose, ms }] where state is
 * an index into [rest, ...events] (0 = no event). Events sit at `at` (fraction
 * of the loop) for `ms`; the loop is rotated by the trainer's phase.
 */
export function idleTimeline(file, events = [], steps = 1) {
  const t = breathTiming(file);
  const breath = breathLoop(steps, t);
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
export function cardSchedule(file, n, events = [], steps = 1) {
  const shift = Math.round(breathTiming(file).phase * n);
  return Array.from({ length: n }, (_, f) => {
    let state = 0;
    events.forEach((e, k) => {
      const a = Math.round(e.at * n), len = Math.max(1, Math.round(e.ms / 100));
      if (f >= a && f < a + len) state = k + 1;
    });
    return { state, pose: poseAtFrame((f + shift) % n, n, steps) };
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
