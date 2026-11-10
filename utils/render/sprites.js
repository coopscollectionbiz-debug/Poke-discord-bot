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
  return { image: trimmed, width: box.w, height: box.h, frames: gif.numFrames(), box, fullW: gif.width, fullH: gif.height };
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
export function drawSprite(ctx, sprite, cx, floorY, boxW, boxH, { scale = 2, alpha = 1, frame = null } = {}) {
  if (!sprite) return null;
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
}
