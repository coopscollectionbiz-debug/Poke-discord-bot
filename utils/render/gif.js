// ==========================================================
// utils/render/gif.js
// The one GIF encoder for cards and battle frames: a canvas, a draw(frame)
// callback, a frame count. One palette sampled from a few frames (the first
// and last by default), an RGB565 nearest-color cache, and after the first
// frame only the rectangle that changed is written; inside it, pixels that
// match the previous frame are transparent. Yields between frames so other
// commands keep running.
//
// Cutting repeated work without changing a pixel: a frame's pixels are first
// compared with the previous frame's raw RGBA, and only changed pixels are
// mapped to the palette. A changed pixel that maps to the same palette index
// is unchanged on screen, so it is transparent too, as before. The decoded
// frames are the same as when every frame was written full size
// (tools/render-golden.mjs checks this on real cards and battles).
//
// Smooth gradients (a card's halves, a battle's background): with one
// 255-colour palette for the whole image, a dark gradient gets few colours
// and bands into faint blocks, which the still PNG never shows. With
// `background` (the image's static layer: everything drawn before the
// animated parts), BG_COLOURS of the palette are chosen from that layer
// alone, and a pixel still showing it is ordered-dithered (4×4 Bayer)
// between them. The offset is small (±8 per channel), so a distinct colour
// (text, pixel art) still maps to itself; only colours with close
// neighbours in the palette, as in a gradient, spread. The dither depends only on
// the pixel's position, so a pixel that doesn't change between frames maps
// to the same index every frame and later frames stay as small.
// ==========================================================

import gifenc from "gifenc";

const { GIFEncoder, quantize, nearestColorIndex } = gifenc;
const pause = () => new Promise((resolve) => setImmediate(resolve));
export const BG_COLOURS = 96;
const DITHER = 16; // ± half this, per channel, at the extremes of the Bayer pattern
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// gifenc writes every frame at (0, 0). Each frame starts with an 8-byte
// Graphic Control Extension, then the image descriptor: 0x2c, x, y (LE16).
const GCE_BYTES = 8;

function placeFrame(gif, start, x, y) {
  const view = gif.bytesView();
  const d = start + GCE_BYTES;
  if (view[start] !== 0x21 || view[d] !== 0x2c) throw new Error("gif: unexpected frame layout");
  view[d + 1] = x & 0xff;
  view[d + 2] = x >> 8;
  view[d + 3] = y & 0xff;
  view[d + 4] = y >> 8;
}

const u32 = (px) => (px.byteOffset % 4 === 0
  ? new Uint32Array(px.buffer, px.byteOffset, px.byteLength >> 2)
  : new Uint32Array(Uint8Array.from(px).buffer));

/**
 * Encodes `total` frames drawn by `draw(f)` on `canvas` into a looping GIF.
 *   delay  — ms per frame, or (f) => ms
 *   sample — frames whose pixels choose the palette, in sample order (the
 *            battle adds its award screen); drawn last to first, so frame 0
 *            is on the canvas when encoding starts.
 *   background — the static layer's RGBA (W × H × 4), or null: see above.
 */
export async function encodeFrames(canvas, draw, total, { delay = 100, sample = [0, total - 1], background = null } = {}) {
  const W = canvas.width, H = canvas.height, N = W * H;
  const delayOf = typeof delay === "function" ? delay : () => delay;

  const pixels = new Uint8Array(N * 4 * sample.length);
  for (let k = sample.length - 1; k >= 0; k--) {
    draw(sample[k]);
    pixels.set(canvas.data(), N * 4 * k);
  }
  if (sample[0] !== 0) draw(0);
  const bg = background && background.length === N * 4 ? background : null;
  const bgPal = bg ? quantize(bg, BG_COLOURS) : [];
  const palette = [...bgPal, ...quantize(pixels, 255 - bgPal.length)];
  const clear = palette.length; // the transparent index: "same as the last frame"
  await pause();

  const nearest = new Int16Array(1 << 16).fill(-1); // RGB565 color -> palette index
  const plain = (px, p) => {
    const key = ((px[p] >> 3) << 11) | ((px[p + 1] >> 2) << 5) | (px[p + 2] >> 3);
    let idx = nearest[key];
    if (idx < 0) idx = nearest[key] = nearestColorIndex(palette, [px[p], px[p + 1], px[p + 2]]);
    return idx;
  };
  const dithered = new Int16Array(bg ? 1 << 18 : 1).fill(-1); // RGB666 -> background palette index
  const indexOf = (px, p) => {
    if (!bg || px[p] !== bg[p] || px[p + 1] !== bg[p + 1] || px[p + 2] !== bg[p + 2]) return plain(px, p);
    const i = p >> 2, o = (BAYER4[((i / W) | 0) & 3][(i % W) & 3] / 16 - 0.5) * DITHER;
    const r = Math.max(0, Math.min(255, px[p] + o)), g = Math.max(0, Math.min(255, px[p + 1] + o)), b = Math.max(0, Math.min(255, px[p + 2] + o));
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = dithered[key];
    if (idx < 0) idx = dithered[key] = nearestColorIndex(bgPal, [r, g, b]);
    return idx;
  };
  const shown = new Uint8Array(N); // palette index on screen after the last frame
  const prevRaw = new Uint32Array(N); // its RGBA
  const changes = new Uint8Array(N); // this frame's indices, `clear` where unchanged
  const rect = new Uint8Array(N);
  const gif = GIFEncoder();

  for (let f = 0; f < total; f++) {
    if (f > 0) draw(f);
    const px = canvas.data();
    const raw = u32(px);
    if (f === 0) {
      for (let i = 0, p = 0; i < N; i++, p += 4) shown[i] = indexOf(px, p);
      prevRaw.set(raw);
      gif.writeFrame(shown, W, H, { palette: [...palette, [0, 0, 0]], delay: delayOf(0) });
    } else {
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let y = 0, i = 0; y < H; y++) {
        let rowFirst = -1, rowLast = -1;
        for (let x = 0; x < W; x++, i++) {
          if (raw[i] === prevRaw[i]) { changes[i] = clear; continue; }
          prevRaw[i] = raw[i];
          const idx = indexOf(px, i << 2);
          if (idx === shown[i]) { changes[i] = clear; continue; }
          shown[i] = changes[i] = idx;
          if (rowFirst < 0) rowFirst = x;
          rowLast = x;
        }
        if (rowFirst >= 0) {
          if (rowFirst < x0) x0 = rowFirst;
          if (rowLast > x1) x1 = rowLast;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
      // dispose 1 keeps each frame under the next; gifenc's default for a
      // transparent frame clears it, which would blank the unchanged pixels.
      const opts = { delay: delayOf(f), transparent: true, transparentIndex: clear, dispose: 1 };
      const start = gif.bytesView().length;
      if (x1 < 0) {
        // Nothing changed: one transparent pixel keeps the frame's timing.
        rect[0] = clear;
        gif.writeFrame(rect.subarray(0, 1), 1, 1, opts);
      } else {
        const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
        for (let y = 0; y < rh; y++) rect.set(changes.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + rw), y * rw);
        gif.writeFrame(rect.subarray(0, rw * rh), rw, rh, opts);
        placeFrame(gif, start, x0, y0);
      }
    }
    await pause();
  }
  gif.finish();
  const bytes = gif.bytesView();
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Cards: fixed delay, palette from the first and last frames; `background` as in encodeFrames. */
export function encodeGif(canvas, draw, total, delayMs = 100, { background = null } = {}) {
  return encodeFrames(canvas, draw, total, { delay: delayMs, background });
}
