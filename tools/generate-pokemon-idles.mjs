// ==========================================================
// tools/generate-pokemon-idles.mjs — the rig idle for every STATIC Pokémon
// sprite (species in data/sprites/sprites.json, Mega forms in
// data/sprites/megas.json). Animated sprites are never touched.
//
// The rig (utils/spriteRig.js) is modelled on the hand-animated Gen 5
// sprites. Each Pokémon gets its own seeded performance: a squash of up to
// 3 px above the reviewed low cut (utils/spriteBreathing.js pokemonCuts), a
// 1 px head lean, the ear/crest band dragging behind, and a rest with the
// closed-lid blink where data/sprites/pokemon-blinks.json lists eyes. No cut
// crosses a face. It's baked into the sprite's own GIF at its existing path,
// so embeds, the dashboard, rendered cards and battles all animate with no
// per-surface code. Frame 0 is the untouched sprite (first-frame hashes and
// colour budgets are unchanged); only the sprite's own pixels are used.
//
// Rules
//   • normal and shiny move together or not at all (a shiny is the same
//     drawing recoloured; a mismatch would look like a glitch);
//   • grayscale (dashboard "not owned") is rebuilt from the normal's frames;
//   • review gate: seam ≤ SEAM_OK (11, as calibrated for trainers) → ok;
//     larger → "review" (stays still) until listed in
//     data/sprites/pokemon-idle-review.json "approved"; anything listed in
//     "excluded", or too small / no cut lines, stays still.
//   • one set of cut lines (the normal sprite's) drives normal, shiny and
//     grayscale, so all three move in step;
//   • the record keeps kind "static" (the art is static) and gains
//     motion: "rig", frames and the new file hashes.
//
// Run after import-sprites / import-mega-sprites:
//   node tools/generate-pokemon-idles.mjs           (write)
//   node tools/generate-pokemon-idles.mjs --check   (verify only; exit 1 if stale)
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import omggif from "omggif";
import gifenc from "gifenc";
import { pokemonCuts, blinkEyes } from "../utils/spriteBreathing.js";
import { rigCuts, rigPose, rigPlan } from "../utils/spriteRig.js";

const { GIFEncoder } = gifenc;
const ROOT = new URL("..", import.meta.url);
const P = (rel) => new URL(rel, ROOT);
const CHECK = process.argv.includes("--check");
export const SEAM_OK = 11;
export const MIN_HEIGHT = 20; // Pokémon are often smaller than trainers (80 px); below this a 1 px breath reads as jitter

const SPECIES_MANIFEST = P("data/sprites/sprites.json");
const MEGA_MANIFEST = P("data/sprites/megas.json");
const REVIEW = P("data/sprites/pokemon-idle-review.json");
const REPORT = P("data/sprites/pokemon-idle-report.json");
const BLINKS = P("data/sprites/pokemon-blinks.json");
const species = JSON.parse(fs.readFileSync(SPECIES_MANIFEST, "utf8"));
const megas = JSON.parse(fs.readFileSync(MEGA_MANIFEST, "utf8"));
const review = fs.existsSync(REVIEW) ? JSON.parse(fs.readFileSync(REVIEW, "utf8")) : { approved: [], excluded: {} };
const approved = new Set(review.approved ?? []);
const excluded = review.excluded ?? {};
const blinks = JSON.parse(fs.readFileSync(BLINKS, "utf8")).blinks;
// Face rows no breath cut may cross: hand-placed for faces low in the body,
// and from the blink eyes (2 rows above to 6 below, for the mouth).
const faces = { ...Object.fromEntries(Object.entries(blinks).map(([k, eyes]) => [k, [Math.min(...eyes.map((e) => e[1])) - 2, Math.max(...eyes.map((e) => e[3])) + 6]])), ...(review.faces ?? {}) };

const sha = (alg, buf) => crypto.createHash(alg).update(buf).digest("hex");
const luma709 = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

