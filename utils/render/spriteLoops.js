// ==========================================================
// utils/render/spriteLoops.js
// How Pokémon sprites loop on animated cards, so their animations don't cut
// mid-motion (tools/audit-pokemon-loops.mjs: today 1,127 of 1,151 normal
// sprites are cut by the cards' fixed 2.4 s loop).
//
// Each sprite gets a loop plan: its whole cycle when that's 8 s or less;
// a longer one ends at its last exact return to its idle frame (frame 0)
// between 2 s and 8 s; one with no such return plays sped up to fit 8 s.
//
// A card then picks one loop length L for all its sprites: the one that
// lets the most of them play whole cycles, each nudged up to ±15% in speed
// (a sprite may play its cycle k times in L). Sprites that can't fit still
// play, with a seam once per loop. A card with something on the trainers'
// 2.4 s clock (a breathing trainer, a tier or shiny backdrop) picks L from
// whole multiples of 2.4 s, so that keeps looping cleanly too. Frames step
// every 50 ms (100 ms rounded GIF delays to whole 10 ms steps poorly for
// the sprites' own 30–90 ms frames).
//
// POKEMON_LOOP_FIT=0 turns this off: the old 2.4 s loop at 100 ms steps,
// sprites anchored on their first frame.
// ==========================================================

import { opaqueBounds, pokemonLoopFit } from "./sprites.js";
export { pokemonLoopFit };

export const LOOP_CAP_MS = 8000;
export const IDLE_RETURN_MIN_MS = 2000;
export const NUDGE = 0.15;
export const STEP_MS = 50;
export const TRAINER_LOOP_MS = 2400;
// A fitted card or playback image over this falls back to the old timing.
export const MAX_GIF_BYTES = 8 * 1024 * 1024;


/** Every frame's full RGBA, composited as a browser plays it (disposal 0–2). */
export function decodeFrames(anim) {
  const { gif, width: W, height: H } = anim;
  const px = new Uint8ClampedArray(W * H * 4);
  const frames = [];
  for (let i = 0; i < gif.numFrames(); i++) {
    const prev = i > 0 ? gif.frameInfo(i - 1) : null;
    if (prev?.disposal === 2) for (let y = prev.y; y < prev.y + prev.height; y++) px.fill(0, (y * W + prev.x) * 4, (y * W + prev.x + prev.width) * 4);
    gif.decodeAndBlitFrameRGBA(i, px);
    frames.push(px.slice());
  }
  return frames;
}

const plans = new WeakMap(); // anim -> plan

/**
 * A sprite's loop plan: { duration, loopEnd, speed, period, how }. Its
 * native time at card time t (no nudge) is ((t × speed) mod loopEnd);
 * `period` is one loop in card time.
 */
export function loopPlan(anim) {
  if (plans.has(anim)) return plans.get(anim);
  const { starts, duration } = anim;
  let plan = { duration, loopEnd: duration, speed: 1, how: "whole cycle" };
  if (duration > LOOP_CAP_MS) {
    const frames = decodeFrames(anim);
    const idle = frames[0];
    let cut = 0;
    for (let i = 1; i < frames.length; i++) {
      if (starts[i] < IDLE_RETURN_MIN_MS || starts[i] > LOOP_CAP_MS) continue;
      const f = frames[i];
      let same = true;
      for (let j = 0; j < f.length; j++) if (f[j] !== idle[j]) { same = false; break; }
      if (same) cut = starts[i];
    }
    plan = cut
      ? { duration, loopEnd: cut, speed: 1, how: `cut at its idle return, ${cut} ms` }
      : { duration, loopEnd: duration, speed: duration / LOOP_CAP_MS, how: `sped up ×${(duration / LOOP_CAP_MS).toFixed(2)}` };
  }
  plan.period = plan.loopEnd / plan.speed;
  plans.set(anim, plan);
  return plan;
}

/**
 * The loop length for a card's sprites (loop periods in ms) and how each
 * fits it: { L, fit: [{ k, s } | null] }: sprite i plays its loop k times
 * in L at speed 1/s (s within 1 ± NUDGE), or null (it seams once per loop).
 * `trainerClock`: L must be a whole multiple of 2.4 s (up to 7.2 s).
 * `singleCapMs`: with the clock and only one animated sprite, multiples of
 * 2.4 s up to this long (cards pass SINGLE_CLOCK_CAP_MS, 12 s): a lone shiny
 * on a catch, Pokédex or inspect card then always plays whole cycles
 * (tools/audit-sprite-loops.mjs: 12.5% of sprites jumped at 7.2 s, 0% at 12 s).
 */
export const SINGLE_CLOCK_CAP_MS = 12_000;
export function fitLoop(periods, { trainerClock = false, singleCapMs = 7200 } = {}) {
  const live = periods.filter(Boolean);
  if (!live.length) return { L: TRAINER_LOOP_MS, fit: periods.map(() => null) };
  let candidates;
  if (trainerClock) {
    const cap = live.length === 1 ? Math.max(7200, singleCapMs) : 7200;
    candidates = [];
    for (let L = TRAINER_LOOP_MS; L <= cap; L += TRAINER_LOOP_MS) candidates.push(L);
  }
  else if (live.length === 1) candidates = [Math.max(STEP_MS, Math.round(live[0] / STEP_MS) * STEP_MS)]; // one sprite: its own cycle
  else {
    candidates = [];
    for (let L = 2000; L <= LOOP_CAP_MS; L += 100) candidates.push(L);
  }
  let best = null;
  for (const L of candidates) {
    const fit = periods.map((p) => {
      if (!p) return null;
      const k = Math.max(1, Math.round(L / p)), s = L / (k * p);
      return Math.abs(s - 1) <= NUDGE + 1e-9 ? { k, s } : null;
    });
    const seams = fit.filter((x, i) => periods[i] && !x).length;
    const err = fit.reduce((a, x) => a + (x ? Math.abs(x.s - 1) : 0), 0);
    if (!best || seams < best.seams || (seams === best.seams && err < best.err - 1e-9)) best = { L, fit, seams, err };
  }
  return { L: best.L, fit: best.fit };
}

/** A sprite's native time (ms) at card time t, given its plan and fit. */
export function spriteTime(plan, fit, t) {
  const tt = fit ? t / fit.s : t;
  return (((tt * plan.speed) % plan.loopEnd) + plan.loopEnd) % plan.loopEnd;
}

const unions = new WeakMap(); // anim -> box

/** The box covering every frame's opaque pixels, in GIF-canvas pixels. */
export function unionBox(anim) {
  if (unions.has(anim)) return unions.get(anim);
  let u = null;
  for (const px of decodeFrames(anim)) {
    const b = opaqueBounds(px, anim.width, anim.height);
    if (!b) continue;
    u = u ? { x0: Math.min(u.x0, b.x), y0: Math.min(u.y0, b.y), x1: Math.max(u.x1, b.x + b.w), y1: Math.max(u.y1, b.y + b.h) }
      : { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
  }
  const box = u ? { x: u.x0, y: u.y0, w: u.x1 - u.x0, h: u.y1 - u.y0 } : { x: 0, y: 0, w: anim.width, h: anim.height };
  unions.set(anim, box);
  return box;
}
