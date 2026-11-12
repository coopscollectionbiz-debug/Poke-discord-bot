// ==========================================================
// utils/render/sprites.js
// Pokémon sprites for server-rendered images, read from local files through
// the sprite manifest (data/sprites/sprites.json via utils/sprites.js), never
// fetched over HTTP. The existing /showteam card loads its own sprites from
// the public URL, which costs a network round trip per sprite (two: it tries
// a .png first) and fails whenever the public host is unreachable.
//
// Sprites are 2D pixel art (Black/White style for every generation), so they
// are scaled by whole numbers with smoothing off: every source pixel becomes
// an exact square, never a blur.
// ==========================================================

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { GifReader } from "omggif";
import { spriteRecord } from "../sprites.js";
import { isMegaId, megaSpriteRecord } from "../megas.js";
import { stepCount } from "../trainerIdle.js";
import { motionStates, poseOf, cardSchedule } from "../trainerMotion.js";
import { trainerIdle, trainersAnimated, trainerParts } from "../trainerAssets.js";

const PUBLIC = new URL("../../public/", import.meta.url);
const CACHE_LIMIT = 200; // trimmed sprites are ~15 KB of pixels each
const cache = new Map(); // "id:variant" -> Promise<sprite|null>

/** Opaque bounding box of RGBA pixels, or null when fully transparent. */
export function opaqueBounds(data, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** POKEMON_LOOP_FIT=0 turns off the loop fitting and union-box anchor (utils/render/spriteLoops.js). */
export const pokemonLoopFit = (env = process.env) => env.POKEMON_LOOP_FIT !== "0";

// The box covering every frame's opaque pixels (the union box), so a sprite
// that flies or bobs is placed by its whole motion: anchored on its first
// frame alone, Yanma dipped almost out of the bottom of its box.
function unionOfFrames(gif, first) {
  const W = gif.width, H = gif.height, px = new Uint8ClampedArray(W * H * 4);
  let u = { x0: first.x, y0: first.y, x1: first.x + first.w, y1: first.y + first.h };
  for (let i = 0; i < gif.numFrames(); i++) {
    const prev = i > 0 ? gif.frameInfo(i - 1) : null;
    if (prev?.disposal === 2) for (let y = prev.y; y < prev.y + prev.height; y++) px.fill(0, (y * W + prev.x) * 4, (y * W + prev.x + prev.width) * 4);
    gif.decodeAndBlitFrameRGBA(i, px);
    const b = opaqueBounds(px, W, H);
    if (b) u = { x0: Math.min(u.x0, b.x), y0: Math.min(u.y0, b.y), x1: Math.max(u.x1, b.x + b.w), y1: Math.max(u.y1, b.y + b.h) };
  }
  return { x: u.x0, y: u.y0, w: u.x1 - u.x0, h: u.y1 - u.y0 };
}

async function decodeFirstFrame(file) {
  const gif = new GifReader(await readFile(file));
  const pixels = new Uint8ClampedArray(gif.width * gif.height * 4);
  gif.decodeAndBlitFrameRGBA(0, pixels);
  const box = opaqueBounds(pixels, gif.width, gif.height);
  if (!box) return null;
  const full = createCanvas(gif.width, gif.height);
  full.getContext("2d").putImageData(new ImageData(pixels, gif.width, gif.height), 0, 0);
  const trimmed = createCanvas(box.w, box.h);
  trimmed.getContext("2d").drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const ubox = gif.numFrames() > 1 ? unionOfFrames(gif, box) : box;
  return { image: trimmed, width: box.w, height: box.h, frames: gif.numFrames(), box, ubox, fullW: gif.width, fullH: gif.height };
}

/**
 * Where a sprite lives: a species number reads data/sprites/sprites.json, a
 * Mega form id ("mega-charizard-x") reads the Mega manifest
 * (data/sprites/megas.json). Null when the manifest has no file — a Mega
 * with no sprite is NEVER drawn with its base form's art (callers draw the
 * placeholder instead).
 */
export function spriteFileFor(id, variant = "normal") {
  if (isMegaId(id)) {
    const rec = megaSpriteRecord(id)?.[variant];
    return rec?.file ? `sprites/pokemon/mega/${rec.file}` : null;
  }
  const rec = spriteRecord(id)?.[variant];
  return rec?.file ? `sprites/pokemon/${rec.file}` : null;
}

/**
 * A static, trimmed sprite for one species (or Mega form id) + variant
 * ("normal" | "shiny" | "grayscale"), or null when the manifest has none or
 * the file is unreadable (callers draw the placeholder). The first animation
 * frame is the idle pose.
 */
export function loadStaticSprite(id, variant = "normal") {
  const key = `${id}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const file = spriteFileFor(id, variant);
  const p = file
    ? decodeFirstFrame(fileURLToPath(new URL(file, PUBLIC))).catch(() => null)
    : Promise.resolve(null);
  cache.set(key, p);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return p;
}

let placeholder;
/** The Poké Ball placeholder, as a sprite. */
export function loadPlaceholder() {
  placeholder ??= loadImage(fileURLToPath(new URL("sprites/items/pokeball.png", PUBLIC)))
    .then((image) => ({ image, width: image.width, height: image.height, placeholder: true }))
    .catch(() => null);
  return placeholder;
}

/** A trainer sprite PNG by file name, or null. Only names without path parts. */
export async function loadTrainerSprite(fileName) {
  if (!fileName || !/^[a-z0-9._-]+\.png$/i.test(fileName)) return null;
  try {
    const image = await loadImage(fileURLToPath(new URL(`sprites/trainers_2/${fileName}`, PUBLIC)));
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

const poseCache = new Map(); // fileName -> Promise<poses|null>
const POSE_CACHE_LIMIT = 40; // 3 poses × 80×80 RGBA ≈ 77 KB each

/** Card loop length the trainer schedule is prepared for (utils/render/stage.js FRAMES). */
const CARD_FRAMES = 24;

/**
 * The trainer's idle as drawable sprites, for cards:
 * { poses: [distinct frames] (sprite-like; poses[0] is the unchanged PNG),
 *   poseAt(frame, n) → index into poses, rgba, width, height }.
 * Breathing (utils/trainerIdle.js) at the trainer's own phase, plus its part
 * motions (utils/trainerMotion.js, data/sprites/trainer-parts.json).
 * Null when the file has no approved idle (data/sprites/trainer-idles.json),
 * TRAINERS_ANIMATED=0, or the sprite can't be read; callers then draw the
 * static sprite.
 */
export function loadTrainerPoses(fileName, { env = process.env } = {}) {
  if (!fileName || !trainersAnimated(env) || !trainerIdle(fileName)) return Promise.resolve(null);
  if (poseCache.has(fileName)) return poseCache.get(fileName);
  const rec = trainerIdle(fileName);
  const p = (rec.animation === "real" ? loadRealAnimation(fileName, rec) : (async () => {
    const t = await loadTrainerSprite(fileName);
    if (!t) return null;
    const c = createCanvas(t.width, t.height);
    c.getContext("2d").drawImage(t.image, 0, 0);
    const rgba = c.getContext("2d").getImageData(0, 0, t.width, t.height).data;
    const events = trainerParts(fileName);
    const m = motionStates(rgba, t.width, t.height, events);
    if (!m) return null;
    // One sprite per distinct (part state, breath pose), made on demand.
    const poses = [], index = new Map();
    const spriteFor = (state, pose) => {
      const key = `${state}:${pose}`;
      if (!index.has(key)) {
        const px = poseOf(m.states[state], t.width, m.cuts, pose);
        const pc = createCanvas(t.width, t.height);
        pc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), t.width, t.height), 0, 0);
        poses.push({ image: pc, width: t.width, height: t.height });
        index.set(key, poses.length - 1);
      }
      return index.get(key);
    };
    spriteFor(0, 0);
    const schedules = new Map();
    const scheduleFor = (n) => {
      if (!schedules.has(n)) schedules.set(n, cardSchedule(fileName, n, events, stepCount(m.cuts)).map(({ state, pose }) => spriteFor(state, pose)));
      return schedules.get(n);
    };
    scheduleFor(CARD_FRAMES); // so `poses` is complete before the stage sees it
    return { poses, poseAt: (f, n) => scheduleFor(n)[((f % n) + n) % n], rgba, width: t.width, height: t.height };
  })()).catch(() => null);
  poseCache.set(fileName, p);
  if (poseCache.size > POSE_CACHE_LIMIT) poseCache.delete(poseCache.keys().next().value);
  return p;
}

/**
 * A real animation (artist-made or from the games;
 * data/sprites/trainer-animations.json) as poses: its GIF frames, with
 * poses[0] the still the PNG shows (`still`, default the last frame). poseAt(f, n) plays the whole animation once per card loop of n
 * frames, so it loops cleanly (a 3.2 s animation runs a little faster in a
 * 2.4 s card). `real: true` tells callers to use poseAt rather than the
 * shared breathing schedule.
 */
async function loadRealAnimation(fileName, rec) {
  const t = await loadTrainerSprite(fileName);
  if (!t) return null;
  const gif = new GifReader(await readFile(fileURLToPath(new URL(`sprites/trainers_idle/${rec.gif}`, PUBLIC))));
  const W = gif.width, H = gif.height, N = gif.numFrames(), frames = [];
  for (let i = 0; i < N; i++) {
    const px = new Uint8ClampedArray(W * H * 4); // each frame is complete (dispose 2 over a clear canvas)
    gif.decodeAndBlitFrameRGBA(i, px);
    const c = createCanvas(W, H);
    c.getContext("2d").putImageData(new ImageData(px, W, H), 0, 0);
    frames.push({ image: c, width: W, height: H });
  }
  // poses[0] is the still (rec.still, default the last frame), then the rest in order.
  const still = Number.isInteger(rec.still) && rec.still < N ? rec.still : N - 1;
  const poses = [frames[still], ...frames.filter((_, i) => i !== still)];
  const poseOfFrame = (k) => (k === still ? 0 : k < still ? k + 1 : k);
  const c = createCanvas(t.width, t.height);
  c.getContext("2d").drawImage(t.image, 0, 0);
  return {
    real: true,
    poses,
    // Card frames spread from the first frame to the last (the held pose), like the GIF loop.
    poseAt: (f, n) => poseOfFrame(n > 1 ? Math.round(((((f % n) + n) % n) * (N - 1)) / (n - 1)) : still),
    rgba: c.getContext("2d").getImageData(0, 0, t.width, t.height).data,
    width: W,
    height: H,
  };
}

/**
 * A trainer sprite trimmed to its opaque pixels, or null. Trainer PNGs are
 * 80 × 80 with transparent margins (trimmed: median 39 × 71 px), so trimming
 * lets them stand side by side and on a shared floor.
 */
export async function loadTrimmedTrainerSprite(fileName) {
  const t = await loadTrainerSprite(fileName);
  if (!t) return null;
  const c = createCanvas(t.width, t.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(t.image, 0, 0);
  const box = opaqueBounds(ctx.getImageData(0, 0, t.width, t.height).data, t.width, t.height);
  if (!box) return null;
  const out = createCanvas(box.w, box.h);
  out.getContext("2d").drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { image: out, width: box.w, height: box.h };
}

/** A Badge PNG (public/sprites/badges, from tools/tint-badges.mjs) by file name, or null. */
export async function loadBadgeSprite(fileName) {
  if (!fileName || !/^[a-z0-9._-]+\.png$/i.test(fileName)) return null;
  try {
    const image = await loadImage(fileURLToPath(new URL(`sprites/badges/${fileName}`, PUBLIC)));
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

/**
 * The scale for one sprite: the image's shared `scale` (every Pokémon in an
 * image at the same pixel size, as in the games, so Pikachu stays smaller
 * than Gyarados), unless that overflows the box; then the largest scale that
 * fits. At 2× about 97 % of sprites fit a 180 px box (trimmed sizes:
 * median 54 px, 97th percentile 86–89 px, largest 102 px).
 */
export function spriteScale(w, h, boxW, boxH, scale = 2) {
  return Math.min(scale, boxW / w, boxH / h);
}

/**
 * Draws a sprite standing on (cx, floorY) at `scale` (see spriteScale).
 * Pixel art keeps hard edges (no smoothing) unless it must shrink below 1×.
 */
/**
 * Where a Pokémon sprite goes when anchored on its union box: scaled so the
 * whole motion fits the box, the union's bottom on the floor and its centre
 * on cx. → { s, gx, gy (the GIF canvas's top left), x, y, w, h (the still
 * first frame's rect) }, or null for sprites without one (trainers, the
 * placeholder) or with POKEMON_LOOP_FIT=0.
 */
export function spritePlacement(sprite, cx, floorY, boxW, boxH, scale = 2, env = process.env) {
  if (!sprite?.ubox || sprite.placeholder || !pokemonLoopFit(env)) return null;
  const u = sprite.ubox;
  const s = spriteScale(u.w, u.h, boxW, boxH, scale);
  const gx = cx - (u.x + u.w / 2) * s, gy = floorY - (u.y + u.h) * s;
  return {
    s, gx, gy,
    x: Math.round(gx + sprite.box.x * s), y: Math.round(gy + sprite.box.y * s),
    w: Math.round(sprite.box.w * s), h: Math.round(sprite.box.h * s),
  };
}

export function drawSprite(ctx, sprite, cx, floorY, boxW, boxH, { scale = 2, alpha = 1, frame = null } = {}) {
  if (!sprite) return null;
  const at = spritePlacement(sprite, cx, floorY, boxW, boxH, scale);
  if (at) {
    ctx.imageSmoothingEnabled = at.s < 1;
    ctx.globalAlpha = alpha;
    if (frame) ctx.drawImage(frame, Math.round(at.gx), Math.round(at.gy), Math.round(sprite.fullW * at.s), Math.round(sprite.fullH * at.s));
    else ctx.drawImage(sprite.image, at.x, at.y, at.w, at.h);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    return { x: at.x, y: at.y, w: at.w, h: at.h };
  }
  const s = spriteScale(sprite.width, sprite.height, boxW, boxH, sprite.placeholder ? Math.min(scale, 1.5) : scale);
  const [w, h] = [Math.round(sprite.width * s), Math.round(sprite.height * s)];
  ctx.imageSmoothingEnabled = s < 1;
  const x = Math.round(cx - w / 2), y = Math.round(floorY - h);
  ctx.globalAlpha = alpha;
  if (frame && sprite.box) {
    // An animation frame (the full GIF canvas), placed so its idle pose lands
    // exactly where the trimmed static sprite would.
    const k = w / sprite.width;
    ctx.drawImage(frame, Math.round(x - sprite.box.x * k), Math.round(y - sprite.box.y * k), Math.round(sprite.fullW * k), Math.round(sprite.fullH * k));
  } else ctx.drawImage(sprite.image, x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  return { x, y, w, h };
}

export function clearSpriteCacheForTesting() {
  cache.clear();
  poseCache.clear();
}