/** Frame 0 RGBA of a GIF (the still sprite, also the rest pose of a breathing GIF). */
function stillFrame(buf) {
  const g = new omggif.GifReader(new Uint8Array(buf));
  const px = new Uint8ClampedArray(g.width * g.height * 4);
  g.decodeAndBlitFrameRGBA(0, px);
  return { px, W: g.width, H: g.height, frames: g.numFrames() };
}

/** Lossless GIF of full RGBA frames (binary alpha, ≤ 255 colours across all frames). */
function encode(W, H, frames) {
  const colors = new Map();
  const palette = [[0, 0, 0]]; // 0 = transparent
  const indexed = frames.map(({ px }) => {
    const idx = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
      if (px[p * 4 + 3] < 128) continue;
      const key = (px[p * 4] << 16) | (px[p * 4 + 1] << 8) | px[p * 4 + 2];
      let k = colors.get(key);
      if (k === undefined) {
        if (palette.length >= 256) throw new Error("more than 255 colours; refusing a lossy encode");
        k = palette.length; colors.set(key, k); palette.push([px[p * 4], px[p * 4 + 1], px[p * 4 + 2]]);
      }
      idx[p] = k;
    }
    return idx;
  });
  while (palette.length < 2) palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  indexed.forEach((idx, i) => gif.writeFrame(idx, W, H, { palette, delay: frames[i].ms, transparent: true, transparentIndex: 0, dispose: 2, repeat: 0 }));
  gif.finish();
  return Buffer.from(gif.bytes());
}

/**
 * The rig idle's frames for one variant: the shared cuts and plan, eyes
 * closed on blink frames. Neighbouring frames that come out identical are
 * merged (their delays add up).
 */
function loopFrames(plan, rc, px, W, H, eyes) {
  const shut = eyes ? blinkEyes(px, W, H, eyes) : null;
  const out = [];
  for (const f of plan.frames) {
    const img = rigPose(f.blink ? shut : px, W, H, rc, f);
    const last = out.at(-1);
    if (last && Buffer.compare(Buffer.from(last.px.buffer), Buffer.from(img.buffer)) === 0) last.ms += plan.ms;
    else out.push({ px: img, ms: plan.ms });
  }
  return out;
}
const gray = (px) => {
  const out = new Uint8ClampedArray(px);
  for (let p = 0; p < out.length; p += 4) out[p] = out[p + 1] = out[p + 2] = luma709(out[p], out[p + 1], out[p + 2]);
  return out;
};

/** Every static sprite pair: { key, label, dir, rec, writeRec(new fields) }. */
function targets() {
  const out = [];
  for (const [id, rec] of Object.entries(species.species)) {
    if (rec.normal?.kind !== "static" && rec.shiny?.kind !== "static") continue;
    out.push({ key: `species:${id}`, label: `#${id} ${rec.name}`, base: "public/sprites/pokemon/", rec, sha256: false });
  }
  for (const [id, rec] of Object.entries(megas.forms)) {
    if (rec.normal?.kind !== "static" && rec.shiny?.kind !== "static") continue;
    out.push({ key: `mega:${id}`, label: rec.name, base: "public/sprites/pokemon/mega/", rec, sha256: true });
  }
  return out;
}

const report = { generatedBy: "tools/generate-pokemon-idles.mjs", seamOk: SEAM_OK, minHeight: MIN_HEIGHT, breathing: 0, blinking: 0, still: 0, review: [], excluded: [], stale: [], rigs: {} };
const writes = [];

