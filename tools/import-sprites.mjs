// ==========================================================
// tools/import-sprites.mjs
// Imports the Gen 6–9 species sprites listed in
// data/sprites/source-manifest.json (the verified output of the Gen 6–9
// sprite audit) into public/sprites/pokemon/, and writes the runtime
// manifest data/sprites/sprites.json for all 1,025 species.
//
//   • Every download must match the audited SHA-1, or the import aborts.
//   • Animated GIFs are copied byte-for-byte (re-encoded only if a frame
//     uses GIF disposal 3, which the battle renderer does not support).
//   • Static PNGs become lossless single-frame GIFs, so every sprite keeps
//     the `<id>.gif` path the bot and dashboard already use.
//   • Grayscale copies (dashboard "not owned" cards) use BT.709 luma,
//     matching the existing Gen 1–5 grayscale sprites.
//   • 3D sources are never eligible: the manifest only holds sprites that
//     passed the audit's 2D pixel-art check.
//
// Run: npm run import:sprites      (network; downloads are cached in .cache/)
//      npm run import:sprites -- --offline   (rebuild sprites.json from local files only)
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import omggif from "omggif";
import gifenc from "gifenc";
const { GIFEncoder } = gifenc;
import { createCanvas, loadImage } from "@napi-rs/canvas";

const ROOT = new URL("..", import.meta.url);
const P = (rel) => new URL(rel, ROOT);
const SOURCE = JSON.parse(fs.readFileSync(P("data/sprites/source-manifest.json"), "utf8"));
const POKEMON = JSON.parse(fs.readFileSync(P("pokemonData.json"), "utf8"));
const CACHE = P(".cache/sprites/");
const OUT_DIR = { normal: P("public/sprites/pokemon/normal/"), shiny: P("public/sprites/pokemon/shiny/"), grayscale: P("public/sprites/pokemon/grayscale/") };
const UA = "coopbot-sprite-import/1.0 (build tool)";
const OFFLINE = process.argv.includes("--offline");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const SOURCE_LABEL = {
  sd: "Pokémon Showdown sprites/gen5ani (Smogon BW-style sprite projects)",
  pa: "PokéAPI sprites black-white/animated (mirror of the Smogon BW-style sprite projects)",
  sm: "Smogon sprite project tracker attachment",
  sds: "Pokémon Showdown sprites/gen5 (Smogon BW-style sprite projects)",
  pas: "PokéAPI sprites black-white (Smogon BW-style sprite projects)",
};

