// ==========================================================
// tools/import-trainer-animations.mjs — brings real (artist-made) trainer
// animations into the bot. data/sprites/trainer-animations.json lists them:
//   "larry.png": { "from": "hayate_larry.gif", "artist": …, "source": …, … }
//
// For each entry, from a tightly cropped, transparent source GIF in --from:
//   • public/sprites/trainers_idle/<name>.gif   the animation (played as the
//     trainer's idle; tools/generate-trainer-idles.mjs keeps it as is)
//   • public/sprites/trainers_2/<name>.png      the still: the animation's
//     `still` frame (default: the last, the pose it ends on)
//   • public/sprites/trainers_2/grayscale/…     its grayscale copy (Rec. 709
//     luma, the same as the existing copies)
// The canvas is 80×80, or larger where the animation needs it (the picker and
// card renderers keep pixel scale, so a larger canvas just shows more). On the
// first import the figure is placed on the old sprite's ground line and
// centre; the placement is written back (`canvas`, `offset`) so re-runs are
// identical.
//
// Run: node tools/import-trainer-animations.mjs --from <dir>
// Then: node tools/generate-trainer-idles.mjs
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { loadImage, createCanvas, ImageData } from "@napi-rs/canvas";
import gifenc from "gifenc";

const require = createRequire(import.meta.url);
const { GifReader } = require("omggif");
const { GIFEncoder } = gifenc;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIST = path.join(ROOT, "data/sprites/trainer-animations.json");
const PNG_DIR = path.join(ROOT, "public/sprites/trainers_2");
const GIF_DIR = path.join(ROOT, "public/sprites/trainers_idle");
const MIN = 80;

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const FROM = arg("--from");
if (!FROM) throw new Error("usage: node tools/import-trainer-animations.mjs --from <dir with the source GIFs>");

const list = JSON.parse(fs.readFileSync(LIST, "utf8"));

function decodeGif(file) {
  const g = new GifReader(fs.readFileSync(file)), W = g.width, H = g.height, frames = [], delays = [];
  for (let i = 0; i < g.numFrames(); i++) {
    const px = new Uint8ClampedArray(W * H * 4); // every source frame is a full, independent frame
    g.decodeAndBlitFrameRGBA(i, px);
    frames.push(px);
    delays.push((g.frameInfo(i).delay || 10) * 10);
  }
  return { W, H, frames, delays };
}

async function rgbaOfPng(file) {
  const img = await loadImage(file), c = createCanvas(img.width, img.height), x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  return { px: x.getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height };
}

function opaqueBox(px, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function place(px, W, H, cw, ch, ox, oy) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = ((y + oy) * cw + x + ox) * 4;
    if (px[s + 3] > 0) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255; }
  }
  return out;
}

function encodeGif(frames, delays, W, H) {
  const colours = new Map();
  for (const f of frames) for (let p = 0; p < f.length; p += 4) if (f[p + 3]) { const k = (f[p] << 16) | (f[p + 1] << 8) | f[p + 2]; if (!colours.has(k)) colours.set(k, colours.size); }
  if (colours.size > 255) throw new Error(`${colours.size} colours: more than a GIF palette holds`);
  const T = colours.size, palette = [...colours.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const idx = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) idx[p] = f[p * 4 + 3] ? colours.get((f[p * 4] << 16) | (f[p * 4 + 1] << 8) | f[p * 4 + 2]) : T;
    gif.writeFrame(idx, W, H, { palette: i === 0 ? palette : undefined, delay: delays[i], transparent: true, transparentIndex: T, dispose: 2, repeat: 0 });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

function pngOf(px, W, H) {
  const c = createCanvas(W, H);
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
  return c.toBuffer("image/png");
}

/** Rec. 709 luma, alpha kept: matches the existing grayscale copies (ImageMagick -colorspace Gray). */
function grayscale(px) {
  const out = new Uint8ClampedArray(px);
  for (let p = 0; p < out.length; p += 4) { const v = Math.round(0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]); out[p] = out[p + 1] = out[p + 2] = v; }
  return out;
}

for (const [file, a] of Object.entries(list.files)) {
  const base = file.replace(/\.png$/i, "");
  const src = decodeGif(path.join(FROM, a.from));
  const box = opaqueBox(src.frames.reduce((u, f) => { for (let p = 3; p < f.length; p += 4) if (f[p]) u[p] = 255; return u; }, new Uint8ClampedArray(src.W * src.H * 4)), src.W, src.H);
  if (!box) throw new Error(`${a.from} is empty`);
  if (!a.canvas) {
    // First import: stand on the old sprite's ground line, centred where it was.
    const old = await rgbaOfPng(path.join(PNG_DIR, file));
    const ob = opaqueBox(old.px, old.W, old.H) ?? { x0: 0, x1: old.W - 1, y1: old.H - 1 };
    const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1, foot = old.H - 1 - ob.y1;
    const cw = Math.max(MIN, w), ch = Math.max(MIN, h + foot);
    const cx = Math.round((ob.x0 + ob.x1 + 1) / 2 + (cw - old.W) / 2);
    a.canvas = [cw, ch];
    a.offset = [Math.min(Math.max(cx - Math.round(w / 2), 0), cw - w) - box.x0, ch - foot - h - box.y0];
  }
  const [cw, ch] = a.canvas, [ox, oy] = a.offset;
  const frames = src.frames.map((f) => place(f, src.W, src.H, cw, ch, ox, oy));
  const still = a.still ?? frames.length - 1;
  fs.writeFileSync(path.join(GIF_DIR, `${base}.gif`), encodeGif(frames, src.delays, cw, ch));
  fs.writeFileSync(path.join(PNG_DIR, file), pngOf(frames[still], cw, ch));
  fs.writeFileSync(path.join(PNG_DIR, "grayscale", file), pngOf(grayscale(frames[still]), cw, ch));
  a.frames = frames.length;
  a.ms = Math.round(src.delays.reduce((s, d) => s + d, 0) / frames.length);
  console.log(`${file}: ${cw}×${ch}, ${frames.length} frames × ${a.ms} ms, still = frame ${still}`);
}
fs.writeFileSync(LIST, `${JSON.stringify(list, null, 1)}\n`);
