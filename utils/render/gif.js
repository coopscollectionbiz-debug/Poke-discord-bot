// ==========================================================
// utils/render/gif.js
// Encodes a looping animated GIF from a canvas and a draw(frame) callback,
// with the battle renderer's technique (utils/battle/render.js): one palette
// sampled from the first and last frames, an RGB565 nearest-color cache, and
// unchanged pixels written as transparent so later frames stay small.
// Yields between frames so other commands keep running.
//
// TODO(Milestone C): have renderBattleFrame use this too, so the encoder
// lives in one place. Left separate here to keep battle code untouched
// during the prototype.
// ==========================================================

import gifenc from "gifenc";

const { GIFEncoder, quantize, nearestColorIndex } = gifenc;
const pause = () => new Promise((resolve) => setImmediate(resolve));

export async function encodeGif(canvas, draw, total, delayMs = 100) {
  const W = canvas.width, H = canvas.height;
  draw(total - 1);
  const sample = new Uint8Array(W * H * 8);
  sample.set(canvas.data(), W * H * 4);
  draw(0);
  sample.set(canvas.data(), 0);
  const palette = quantize(sample, 255);
  const clear = palette.length;
  await pause();

  const nearest = new Int16Array(1 << 16).fill(-1);
  let cur = new Uint8Array(W * H), prev = new Uint8Array(W * H);
  const changes = new Uint8Array(W * H);
  const gif = GIFEncoder();
  for (let f = 0; f < total; f++) {
    if (f > 0) draw(f);
    const px = canvas.data();
    for (let i = 0, p = 0; i < cur.length; i++, p += 4) {
      const key = ((px[p] >> 3) << 11) | ((px[p + 1] >> 2) << 5) | (px[p + 2] >> 3);
      let idx = nearest[key];
      if (idx < 0) idx = nearest[key] = nearestColorIndex(palette, [px[p], px[p + 1], px[p + 2]]);
      cur[i] = idx;
    }
    if (f === 0) gif.writeFrame(cur, W, H, { palette: [...palette, [0, 0, 0]], delay: delayMs });
    else {
      for (let i = 0; i < cur.length; i++) changes[i] = cur[i] === prev[i] ? clear : cur[i];
      gif.writeFrame(changes, W, H, { delay: delayMs, transparent: true, transparentIndex: clear, dispose: 1 });
    }
    [cur, prev] = [prev, cur];
    await pause();
  }
  gif.finish();
  const bytes = gif.bytesView();
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
