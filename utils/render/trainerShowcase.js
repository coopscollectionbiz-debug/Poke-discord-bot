// ==========================================================
// utils/render/trainerShowcase.js
// One owned Epic+ trainer on their tier backdrop, for /showtrainers' detail
// view (rendered when it's opened): the trainer idles at 4× on a soft
// platform in their tier colour, over the diagonal tier glow and its
// effects. Other trainers keep the idle GIF (or still) from its URL.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { drawBackground, drawSoftPlatform } from "./primitives.js";
import { drawSprite, loadTrimmedTrainerSprite, loadTrimmedTrainerPoses } from "./sprites.js";
import { createBackdrop, backdropTint } from "./trainerBackdrop.js";
import { spriteStage, FRAMES } from "./stage.js";

export const SHOWCASE_SIZE = Object.freeze({ w: 320, h: 320 });
const { w: W, h: H } = SHOWCASE_SIZE;
const U = 4; // one backdrop cell = one sprite pixel at 4×
const FLOOR = H - 28;

/** v: { file, tier }. A PNG, or with `animate` a GIF. Null when the sprite can't be read. */
export async function renderTrainerShowcase(v, { animate = false, env = process.env } = {}) {
  const still = await loadTrimmedTrainerSprite(v.file);
  if (!still) return null;
  const idle = await loadTrimmedTrainerPoses(v.file, { env });
  const poses = idle?.poses?.length > 1 ? idle.poses : [still];
  const stage = spriteStage({ animate, env });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  const tint = backdropTint(v.tier);
  const box = { w: W - 24, h: FLOOR - 8 };
  if (tint) {
    ctx.fillStyle = `${tint}12`;
    ctx.fillRect(0, 0, W, H);
    // Every pose's pixels (and the platform), so effects never pass behind.
    const gw = W / U, gh = H / U, mask = new Uint8Array(gw * gh);
    const m = createCanvas(W, H), mc = m.getContext("2d");
    for (const p of poses) drawSprite(mc, p, W / 2, FLOOR + 6, box.w, box.h, { scale: 4 });
    const d = mc.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const platform = Math.abs(x - W / 2) < 100 && Math.abs(y - FLOOR) < 18;
      if (!platform && d[(y * W + x) * 4 + 3] <= 8) continue;
      const gx = Math.floor(x / U), gy = Math.floor(y / U);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X = gx + dx, Y = gy + dy;
        if (X >= 0 && Y >= 0 && X < gw && Y < gh) mask[Y * gw + X] = 1;
      }
    }
    const bd = createBackdrop({ tier: v.tier, gridW: gw, gridH: gh, mask, frames: FRAMES, halo: { from: [0, gh], to: [gw, -gh * 0.2] }, floorRow: Math.floor(FLOOR / U) });
    stage.layer(ctx, (c, f) => {
      c.imageSmoothingEnabled = false;
      c.drawImage(bd.frame(f), 0, 0, W, H);
      c.imageSmoothingEnabled = true;
      drawSoftPlatform(c, W / 2, FLOOR, 100, 16, tint); // over the glow, under the trainer
    });
  } else drawSoftPlatform(ctx, W / 2, FLOOR, 100, 16, null);
  stage.placePosed(ctx, poses, idle?.poseAt ?? (() => 0), W / 2, FLOOR + 6, box.w, box.h, { scale: 4 });
  return stage.output(canvas);
}
