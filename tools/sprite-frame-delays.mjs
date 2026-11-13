// ==========================================================
// tools/sprite-frame-delays.mjs — how fast our Pokémon sprite GIFs animate.
//   node tools/sprite-frame-delays.mjs [folder]   (default public/sprites/pokemon/normal)
// Reports the share of frames by delay (ms) and each sprite's shortest delay,
// to judge what card frame step (50 vs 100 ms) the sprites can use.
// ==========================================================
import fs from "fs";
import path from "path";
import { GifReader } from "omggif";

const dir = path.resolve(process.argv[2] ?? "public/sprites/pokemon/normal");
const frames = new Map();
const minBy = new Map();
let sprites = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".gif"))) {
  let g;
  try { g = new GifReader(fs.readFileSync(path.join(dir, f))); } catch { continue; }
  if (g.numFrames() < 2) continue;
  sprites++;
  let min = Infinity;
  for (let i = 0; i < g.numFrames(); i++) {
    const ms = (g.frameInfo(i).delay || 10) * 10;
    frames.set(ms, (frames.get(ms) ?? 0) + 1);
    min = Math.min(min, ms);
  }
  minBy.set(min, (minBy.get(min) ?? 0) + 1);
}
const total = [...frames.values()].reduce((a, b) => a + b, 0);
const table = (m, n) => Object.fromEntries([...m].sort((a, b) => a[0] - b[0]).map(([ms, c]) => [`${ms} ms`, `${c} (${((100 * c) / n).toFixed(1)}%)`]));
console.log(`${sprites} animated sprites, ${total} frames in ${dir}`);
console.log("Frames by delay:"); console.table(table(frames, total));
console.log("Sprites by shortest delay:"); console.table(table(minBy, sprites));
