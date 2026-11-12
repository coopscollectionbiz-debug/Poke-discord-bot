// ==========================================================
// tools/generate-trainer-idles.mjs — the breathing idle GIF for every
// selectable trainer sprite (public/sprites/trainers_idle/<name>.gif), plus
// the manifest the bot reads (data/sprites/trainer-idles.json) and a compact
// copy for the web pages (public/sprites/trainers_idle/manifest.json).
//
// Review gate (utils/trainerIdle.js measures the "seam"):
//   seam ≤ SEAM_OK (11)      → ok
//   seam > SEAM_OK           → "review" until listed as approved in
//                              data/sprites/trainer-idle-review.json
//   listed as excluded, or no cut lines (too short / no rows) → excluded
// Only "ok" sprites get a GIF; everything else stays a static PNG.
// Sprites in data/sprites/trainer-animations.json have a real, artist-made
// animation instead (tools/import-trainer-animations.mjs): listed as
// { status: "ok", animation: "real" } and their GIF is never rewritten here.
//
// Run: node tools/generate-trainer-idles.mjs [--check]
//   --check  verify GIFs and manifests are up to date, write nothing
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
import { breathingPoses, stepCount } from "../utils/trainerIdle.js";
import { motionStates, idleTimeline, poseOf } from "../utils/trainerMotion.js";

const { GIFEncoder, quantize, applyPalette } = gifenc;
let quantised = 0; // sprites with > 255 colours (GIF palette quantised)
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "public/sprites/trainers_2");
const OUT = path.join(ROOT, "public/sprites/trainers_idle");
const MANIFEST = path.join(ROOT, "data/sprites/trainer-idles.json");
const WEB_MANIFEST = path.join(OUT, "manifest.json");
const REVIEW = path.join(ROOT, "data/sprites/trainer-idle-review.json");
// Calibrated 2026-11-10: every reviewed sprite with seam 9–28 looked clean;
// 9–11 were sampled (35), 12+ were each reviewed and listed as approved.
export const SEAM_OK = 11;
const CHECK = process.argv.includes("--check");

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "trainerSprites.json"), "utf8"));
const review = fs.existsSync(REVIEW) ? JSON.parse(fs.readFileSync(REVIEW, "utf8")) : { approved: [], excluded: {} };
const approved = new Set(review.approved ?? []);
// Part motions (salutes, waves, held Poké Balls, capes): reviewed data.
const PARTS = path.join(ROOT, "data/sprites/trainer-parts.json");
const parts = fs.existsSync(PARTS) ? JSON.parse(fs.readFileSync(PARTS, "utf8")).sprites ?? {} : {};
const excluded = review.excluded ?? {};
// Real animations (data/sprites/trainer-animations.json): their GIF is kept as is.
const ANIMATIONS = path.join(ROOT, "data/sprites/trainer-animations.json");
const animations = fs.existsSync(ANIMATIONS) ? JSON.parse(fs.readFileSync(ANIMATIONS, "utf8")).files ?? {} : {};

// Selectable sprite files (disabled entries are never shown to players).
const files = new Set();
for (const entry of Object.values(registry)) for (const s of entry.sprites ?? []) {
  if (typeof s === "string") files.add(s);
  else if (s?.file && !s.disabled) files.add(s.file);
}

/**
 * Palette-index the poses. Exact when the sprite has ≤ 255 colours (almost
 * all do, so frame 0 is pixel-identical to the PNG); otherwise a 255-colour
 * palette quantised from the sprite's own pixels. Transparent pixels get
 * index 255 here and are remapped to the transparent slot by the caller.
 */
function indexPoses(poses, W, H) {
  const colors = new Map(); // rgb → index
  const palette = [];
  for (const px of poses) for (let p = 0; p < W * H * 4; p += 4) {
    if (px[p + 3] < 128) continue;
    const key = (px[p] << 16) | (px[p + 1] << 8) | px[p + 2];
    if (!colors.has(key)) { colors.set(key, palette.length); palette.push([px[p], px[p + 1], px[p + 2]]); }
  }
  if (palette.length <= 255) {
    const indexed = poses.map((px) => {
      const idx = new Uint8Array(W * H);
      for (let i = 0, p = 0; i < W * H; i++, p += 4) idx[i] = px[p + 3] < 128 ? 255 : colors.get((px[p] << 16) | (px[p + 1] << 8) | px[p + 2]);
      return idx;
    });
    return { palette, indexed, exact: true };
  }
  // Too many colours for a GIF: quantise from the opaque pixels of all poses.
  const opaque = [];
  for (const px of poses) for (let p = 0; p < W * H * 4; p += 4) if (px[p + 3] >= 128) opaque.push(px[p], px[p + 1], px[p + 2], 255);
  const q = quantize(new Uint8Array(opaque), 255, { format: "rgb565" }).map((c) => c.slice(0, 3));
  const indexed = poses.map((px) => {
    const idx = applyPalette(px, q, "rgb565");
    for (let i = 0, p = 3; i < W * H; i++, p += 4) if (px[p] < 128) idx[i] = 255;
    return idx;
  });
  return { palette: q, indexed, exact: false };
}

/**
 * GIF of the idle loop: the trainer's own timeline (utils/trainerMotion.js:
 * tempo, phase and part events), infinite loop, 1-bit transparency.
 */
