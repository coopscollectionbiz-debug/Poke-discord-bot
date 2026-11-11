// ==========================================================
// tools/dev/visual-compare.mjs — compares two visual-regression.mjs runs.
//
//   node tools/dev/visual-compare.mjs <dirA> <dirB>
//
// For every file in dirA: identical bytes → "same"; otherwise both images
// are decoded (PNG via @napi-rs/canvas; GIF: every frame composited with
// omggif) and compared pixel by pixel → "pixel-identical" or the number of
// differing pixels. Exit code 1 when any image differs in pixels or is
// missing.
// ==========================================================

import fs from "fs";
import path from "path";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { GifReader } from "omggif";

const [dirA, dirB] = process.argv.slice(2).map((d) => path.resolve(d));

async function frames(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 3).toString() === "GIF") {
    const gif = new GifReader(buf);
    const out = [];
    const px = new Uint8ClampedArray(gif.width * gif.height * 4);
    for (let i = 0; i < gif.numFrames(); i++) {
      gif.decodeAndBlitFrameRGBA(i, px);
      out.push(Uint8ClampedArray.from(px));
    }
    return { w: gif.width, h: gif.height, frames: out };
  }
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return { w: img.width, h: img.height, frames: [c.getContext("2d").getImageData(0, 0, img.width, img.height).data] };
}

const report = {};
let bad = 0;
for (const name of fs.readdirSync(dirA).sort()) {
  const a = path.join(dirA, name), b = path.join(dirB, name);
  if (!fs.existsSync(b)) { report[name] = "missing"; bad++; continue; }
  if (fs.readFileSync(a).equals(fs.readFileSync(b))) { report[name] = "same bytes"; continue; }
  const [fa, fb] = await Promise.all([frames(a), frames(b)]);
  if (fa.w !== fb.w || fa.h !== fb.h || fa.frames.length !== fb.frames.length) {
    report[name] = `different size/frames (${fa.w}x${fa.h}×${fa.frames.length} vs ${fb.w}x${fb.h}×${fb.frames.length})`;
    bad++;
    continue;
  }
  let diff = 0;
  fa.frames.forEach((f, i) => { for (let p = 0; p < f.length; p += 4) if (f[p] !== fb.frames[i][p] || f[p + 1] !== fb.frames[i][p + 1] || f[p + 2] !== fb.frames[i][p + 2] || f[p + 3] !== fb.frames[i][p + 3]) diff++; });
  report[name] = diff ? `${diff} pixels differ` : "pixel-identical";
  if (diff) bad++;
}
console.log(JSON.stringify({ a: dirA, b: dirB, files: Object.keys(report).length, differing: bad, report }, null, 1));
process.exit(bad ? 1 : 0);
