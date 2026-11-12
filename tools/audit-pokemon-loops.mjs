// Audit: Pokémon GIF loop length vs the card loop (stage.js FRAMES × DELAY_MS),
// and how far later frames reach below / above the frame-0 (idle) box that
// drawSprite anchors to the floor. Usage: node tools/audit-pokemon-loops.mjs [folder]
import { readFileSync, readdirSync } from "fs";
import { GifReader } from "omggif";
import { FRAMES, DELAY_MS } from "../utils/render/stage.js";
const folder = process.argv[2] ?? "normal";
const dir = new URL(`../public/sprites/pokemon/${folder}/`, import.meta.url);
const CARD = FRAMES * DELAY_MS;
const rows = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith(".gif"))) {
  const gif = new GifReader(readFileSync(new URL(f, dir)));
  const n = gif.numFrames(), W = gif.width, H = gif.height;
  let dur = 0, minDelay = 1e9; const px = new Uint8ClampedArray(W * H * 4);
  let box0 = null, lo = -1, hi = H, first = null, t = 0, cut = 0;
  for (let i = 0; i < n; i++) {
    const info = gif.frameInfo(i); const d = (info.delay || 10) * 10; dur += d; minDelay = Math.min(minDelay, d);
    if (i > 0 && gif.frameInfo(i - 1).disposal === 2) { const p = gif.frameInfo(i - 1); for (let y = p.y; y < p.y + p.height; y++) px.fill(0, (y * W + p.x) * 4, (y * W + p.x + p.width) * 4); }
    gif.decodeAndBlitFrameRGBA(i, px);
    if (i === 0) first = px.slice(); else if (t <= 8000 && px.every((v, j) => v === first[j])) cut = t;
    t += d;
    let y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 8) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (y1 < 0) continue;
    if (!box0) box0 = { y0, y1 };
    lo = Math.max(lo, y1); hi = Math.min(hi, y0);
  }
  if (!box0) continue;
  rows.push({ id: f.replace(".gif", ""), n, dur, minDelay, seam: n > 1 ? CARD % dur : 0, below: lo - box0.y1, idleCut: cut, above: box0.y0 - hi });
}
const anim = rows.filter((r) => r.n > 1);
const clean = anim.filter((r) => r.seam === 0).length;
const sub = anim.filter((r) => r.minDelay < DELAY_MS).length;
const cnt = (k, t) => anim.filter((r) => r[k] >= t).length;
console.log(`folder ${folder}: ${rows.length} sprites, ${anim.length} animated; card loop ${CARD} ms`);
console.log(`loops cleanly in card (dur divides ${CARD}): ${clean}; cut mid-loop: ${anim.length - clean}`);
console.log(`frames shorter than ${DELAY_MS} ms (skipped/dropped when sampled): ${sub}`);
const d = anim.map((r) => r.dur).sort((a, b) => a - b);
console.log(`duration ms: min ${d[0]} median ${d[d.length >> 1]} p90 ${d[Math.floor(d.length * 0.9)]} max ${d.at(-1)}`);
console.log(`dip below idle floor ≥2px: ${cnt("below", 2)}, ≥6px: ${cnt("below", 6)}, ≥12px: ${cnt("below", 12)}; rise ≥12px: ${cnt("above", 12)}`);
const ids = process.argv.slice(3);
for (const r of rows.filter((r) => ids.includes(r.id))) console.log(JSON.stringify(r));
console.log("worst dips:", anim.sort((a, b) => b.below - a.below).slice(0, 12).map((r) => `${r.id}:${r.below}`).join(" "));
for (const s of [4000, 6000, 8000, 10000, 12000]) console.log(`longer than ${s} ms: ${anim.filter((r) => r.dur > s).length}`);
const long = anim.filter((r) => r.dur > 8000);
console.log(`over 8000 ms: ${long.length}, of which return to the exact idle frame by 8 s: ${long.filter((r) => r.idleCut >= 2000).length}`);