function encodeIdle(frames, delays, W, H) {
  const { palette, indexed, exact } = indexPoses(frames, W, H);
  if (!exact) quantised++;
  const T = palette.length; // transparent index = first free slot
  const pal = [...palette, [0, 0, 0]];
  while (pal.length < 2 || (pal.length & (pal.length - 1))) pal.push([0, 0, 0]); // power of two
  for (const idx of indexed) for (let i = 0; i < idx.length; i++) if (idx[i] === 255 && T !== 255) idx[i] = T;
  const gif = GIFEncoder();
  indexed.forEach((idx, k) => {
    gif.writeFrame(idx, W, H, { palette: k === 0 ? pal : undefined, delay: delays[k], transparent: true, transparentIndex: T, dispose: 2, repeat: 0 });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** The trainer's idle frames and delays: breathing + offsets + its part events. */
function idleFrames(file, px, W, H, cuts) {
  const events = parts[file]?.events ?? [];
  const m = motionStates(px, W, H, events);
  const steps = idleTimeline(file, events, stepCount(cuts));
  return { frames: steps.map((s) => poseOf(m.states[s.state], W, cuts, s.pose)), delays: steps.map((s) => s.ms), events: events.length };
}

async function rgbaOf(file) {
  const img = await loadImage(path.join(SRC, file));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return { px: c.getContext("2d").getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height };
}

const manifest = {};
const web = {};
const counts = { ok: 0, review: 0, excluded: 0, real: 0 };
const stale = [];
const missing = []; // real-animation GIFs listed but not on disk
for (const file of [...files].sort()) {
  if (!fs.existsSync(path.join(SRC, file))) continue;
  const base = file.replace(/\.png$/i, "");
  let rec;
  if (animations[file]) {
    // A real (artist-made) animation replaces the generated breathing. Its GIF
    // is the source file (tools/import-trainer-animations.mjs); never rewritten here.
    const a = animations[file];
    rec = { status: "ok", animation: "real", gif: `${base}.gif`, frames: a.frames, ms: a.ms, ...(a.still != null && a.still !== a.frames - 1 ? { still: a.still } : {}) };
    if (!fs.existsSync(path.join(OUT, rec.gif))) missing.push(rec.gif);
    web[file] = rec.gif;
    counts.real++;
  } else if (excluded[file]) rec = { status: "excluded", reason: excluded[file] };
  else {
    const { px, W, H } = await rgbaOf(file);
    const b = breathingPoses(px, W, H);
    if (!b) rec = { status: "excluded", reason: "no usable cut lines (too short or empty)" };
    else {
      const { seam, waist, neck } = b.cuts;
      rec = seam <= SEAM_OK || approved.has(file) ? { status: "ok", seam, waist, neck, gif: `${base}.gif` } : { status: "review", seam, waist, neck };
      if (rec.status === "ok") {
        const { frames, delays, events } = idleFrames(file, px, W, H, b.cuts);
        if (events) rec.parts = events;
        const buf = encodeIdle(frames, delays, W, H);
        const out = path.join(OUT, rec.gif);
        const same = fs.existsSync(out) && fs.readFileSync(out).equals(buf);
        if (!same) {
          if (CHECK) stale.push(rec.gif);
          else { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(out, buf); }
        }
        web[file] = rec.gif;
      }
    }
  }
  counts[rec.status]++;
  manifest[file] = rec;
}

// GIFs whose sprite is no longer "ok".
const keep = new Set(Object.values(web));
const orphans = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.endsWith(".gif") && !keep.has(f)) : [];

// One line per sprite, so diffs stay readable.
const manifestText = `{"seamOk":${SEAM_OK},"loop":"per trainer (utils/trainerMotion.js idleTimeline)","files":{\n${Object.entries(manifest)
  .map(([f, r]) => `${JSON.stringify(f)}:${JSON.stringify(r)}`)
  .join(",\n")}\n}}\n`;
const webText = JSON.stringify(web) + "\n";
if (CHECK) {
  // Line endings normalised: git may check JSON out with CRLF on Windows.
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n") : "");
  const problems = [
    ...stale.map((f) => `stale GIF ${f}`),
    ...missing.map((f) => `missing real animation ${f} (tools/import-trainer-animations.mjs)`),
    ...orphans.map((f) => `orphan GIF ${f}`),
    ...(read(MANIFEST) !== manifestText ? ["data/sprites/trainer-idles.json is out of date"] : []),
    ...(read(WEB_MANIFEST) !== webText ? ["public/sprites/trainers_idle/manifest.json is out of date"] : []),
  ];
  console.log(problems.length ? problems.join("\n") : "trainer idles up to date");
  process.exit(problems.length ? 1 : 0);
}
if (missing.length) throw new Error(`missing real animation GIFs: ${missing.join(", ")} — run tools/import-trainer-animations.mjs`);
for (const f of orphans) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(MANIFEST, manifestText);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(WEB_MANIFEST, webText);
console.log(`trainer idles: ${counts.ok} ok (${counts.real} of them real animations), ${counts.review} awaiting review, ${counts.excluded} excluded (${files.size} selectable files); removed ${orphans.length} orphan GIFs; ${quantised} quantised (> 255 colours)`);
if (counts.review) console.log("review:", Object.entries(manifest).filter(([, r]) => r.status === "review").map(([f, r]) => `${f}(${r.seam})`).join(" "));
