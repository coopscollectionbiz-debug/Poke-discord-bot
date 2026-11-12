// ==========================================================
// utils/render/auraArt.js — the art for Auras that aren't tier backdrops.
//
// Each Aura with art has a folder assets/auras/<id>/ (services/auras.js
// auraArtDir; AURA_ART_DIR overrides it):
//   aura.json  { id, name, credit: [...], palette: ["#rrggbb", ...],
//                sky?: ["#rrggbb", ...]   top → bottom, the static wash
//                tint?: "#rrggbb"         the floor / accent colour (default palette[0])
//                layers: { back: "back.png", row?: "row.png", vs?: "vs.png" } }
//   back.png   a horizontal spritesheet of frames (24 at 100 ms is the card
//              loop; other counts are retimed), transparent, 1 px = 1 sprite
//              pixel, sized for the trainer card panel (90×105 cells)
//   row.png / vs.png  optional versions sized for a whole playback row / VS half
// Frame width = sheet width / frames ("frames" in aura.json, default 24).
//
// Loaded synchronously (the backdrop code is synchronous) with a small PNG
// decoder: 8-bit greyscale/RGB/RGBA/palette, non-interlaced, which is what
// every image editor exports by default. Anything else fails loudly in the
// log and the Aura falls back to Auto.
// ==========================================================

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { auraArtDir } from "../../services/auras.js";
import { getAura } from "../../catalog/auras.js";

/** Decode a PNG buffer to { width, height, data: RGBA Uint8ClampedArray }. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), kind = buf.toString("latin1", off + 4, off + 8), body = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") trns = body;
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (bit depth ${depth}, interlace ${interlace}); export 8-bit, non-interlaced`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * ch;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, s = i * ch;
    if (type === 6) { data[o] = px[s]; data[o + 1] = px[s + 1]; data[o + 2] = px[s + 2]; data[o + 3] = px[s + 3]; }
    else if (type === 2) { data[o] = px[s]; data[o + 1] = px[s + 1]; data[o + 2] = px[s + 2]; data[o + 3] = 255; }
    else if (type === 0) { data[o] = data[o + 1] = data[o + 2] = px[s]; data[o + 3] = 255; }
    else if (type === 4) { data[o] = data[o + 1] = data[o + 2] = px[s]; data[o + 3] = px[s + 1]; }
    else { const k = px[s]; data[o] = palette[k * 3]; data[o + 1] = palette[k * 3 + 1]; data[o + 2] = palette[k * 3 + 2]; data[o + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { width, height, data };
}

const HEX = /^#[0-9a-f]{6}$/i;
const toCanvas = ({ width, height, data }) => {
  const c = createCanvas(width, height);
  c.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  return c;
};

let cache = new Map();
/** The art for an Aura id, or null (no folder, or broken: logged once). Cached per folder. */
export function loadAuraArt(id, env = process.env) {
  if (getAura(id)?.look !== `art:${id}`) return null; // catalog ids only, exact case (folders are case-insensitive on Windows)
  const dir = path.join(auraArtDir(env), String(id));
  if (cache.has(dir)) return cache.get(dir);
  let art = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "aura.json"), "utf8"));
    const frames = Number.isInteger(meta.frames) && meta.frames > 0 ? meta.frames : 24;
    const layers = {};
    for (const [name, file] of Object.entries(meta.layers ?? {})) {
      if (!["back", "row", "vs"].includes(name) || typeof file !== "string" || /[\\/]/.test(file)) continue;
      const img = decodePng(fs.readFileSync(path.join(dir, file)));
      const fw = Math.floor(img.width / frames);
      if (fw < 1) throw new Error(`${file}: narrower than ${frames} frames`);
      layers[name] = { sheet: toCanvas(img), fw, fh: img.height, n: frames };
    }
    if (!layers.back) throw new Error("aura.json has no back layer");
    const sky = Array.isArray(meta.sky) && meta.sky.length >= 2 && meta.sky.every((h) => HEX.test(h)) ? meta.sky : null;
    const tint = HEX.test(meta.tint ?? "") ? meta.tint : Array.isArray(meta.palette) && HEX.test(meta.palette[0] ?? "") ? meta.palette[0] : null;
    art = { id: String(id), sky, tint, layers };
  } catch (err) {
    if (err?.code !== "ENOENT") console.warn(`⚠️ Aura art ${id}: ${err?.message || err}`);
  }
  cache.set(dir, art);
  return art;
}
export const resetAuraArtForTesting = () => { cache = new Map(); };
