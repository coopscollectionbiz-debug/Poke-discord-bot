// ==========================================================
// tools/render-diff.mjs — how different two renders of the same images look.
//   node tools/render-golden.mjs a.json --save dirA   (before)
//   node tools/render-golden.mjs b.json --save dirB   (after)
//   node tools/render-diff.mjs dirA dirB
// For each image in both folders, decodes every frame as a viewer sees it
// and reports the largest per-channel difference (0–255), the share of
// pixels that differ at all, and the share that differ by more than 8
// (about what an eye can pick out on a flat colour).
// ==========================================================
import fs from "fs";
import path from "path";
import { GifReader } from "omggif";
import { loadImage, createCanvas } from "@napi-rs/canvas";

async function frames(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 3).toString() === "GIF") {
    const g = new GifReader(buf);
    const px = new Uint8Array(g.width * g.height * 4);
    const out = [];
    for (let i = 0; i < g.numFrames(); i++) { g.decodeAndBlitFrameRGBA(i, px); out.push(px.slice()); }
    return out;
  }
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return [c.getContext("2d").getImageData(0, 0, img.width, img.height).data];
}

const [a, b] = process.argv.slice(2).map((d) => path.resolve(d));
const rows = [];
for (const f of fs.readdirSync(a).filter((f) => fs.existsSync(path.join(b, f))).sort()) {
  const [fa, fb] = await Promise.all([frames(path.join(a, f)), frames(path.join(b, f))]);
  if (fa.length !== fb.length) { rows.push({ image: f, note: `frame count ${fa.length} → ${fb.length}` }); continue; }
  let max = 0, diff = 0, big = 0, total = 0;
  for (let k = 0; k < fa.length; k++) {
    const x = fa[k], y = fb[k];
    for (let i = 0; i < x.length; i += 4) {
      const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
      total++;
      if (d) { diff++; if (d > max) max = d; if (d > 8) big++; }
    }
  }
  rows.push({ image: f, frames: fa.length, maxDelta: max, changedPct: +((100 * diff) / total).toFixed(3), over8Pct: +((100 * big) / total).toFixed(4) });
}
console.table(rows);
