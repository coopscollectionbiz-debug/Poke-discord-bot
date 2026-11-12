// ==========================================================
// tests/gifEncoder.test.js
// The shared GIF encoder (utils/render/gif.js) writes only the rectangle
// that changed in each frame. Checked against the previous encoder, which
// wrote every frame full size: the decoded frames (what a viewer sees after
// each frame) and their delays must be the same, frame for frame. Covers a
// frame with no change, single pixels at the corners, rectangles past 255 px
// (two-byte positions), colours that change but land on the same palette
// entry, a per-frame delay, and a palette sampled from extra frames.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
import omggif from "omggif";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { encodeFrames, encodeGif } from "../utils/render/gif.js";

const { GIFEncoder, quantize, nearestColorIndex } = gifenc;
const { GifReader } = omggif;

// The encoder before this change (every frame full size), kept as the reference.
async function encodeFullFrames(canvas, draw, total, { delay = 100, sample = [0, total - 1] } = {}) {
  const W = canvas.width, H = canvas.height;
  const delayOf = typeof delay === "function" ? delay : () => delay;
  const pixels = new Uint8Array(W * H * 4 * sample.length);
  for (let k = sample.length - 1; k >= 0; k--) {
    draw(sample[k]);
    pixels.set(canvas.data(), W * H * 4 * k);
  }
  if (sample[0] !== 0) draw(0);
  const palette = quantize(pixels, 255);
  const clear = palette.length;
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
    if (f === 0) gif.writeFrame(cur, W, H, { palette: [...palette, [0, 0, 0]], delay: delayOf(0) });
    else {
      for (let i = 0; i < cur.length; i++) changes[i] = cur[i] === prev[i] ? clear : cur[i];
      gif.writeFrame(changes, W, H, { delay: delayOf(f), transparent: true, transparentIndex: clear, dispose: 1 });
    }
    [cur, prev] = [prev, cur];
  }
  gif.finish();
  return Buffer.from(gif.bytesView());
}

/** Every frame as a viewer sees it, with its delay. */
function decoded(buf) {
  const r = new GifReader(new Uint8Array(buf));
  const px = new Uint8Array(r.width * r.height * 4);
  const out = [];
  for (let i = 0; i < r.numFrames(); i++) {
    r.decodeAndBlitFrameRGBA(i, px);
    out.push({ delay: r.frameInfo(i).delay, px: Buffer.from(px) });
  }
  return { r, out };
}

function sameAsReference(name, w, h, total, paint, opts) {
  return (async () => {
    const make = () => {
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      return [canvas, (f) => paint(ctx, f)];
    };
    const [c1, d1] = make();
    const [c2, d2] = make();
    const ref = decoded(await encodeFullFrames(c1, d1, total, opts));
    const got = decoded(await encodeFrames(c2, d2, total, opts));
    assertEqual(got.out.length, ref.out.length, `${name}: same frame count`);
    const bad = ref.out.findIndex((fr, i) => fr.delay !== got.out[i].delay || !fr.px.equals(got.out[i].px));
    assertEqual(bad, -1, `${name}: every frame looks the same, with the same delay`);
    return got.r;
  })();
}

const bg = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#141a2c");
  g.addColorStop(1, "#ff5a6a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

section("Changed rectangles decode the same as full frames");
{
  // A box moving across a 600×300 canvas: positions past 255 px.
  const moving = await sameAsReference("moving box", 600, 300, 12, (ctx, f) => {
    bg(ctx, 600, 300);
    ctx.fillStyle = "#3fd46c";
    ctx.fillRect(20 + f * 45, 40 + f * 18, 60, 40);
  });
  const sizes = [...Array(moving.numFrames()).keys()].slice(1).map((i) => moving.frameInfo(i));
  assertTrue(sizes.every((fi) => fi.width < 600 && fi.height < 300), "later frames hold only the changed rectangle");
  assertTrue(sizes.some((fi) => fi.x > 255), `and sit at their place, past 255 px (last at ${sizes.at(-1).x},${sizes.at(-1).y})`);

  // Frames with no change at all, then single pixels at the corners.
  await sameAsReference("no change, then corners", 300, 200, 8, (ctx, f) => {
    bg(ctx, 300, 200);
    ctx.fillStyle = "#ffffff";
    if (f === 3) ctx.fillRect(0, 0, 1, 1);
    if (f === 4) ctx.fillRect(299, 199, 1, 1);
    if (f === 5) ctx.fillRect(299, 0, 1, 1);
    if (f === 6) { ctx.fillRect(0, 199, 1, 1); ctx.fillRect(299, 0, 1, 1); }
  });

  // A colour that changes by less than the RGB565 step: same palette entry,
  // so the old encoder wrote it as unchanged too.
  await sameAsReference("same palette entry", 200, 100, 4, (ctx, f) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = f % 2 ? "#818181" : "#808080";
    ctx.fillRect(50, 20, 40, 40);
    ctx.fillStyle = "#e5483d";
    ctx.fillRect(10 + f, 10, 5, 5);
  });

  // The battle's options: a long last frame and a palette that includes a
  // middle frame (its award screen).
  await sameAsReference("battle options", 400, 260, 10, (ctx, f) => {
    bg(ctx, 400, 260);
    ctx.fillStyle = f >= 5 ? "#f5c84c" : "#4f8cff";
    ctx.beginPath();
    ctx.arc(200, 130, 30 + f * 3, 0, Math.PI * 2);
    ctx.fill();
  }, { sample: [0, 5, 9], delay: (f) => (f === 9 ? 655_350 : 100) });

  // A single frame (sample [0, 0]).
  await sameAsReference("one frame", 50, 50, 1, (ctx) => bg(ctx, 50, 50));
}

section("Cards keep their signature");
{
  const canvas = createCanvas(120, 80);
  const ctx = canvas.getContext("2d");
  const r = new GifReader(new Uint8Array(await encodeGif(canvas, (f) => { bg(ctx, 120, 80); ctx.fillStyle = "#fff"; ctx.fillRect(f * 10, 10, 8, 8); }, 6, 100)));
  assertEqual([r.numFrames(), r.frameInfo(1).delay, r.loopCount()], [6, 10, 0], "encodeGif: frames, 100 ms each, looping");
}

finish();
