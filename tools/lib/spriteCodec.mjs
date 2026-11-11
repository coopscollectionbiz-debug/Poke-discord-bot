// ==========================================================
// tools/lib/spriteCodec.mjs — shared GIF/PNG helpers for the sprite import
// tools (moved unchanged from tools/import-sprites.mjs in Mega Phase M0).
// Build-time only; the bot never imports this file.
// ==========================================================

import omggif from "omggif";
import gifenc from "gifenc";
const { GIFEncoder } = gifenc;
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Composited RGBA frames of a GIF, as a browser plays it (disposal 0–3). */
export function gifFrames(buf) {
  const reader = new omggif.GifReader(new Uint8Array(buf));
  const { width, height } = reader;
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let saved = null;
  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    if (info.disposal === 3) saved = canvas.slice();
    reader.decodeAndBlitFrameRGBA(i, canvas);
    frames.push({ rgba: canvas.slice(), delayMs: (info.delay || 10) * 10 });
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y++) canvas.fill(0, (y * width + info.x) * 4, (y * width + info.x + info.width) * 4);
    } else if (info.disposal === 3 && saved) canvas.set(saved);
  }
  return { width, height, frames, disposals: Array.from({ length: reader.numFrames() }, (_, i) => reader.frameInfo(i).disposal), loop: reader.loopCount() };
}

/** Lossless GIF encode of full RGBA frames (binary alpha, ≤255 colours per frame). */
export function encodeGif(width, height, frames) {
  const gif = GIFEncoder();
  for (const { rgba, delayMs } of frames) {
    const colors = new Map();
    const index = new Uint8Array(width * height);
    const palette = [[0, 0, 0]]; // index 0 = transparent
    for (let p = 0; p < width * height; p++) {
      if (rgba[p * 4 + 3] < 128) { index[p] = 0; continue; }
      const key = (rgba[p * 4] << 16) | (rgba[p * 4 + 1] << 8) | rgba[p * 4 + 2];
      let k = colors.get(key);
      if (k === undefined) {
        if (palette.length >= 256) throw new Error("more than 255 colours in a frame; refusing a lossy encode");
        k = palette.length; colors.set(key, k); palette.push([rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]]);
      }
      index[p] = k;
    }
    while (palette.length < 2) palette.push([0, 0, 0]);
    gif.writeFrame(index, width, height, { palette, delay: delayMs, transparent: true, transparentIndex: 0, dispose: 2, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

export const luma709 = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
export function toGrayscale(frames) {
  return frames.map(({ rgba, delayMs }) => {
    const out = new Uint8ClampedArray(rgba);
    for (let p = 0; p < out.length; p += 4) {
      const l = luma709(out[p], out[p + 1], out[p + 2]);
      out[p] = out[p + 1] = out[p + 2] = l;
    }
    return { rgba: out, delayMs };
  });
}

export async function pngToFrames(buf) {
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  for (let p = 3; p < data.length; p += 4) data[p] = data[p] >= 128 ? 255 : 0; // binary alpha, as GIF requires
  return { width: img.width, height: img.height, frames: [{ rgba: new Uint8ClampedArray(data), delayMs: 0 }] };
}