for (const t of targets()) {
  const variants = ["normal", "shiny"].filter((v) => t.rec[v]?.kind === "static");
  const src = {};
  for (const v of variants) src[v] = stillFrame(fs.readFileSync(P(t.base + t.rec[v].file)));
  const results = {};
  let verdict = "ok", reason = null, seam = 0;
  for (const v of variants) {
    const c = pokemonCuts(src[v].px, src[v].W, src[v].H, { minHeight: MIN_HEIGHT, face: faces[t.key] ?? null });
    const r = c && { cuts: c };
    results[v] = r;
    if (!r) { verdict = "excluded"; reason = "too small or no cut lines"; continue; }
    seam = Math.max(seam, r.cuts.seam);
  }
  if (excluded[t.key]) { verdict = "excluded"; reason = excluded[t.key]; }
  else if (verdict === "ok" && seam > SEAM_OK && !approved.has(t.key)) verdict = "review";
  if (verdict === "review") report.review.push({ key: t.key, label: t.label, seam, cuts: Object.fromEntries(variants.map((v) => [v, results[v] && { waist: results[v].cuts.waist, neck: results[v].cuts.neck, seam: results[v].cuts.seam }])) });
  if (verdict === "excluded") report.excluded.push({ key: t.key, label: t.label, reason });

  const breathe = verdict === "ok";
  const set = (v, bytes, frames) => {
    const rec = t.rec[v];
    const next = { ...rec, frames, fileSha1: sha("sha1", bytes), ...(t.sha256 && { fileSha256: sha("sha256", bytes) }) };
    if (breathe && v !== "grayscale") next.motion = "rig"; else delete next.motion;
    if (v === "grayscale") { delete next.frames; if (breathe) next.motion = "rig"; }
    writes.push({ file: P(t.base + rec.file), bytes, apply: () => { t.rec[v] = next; } });
  };
  // One rig (cuts + plan, from the normal sprite when it is static) drives normal, shiny and grayscale.
  const lead = src[variants[0]];
  const rc = breathe ? rigCuts(lead.px, lead.W, lead.H, { face: faces[t.key] ?? null, eyes: blinks[t.key] ?? null, minHeight: MIN_HEIGHT, off: review.rigOff?.[t.key] }) : null;
  const eyes = breathe ? blinks[t.key] ?? null : null;
  const plan = breathe ? rigPlan(t.key, rc, { blink: !!eyes }) : null;
  if (eyes) report.blinking++;
  if (rc) report.rigs[t.key] = { drops: rc.drops, head: rc.head, headCost: rc.headCost, ears: rc.ears, earCost: rc.earCost, ms: plan.ms, frames: plan.frames.length };
  for (const v of variants) {
    const frames = breathe ? loopFrames(plan, rc, src[v].px, src[v].W, src[v].H, eyes) : [{ px: src[v].px, ms: 0 }];
    set(v, encode(src[v].W, src[v].H, frames), frames.length);
  }
  // Grayscale follows the normal sprite whenever the normal is static.
  if (variants.includes("normal") && t.rec.grayscale?.file) {
    const frames = breathe ? loopFrames(plan, rc, src.normal.px, src.normal.W, src.normal.H, eyes).map((f) => ({ ...f, px: gray(f.px) })) : [{ px: gray(src.normal.px), ms: 0 }];
    set("grayscale", encode(src.normal.W, src.normal.H, frames), frames.length);
  }
  if (breathe) report.breathing++; else report.still++;
}

// Apply (or check).
for (const w of writes) {
  const cur = fs.existsSync(w.file) ? fs.readFileSync(w.file) : null;
  if (!cur || !cur.equals(w.bytes)) report.stale.push(w.file.pathname.replace(/^.*public\//, "public/"));
  if (!CHECK) { fs.writeFileSync(w.file, w.bytes); w.apply(); }
}
if (CHECK) {
  if (report.stale.length) { console.error(`❌ ${report.stale.length} sprite file(s) out of date, e.g. ${report.stale.slice(0, 3).join(", ")}`); process.exit(1); }
  console.log(`✅ Pokémon idles up to date (${report.breathing} breathing, ${report.blinking} of them blinking, ${report.still} still).`);
  process.exit(0);
}
fs.writeFileSync(SPECIES_MANIFEST, JSON.stringify(species, null, 1) + "\n");
fs.writeFileSync(MEGA_MANIFEST, JSON.stringify(megas, null, 1) + "\n");
const { stale, ...persist } = report;
fs.writeFileSync(REPORT, JSON.stringify(persist, null, 1) + "\n");
console.log(`breathing ${report.breathing} (blinking ${report.blinking}), still ${report.still} (review ${report.review.length}, excluded ${report.excluded.length}); ${stale.length} file(s) written`);
