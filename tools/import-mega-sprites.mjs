// ==========================================================
// tools/import-mega-sprites.mjs — imports the audited Mega Evolution sprites
// (Phase M0) into public/sprites/pokemon/mega/{normal,shiny,grayscale}/<id>.gif
// and writes the runtime manifest data/sprites/megas.json.
//
//   • Sources come only from data/sprites/mega-source-manifest.json
//     (tools/generate-megas.mjs, built from the 2026-11-09 sprite audit).
//   • Every download must match the audited SHA-1, or the import aborts.
//   • Same pipeline as the species import (tools/lib/spriteCodec.mjs):
//     animated GIFs kept byte-for-byte (re-encoded only for disposal 3),
//     static PNGs → lossless single-frame GIFs, grayscale via BT.709 luma.
//   • Checks per file: decodes, has transparent pixels, 2D colour budget,
//     shiny differs from normal (bytes and pixels). Any failure aborts.
//   • Never touches data/sprites/sprites.json (the live species manifest).
//
// Run: npm run import:mega-sprites            (network; cached in .cache/sprites/)
//      npm run import:mega-sprites -- --offline   (rebuild the manifest from local files)
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import { gifFrames, encodeGif, toGrayscale, pngToFrames } from "./lib/spriteCodec.mjs";
import { parseCsv } from "./lib/csv.mjs";

const ROOT = new URL("..", import.meta.url);
const P = (rel) => new URL(rel, ROOT);
const SOURCE = JSON.parse(fs.readFileSync(P("data/sprites/mega-source-manifest.json"), "utf8"));
const CACHE = P(".cache/sprites/");
const OUT = P("public/sprites/pokemon/mega/");
const DIRS = { normal: new URL("normal/", OUT), shiny: new URL("shiny/", OUT), grayscale: new URL("grayscale/", OUT) };
const UA = "coopbot-sprite-import/1.0 (build tool)";
const OFFLINE = process.argv.includes("--offline");
const EXPECTED_ENTRIES = 95; // 97 records − Mega Zygarde (no sprite) − Mega Magearna Original (D-8)

const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const SOURCE_LABEL = {
  sd: "Pokémon Showdown sprites/gen5ani (Smogon BW-style sprite projects)",
  pa: "PokéAPI sprites black-white/animated (mirror of the Smogon BW-style sprite projects)",
  sds: "Pokémon Showdown sprites/gen5 (Smogon BW-style sprite projects)",
  pas: "PokéAPI sprites black-white (Smogon BW-style sprite projects)",
};

// Per-form artist/project credit from the Gen 6–9 sprite audit inventory.
const CREDITS = Object.fromEntries(
  parseCsv(fs.readFileSync(P("docs/audits/pokemon-gen6-9/pokemon-sprite-inventory.csv"), "utf8"))
    .map((r) => [r.pokemon_name, r.attribution_licensing]),
);

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

async function prepare(asset) {
  const src = await download(asset);
  if (asset.format === "GIF") {
    const g = gifFrames(src);
    if (g.disposals.includes(3)) return { src, bytes: encodeGif(g.width, g.height, g.frames), decoded: g, transformed: "re-encoded (disposal 3 removed)" };
    return { src, bytes: src, decoded: g, transformed: null };
  }
  const d = await pngToFrames(src);
  return { src, bytes: encodeGif(d.width, d.height, d.frames), decoded: d, transformed: "static PNG → single-frame GIF" };
}

/** Checks on the stored GIF; returns a description or throws. */
export function inspectStored(bytes, label) {
  const g = gifFrames(bytes);
  if (!g.frames.length) throw new Error(`${label}: no frames`);
  if (g.width < 32 || g.height < 32 || g.width > 160 || g.height > 160) throw new Error(`${label}: unexpected size ${g.width}x${g.height}`);
  const colours = new Set();
  let transparent = false;
  for (const { rgba } of g.frames) {
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] === 0) transparent = true;
      else colours.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
    }
  }
  if (!transparent) throw new Error(`${label}: no transparent pixels`);
  if (colours.size > 64) throw new Error(`${label}: ${colours.size} colours exceeds the 2D pixel-art budget`);
  return { width: g.width, height: g.height, frames: g.frames.length, colours: colours.size, firstFrameSha1: sha1(Buffer.from(g.frames[0].rgba)) };
}

