// ==========================================================
// tools/detect-trainer-parts.mjs — proposes part-motion candidates for the
// trainer idle (utils/trainerMotion.js). It only PROPOSES: every candidate is
// reviewed by eye before it goes into data/sprites/trainer-parts.json.
//
//   • Poké Ball held in hand → a 1-px "bob" (lift and settle)
//   • raised hand (skin-coloured, above the shoulders, sticking out into
//     empty space, clear of the face) → a 1-px wave (left, right, left)
//
// Run: node tools/detect-trainer-parts.mjs <out.json>
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { idleCuts } from "../utils/trainerIdle.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "public/sprites/trainers_2");
const out = process.argv[2];
if (!out) { console.error("usage: node tools/detect-trainer-parts.mjs <out.json>"); process.exit(1); }

const W = 80, H = 80;
const at = (x, y) => (y * W + x) * 4;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const opaque = (px, x, y) => inside(x, y) && px[at(x, y) + 3] > 8;

/** 4-connected components of pixels where pred(x, y) holds. */
function components(pred) {
  const seen = new Uint8Array(W * H), comps = [];
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    if (seen[sy * W + sx] || !pred(sx, sy)) continue;
    const stack = [[sx, sy]], pts = [];
    seen[sy * W + sx] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      pts.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (inside(nx, ny) && !seen[ny * W + nx] && pred(nx, ny)) { seen[ny * W + nx] = 1; stack.push([nx, ny]); }
      }
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    comps.push({ pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  return comps;
}

function findBall(px) {
  const red = (x, y) => { const i = at(x, y); return px[i + 3] > 8 && px[i] > 170 && px[i + 1] < 100 && px[i + 2] < 100 && px[i] - px[i + 1] > 90; };
  for (const c of components(red)) {
    if (c.pts.length < 4 || c.x1 - c.x0 < 2 || c.x1 - c.x0 > 9 || c.y1 - c.y0 > 5) continue;
    let white = 0, black = 0;
    for (let y = c.y0 - 1; y <= c.y1 + 4; y++) for (let x = c.x0 - 1; x <= c.x1 + 1; x++) {
      if (!inside(x, y)) continue;
      const i = at(x, y);
      if (px[i + 3] > 8 && px[i] > 190 && px[i + 1] > 190 && px[i + 2] > 190) white++;
    }
    for (const [x, y] of c.pts) for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y - 1]]) {
      if (!inside(nx, ny)) continue;
      const i = at(nx, ny);
      if (px[i + 3] > 8 && px[i] < 40 && px[i + 1] < 40 && px[i + 2] < 40) black++;
    }
    if (white >= 1 && black >= 4) return [c.x0 - 1, c.y0 - 1, c.x1 + 1, c.y1 + 4];
  }
  return null;
}

function findRaisedHand(px, cuts) {
  const { bounds: b, neck, waist } = cuts;
  // The sprite's skin colours: warm, light colours common in the head rows.
  const count = new Map();
  for (let y = b.y0; y <= neck; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y);
    if (px[i + 3] <= 8) continue;
    const [r, g, bl] = [px[i], px[i + 1], px[i + 2]];
    if (r > 150 && r >= g && g >= bl && r - bl > 40) { const k = (r << 16) | (g << 8) | bl; count.set(k, (count.get(k) ?? 0) + 1); }
  }
  const skin = new Set([...count].filter(([, n]) => n >= 3).map(([k]) => k));
  if (!skin.size) return null;
  const isSkin = (x, y) => { const i = at(x, y); return px[i + 3] > 8 && skin.has((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]); };
  const comps = components(isSkin).filter((c) => c.y0 < waist);
  if (comps.length < 2) return null;
  // The face: the skin blob with the most pixels in the head rows.
  const headPx = (c) => c.pts.filter(([, y]) => y <= neck + 2).length;
  const face = comps.reduce((a, c) => (headPx(c) > headPx(a) ? c : a));
  for (const c of comps) {
    if (c === face || c.pts.length < 8 || c.pts.length > 90) continue;
    if (c.x1 - c.x0 > 16 || c.y1 - c.y0 > 16) continue;
    if ((c.y0 + c.y1) / 2 > neck + 6) continue; // raised: above the shoulders
    // The rect (blob + 1 px outline) must stay clear of the face.
    const r = [c.x0 - 1, c.y0 - 1, c.x1 + 1, c.y1 + 1];
    const fx0 = face.x0 - 1, fx1 = face.x1 + 1, fy0 = face.y0 - 1, fy1 = face.y1 + 1;
    if (r[0] <= fx1 && r[2] >= fx0 && r[1] <= fy1 && r[3] >= fy0) continue;
    // It must stick out: at least a third of its edge touches empty space.
    let edge = 0, open = 0;
    for (const [x, y] of c.pts) for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (isSkin(nx, ny) && c.pts.length) continue;
      edge++;
      if (!opaque(px, nx, ny) || !opaque(px, nx + (nx - x), ny + (ny - y))) open++;
    }
    if (open / Math.max(1, edge) < 0.33) continue;
    return r;
  }
  return null;
}

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "trainerSprites.json"), "utf8"));
const files = new Set();
for (const e of Object.values(registry)) for (const s of e.sprites ?? []) {
  if (typeof s === "string") files.add(s);
  else if (s?.file && !s.disabled) files.add(s.file);
}
const found = {};
for (const file of [...files].sort()) {
  const img = await loadImage(path.join(SRC, file));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  const px = c.getContext("2d").getImageData(0, 0, img.width, img.height).data;
  const cuts = idleCuts(px, W, H);
  if (!cuts) continue;
  const ball = findBall(px), hand = findRaisedHand(px, cuts);
  if (ball || hand) found[file] = { ...(ball ? { ball } : {}), ...(hand ? { hand } : {}) };
}
fs.writeFileSync(out, JSON.stringify(found, null, 1) + "\n");
const n = (k) => Object.values(found).filter((v) => v[k]).length;
console.log(`candidates: ${n("ball")} Poké Balls, ${n("hand")} raised hands, ${Object.keys(found).length} sprites`);
