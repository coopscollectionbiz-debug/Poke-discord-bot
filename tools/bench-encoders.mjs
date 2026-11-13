// ==========================================================
// tools/bench-encoders.mjs — our GIF encoder vs sharp (libvips) GIF and WebP.
//   node tools/bench-encoders.mjs <dir of .gif>   (node tools/bench-displays.mjs --out <dir>)
// Needs sharp installed (npm i --no-save sharp). Each GIF is decoded to its
// composited RGBA frames, then encoded three ways from the same frames:
//   ours       utils/render/gif.js encodeFrames (what the bot sends today)
//   sharp-gif  libvips + cgif + libimagequant
//   sharp-gif1 the same at its fastest setting (effort 1)
//   sharp-webp libwebp, animated, lossy q80 (Discord serves WebP to clients)
//   webp-lossless libwebp, animated, lossless (suits pixel art)
// Reports ms and KB for each; frame delays are kept.
// ==========================================================

import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import sharp from "sharp";
import { encodeFrames } from "../utils/render/gif.js";

const dir = path.resolve(process.argv[2] ?? ".");
const time = async (fn) => { const t = performance.now(); const out = await fn(); return [out, Math.round(performance.now() - t)]; };

/** Composited RGBA frames and their delays (ms), as a viewer sees them. */
function decode(buf) {
  const g = new GifReader(buf);
  const { width: w, height: h } = g;
  const frames = [], delays = [];
  let cur = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < g.numFrames(); i++) {
    const info = g.frameInfo(i);
    const before = info.disposal === 3 ? cur.slice() : null;
    g.decodeAndBlitFrameRGBA(i, cur);
    frames.push(cur.slice());
    delays.push(Math.min(65_535, (info.delay || 10) * 10)); // sharp caps delays at 65,535 ms
    if (info.disposal === 2) for (let y = info.y; y < info.y + info.height; y++) cur.fill(0, (y * w + info.x) * 4, (y * w + info.x + info.width) * 4);
    else if (before) cur = before;
  }
  return { w, h, frames, delays };
}

const rows = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".gif")).sort()) {
  const { w, h, frames, delays } = decode(fs.readFileSync(path.join(dir, f)));
  if (frames.length < 2) continue;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const [ours, oursMs] = await time(() => encodeFrames(canvas, (i) => ctx.putImageData(new ImageData(frames[i], w, h), 0, 0), frames.length, { delay: delays[0] }));
  const raw = Buffer.concat(frames.map((fr) => Buffer.from(fr.buffer)));
  const input = () => sharp(raw, { raw: { width: w, height: h * frames.length, channels: 4, pageHeight: h } });
  const [sg, sgMs] = await time(() => input().gif({ delay: delays, loop: 0, effort: 7 }).toBuffer());
  const [sg1, sg1Ms] = await time(() => input().gif({ delay: delays, loop: 0, effort: 1 }).toBuffer());
  const [sw, swMs] = await time(() => input().webp({ delay: delays, loop: 0, quality: 80, effort: 2 }).toBuffer());
  const [sl, slMs] = await time(() => input().webp({ delay: delays, loop: 0, lossless: true, effort: 1 }).toBuffer());
  rows.push({ image: f, frames: frames.length, px: `${w}x${h}`, oursKb: Math.round(ours.length / 1024), oursMs, sharpGifKb: Math.round(sg.length / 1024), sharpGifMs: sgMs, gif1Kb: Math.round(sg1.length / 1024), gif1Ms: sg1Ms, losslessKb: Math.round(sl.length / 1024), losslessMs: slMs, webpKb: Math.round(sw.length / 1024), webpMs: swMs });
  console.log(JSON.stringify(rows.at(-1)));
}
console.table(rows);
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`totals: ours ${sum("oursKb")} KB ${sum("oursMs")} ms · sharp gif ${sum("sharpGifKb")} KB ${sum("sharpGifMs")} ms · sharp gif effort 1 ${sum("gif1Kb")} KB ${sum("gif1Ms")} ms · webp q80 ${sum("webpKb")} KB ${sum("webpMs")} ms · webp lossless ${sum("losslessKb")} KB ${sum("losslessMs")} ms`);