async function main() {
  if (SOURCE.entries.length !== EXPECTED_ENTRIES) throw new Error(`expected ${EXPECTED_ENTRIES} entries, found ${SOURCE.entries.length}`);
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
  const forms = {};
  for (const e of SOURCE.entries) {
    if (e.normal.sha1 === e.shiny.sha1) throw new Error(`${e.id}: audited shiny equals normal`);
    // Use the audit's per-form credit only when it describes a sprite project; otherwise
    // (Mega Meowstic: the Gen 6–9 audit found only official artwork) credit the source
    // project and mark the artist as unverified rather than copying a wrong credit.
    const audited = CREDITS[SHOWDOWN_NAME(e)];
    const credit = audited && /Smogon/.test(audited) ? audited
      : `Smogon sprite projects via ${SOURCE_LABEL[e.normal.source]}; artist not listed in the audited trackers (attribution unverified)`;
    const rec = { id: e.id, species: e.species, name: e.name, credit, ...(credit === audited ? {} : { creditVerified: false }) };
    let normalDecoded = null;
    for (const v of ["normal", "shiny"]) {
      const asset = e[v];
      const file = `${v}/${e.id}.gif`;
      let prepared;
      if (OFFLINE) {
        const bytes = fs.readFileSync(new URL(file, OUT));
        const src = await download(asset); // offline: must be in the cache, SHA-1 checked
        const reencoded = asset.format === "GIF" && gifFrames(src).disposals.includes(3);
        prepared = { src, bytes, decoded: gifFrames(bytes), transformed: asset.format !== "GIF" ? "static PNG → single-frame GIF" : reencoded ? "re-encoded (disposal 3 removed)" : null };
      } else {
        prepared = await prepare(asset);
        fs.writeFileSync(new URL(file, OUT), prepared.bytes);
      }
      const info = inspectStored(prepared.bytes, `${e.id} ${v}`);
      rec[v] = {
        file, kind: info.frames > 1 ? "animated" : "static", frames: info.frames, size: `${info.width}x${info.height}`, colours: info.colours,
        fileSha1: sha1(prepared.bytes), fileSha256: sha256(prepared.bytes), firstFrameSha1: info.firstFrameSha1,
        source: SOURCE_LABEL[asset.source], sourceUrl: asset.url, sourceSha1: asset.sha1,
        ...(prepared.src && { sourceSha256: sha256(prepared.src) }),
        ...(prepared.transformed && { transformed: prepared.transformed }),
      };
      if (v === "normal") normalDecoded = prepared.decoded;
    }
    if (rec.normal.fileSha1 === rec.shiny.fileSha1 || rec.normal.firstFrameSha1 === rec.shiny.firstFrameSha1) throw new Error(`${e.id}: stored shiny matches the normal`);
    const grayFile = new URL(`grayscale/${e.id}.gif`, OUT);
    if (!OFFLINE) fs.writeFileSync(grayFile, encodeGif(normalDecoded.width, normalDecoded.height, toGrayscale(normalDecoded.frames)));
    const gray = fs.readFileSync(grayFile);
    rec.grayscale = { file: `grayscale/${e.id}.gif`, fileSha1: sha1(gray), fileSha256: sha256(gray) };
    forms[e.id] = rec;
  }
  const manifest = {
    note: "Mega Evolution sprite manifest (Phase M0): one normal, one distinct shiny and one grayscale GIF per supported Mega form, under public/sprites/pokemon/mega/. Generated by tools/import-mega-sprites.mjs; do not edit by hand. Separate from data/sprites/sprites.json (species).",
    basePath: "/public/sprites/pokemon/mega/",
    forms,
  };
  fs.writeFileSync(P("data/sprites/megas.json"), JSON.stringify(manifest, null, 1) + "\n");
  const n = Object.values(forms);
  console.log(`mega forms ${n.length}: animated normal ${n.filter((r) => r.normal.kind === "animated").length}, animated shiny ${n.filter((r) => r.shiny.kind === "animated").length}, static normal ${n.filter((r) => r.normal.kind === "static").length}`);
}

// The audit inventory is keyed by Showdown name ("Charizard-Mega-X").
const MEGAS = JSON.parse(fs.readFileSync(P("data/pokedex/megas.json"), "utf8")).forms;
const SHOWDOWN_NAME = (e) => MEGAS.find((f) => f.id === e.id)?.showdownName;

main().catch((e) => { console.error(e.message || e); process.exit(1); });
