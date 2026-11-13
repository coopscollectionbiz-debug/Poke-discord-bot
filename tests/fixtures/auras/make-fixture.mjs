// Writes the test Aura art (tests/fixtures/auras/gymBlaine and shopShimmer):
// 24 frames of a pixel ring that pulses, 90×105 cells. Run once; the PNGs are committed.
import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";

const W = 90, H = 105, N = 24;
function make(id, name, colours, sky) {
  const c = createCanvas(W * N, H), x = c.getContext("2d");
  for (let f = 0; f < N; f++) {
    const r = 30 + 6 * Math.sin((f / N) * Math.PI * 2);
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      x.fillStyle = colours[a % 2];
      x.fillRect(f * W + Math.round(W / 2 + Math.cos(t) * r), Math.round(H * 0.55 + Math.sin(t) * r * 1.2), 1, 1);
    }
  }
  const dir = new URL(`./${id}/`, import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(new URL("back.png", dir), c.toBuffer("image/png"));
  const meta = { id, name, credit: [], palette: colours, sky, layers: { back: "back.png" } };
  fs.writeFileSync(new URL("aura.json", dir), `${JSON.stringify(meta, null, 2)}\n`);
}
make("gymBlaine", "Volcano Aura (test art)", ["#f97316", "#fde047"], ["#0c0402", "#2a0d05", "#4a1606"]);
make("shopShimmer", "Shimmer Aura (test art)", ["#e0f2fe", "#7dd3fc"], ["#020617", "#0b1d3a", "#123a5c"]);
console.log("ok");