async function download(asset) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = new URL(asset.sha1, CACHE);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    if (sha1(buf) === asset.sha1) return buf;
  }
  if (OFFLINE) throw new Error(`offline and not cached: ${asset.url}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(asset.url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha1(buf) !== asset.sha1) throw new Error(`SHA-1 mismatch for ${asset.url}: got ${sha1(buf)}, audited ${asset.sha1}`);
      fs.writeFileSync(file, buf);
      return buf;
    }
    if (res.status === 404) break;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  throw new Error(`download failed: ${asset.url}`);
}

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
function toGrayscale(frames) {
  return frames.map(({ rgba, delayMs }) => {
    const out = new Uint8ClampedArray(rgba);
    for (let p = 0; p < out.length; p += 4) {
      const l = luma709(out[p], out[p + 1], out[p + 2]);
      out[p] = out[p + 1] = out[p + 2] = l;
    }
    return { rgba: out, delayMs };
  });
}

async function pngToFrames(buf) {
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  for (let p = 3; p < data.length; p += 4) data[p] = data[p] >= 128 ? 255 : 0; // binary alpha, as GIF requires
  return { width: img.width, height: img.height, frames: [{ rgba: new Uint8ClampedArray(data), delayMs: 0 }] };
}

/** Bytes to store for one variant, plus the decoded frames for grayscale. */
async function prepare(asset) {
  const src = await download(asset);
  if (asset.format === "GIF") {
    const g = gifFrames(src);
    if (g.disposals.includes(3)) return { bytes: encodeGif(g.width, g.height, g.frames), decoded: g, transformed: "re-encoded (disposal 3 removed)" };
    return { bytes: src, decoded: g, transformed: null };
  }
  const d = await pngToFrames(src);
  return { bytes: encodeGif(d.width, d.height, d.frames), decoded: d, transformed: "static PNG → single-frame GIF" };
}

function describe(asset, bytes, decoded, transformed, file) {
  return {
    file, kind: asset.kind, frames: decoded.frames.length, size: `${decoded.width}x${decoded.height}`, fileSha1: sha1(bytes),
    source: SOURCE_LABEL[asset.source], sourceUrl: asset.url, sourceSha1: asset.sha1, ...(transformed && { transformed }),
  };
}

async function main() {
  const entries = SOURCE.entries.filter((e) => e.kind === "species");
  if (entries.length !== 376) throw new Error(`expected 376 species in the source manifest, found ${entries.length}`);
  const out = {};
  // Gen 1–5: the sprites already in the repository (official Black/White sprites via PokéAPI).
  for (let id = 1; id <= 649; id++) {
    const rec = { dex: id, name: POKEMON[id].name };
    for (const v of ["normal", "shiny"]) {
      const file = `${v}/${id}.gif`;
      const bytes = fs.readFileSync(new URL(file, P("public/sprites/pokemon/")));
      const g = gifFrames(bytes);
      rec[v] = { file, kind: g.frames.length > 1 ? "animated" : "static", frames: g.frames.length, size: `${g.width}x${g.height}`, fileSha1: sha1(bytes),
        source: "PokéAPI sprites black-white/animated (official Pokémon Black/White sprites)" };
    }
    rec.grayscale = { file: `grayscale/${id}.gif`, fileSha1: sha1(fs.readFileSync(P(`public/sprites/pokemon/grayscale/${id}.gif`))) };
    out[id] = rec;
  }
  let done = 0;
  for (const e of entries) {
    if (!e.normal || !e.shiny) throw new Error(`#${e.dex} ${e.name}: manifest lacks a normal or shiny sprite`);
    if (e.normal.sha1 === e.shiny.sha1) throw new Error(`#${e.dex} ${e.name}: shiny is identical to normal`);
    const rec = { dex: e.dex, name: POKEMON[e.dex].name, credit: e.credit };
    const decodedNormal = {};
    for (const v of ["normal", "shiny"]) {
      const asset = e[v];
      const file = `${v}/${e.dex}.gif`;
      let prepared;
      if (OFFLINE) {
        const bytes = fs.readFileSync(new URL(file, P("public/sprites/pokemon/")));
        prepared = { bytes, decoded: gifFrames(bytes), transformed: asset.format === "GIF" ? null : "static PNG → single-frame GIF" };
      } else {
        prepared = await prepare(asset);
        fs.writeFileSync(new URL(`${e.dex}.gif`, OUT_DIR[v]), prepared.bytes);
      }
      rec[v] = describe(asset, prepared.bytes, prepared.decoded, prepared.transformed, file);
      if (v === "normal") Object.assign(decodedNormal, prepared.decoded);
    }
    if (rec.normal.fileSha1 === rec.shiny.fileSha1) throw new Error(`#${e.dex}: stored shiny equals stored normal`);
    const grayFile = new URL(`${e.dex}.gif`, OUT_DIR.grayscale);
    if (!OFFLINE) fs.writeFileSync(grayFile, encodeGif(decodedNormal.width, decodedNormal.height, toGrayscale(decodedNormal.frames)));
    rec.grayscale = { file: `grayscale/${e.dex}.gif`, fileSha1: sha1(fs.readFileSync(grayFile)) };
    out[e.dex] = rec;
    if (++done % 50 === 0) console.log(`  ${done}/376`);
  }
  const manifest = {
    note: "Runtime sprite manifest: one normal, one distinct shiny and one grayscale GIF per species. Generated by tools/import-sprites.mjs from data/sprites/source-manifest.json; do not edit by hand.",
    species: out,
  };
  fs.writeFileSync(P("data/sprites/sprites.json"), JSON.stringify(manifest, null, 1) + "\n");
  const counts = { animated: 0, static: 0, shinyAnimated: 0, shinyStatic: 0 };
  for (const r of Object.values(out)) { counts[r.normal.kind]++; counts[r.shiny.kind === "animated" ? "shinyAnimated" : "shinyStatic"]++; }
  console.log(`species ${Object.keys(out).length}`, counts);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
