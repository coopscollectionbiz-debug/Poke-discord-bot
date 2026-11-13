// ==========================================================
// utils/render/vsField.js
// The pieces the split-field VS cards share (/challenge, the Trainer
// encounter, the /battle VS card): idle trainers through the sprite stage,
// soft platforms, and a player's tier backdrop filling their whole half.
//
// How a card is layered:
//   1. the card's own background and halves (static);
//   2. per half with a backdrop: plain background, then the flat tier wash
//      (static), so the backdrop replaces that half's colour;
//   3. one stage layer per frame: each backdrop's glow and effects, then the
//      card's content (`fg`: text, Team cells, Badges, platforms) on top;
//   4. trainers and Team sprites, drawn by the stage over everything.
// Backdrop effects stay clear of every content pixel, every pose of each
// trainer, and a margin around them (`occupied`), so nothing passes behind.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { drawBackground, drawSoftPlatform } from "./primitives.js";
import { drawSprite, loadTrimmedTrainerSprite, loadTrimmedTrainerPoses } from "./sprites.js";
import { regionBackdrop, backdropTint, hasBackdrop } from "./trainerBackdrop.js";
import { FRAMES } from "./stage.js";

/** The diagonal seam's x at height y. */
export const seamX = (y, field) => field.top + ((field.bottom - field.top) * y) / field.h;

/** Path of the left (or right) half, `inset` px clear of the seam's centre line. */
export function halfPath(ctx, side, field, W, inset = 9) {
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(0, 0);
    ctx.lineTo(field.top - inset, 0);
    ctx.lineTo(field.bottom - inset, field.h);
    ctx.lineTo(0, field.h);
  } else {
    ctx.moveTo(field.top + inset, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, field.h);
    ctx.lineTo(field.bottom + inset, field.h);
  }
  ctx.closePath();
}

/**
 * A trainer standing at (cx, floor): soft platform on `fg`, then the sprite
 * through the stage (its idle when animated, else the still). `tint` colours
 * the platform (an owned Epic+ trainer's tier), null is neutral. `idle`
 * false draws the still even on an animated card (CARD_TRAINER_FX=0).
 * Returns the sprites it may draw (every pose), for the backdrop's mask.
 */
export async function placeTrainer(fg, stage, { file, cx, floor, box, scale = 4, tint = null, idle = true, platform = null, env = process.env }) {
  const [rx, ry] = platform ?? (scale === 4 ? [118, 20] : [52, 10]);
  drawSoftPlatform(fg, cx, floor, rx, ry, tint, { u: scale === 4 ? 4 : 2 });
  // Trimmed to the opaque pixels (every pose's), so the feet land on the floor: real
  // animations' frames are framed differently from the PNG.
  const still = await loadTrimmedTrainerSprite(file);
  if (!still) return null;
  const poses = idle ? await loadTrimmedTrainerPoses(file, { env }) : null;
  const bw = typeof box === "number" ? box : box.w, bh = typeof box === "number" ? box : box.h;
  if (poses?.poses?.length > 1) {
    stage.placePosed(fg, poses.poses, poses.poseAt, cx, floor + 6, bw, bh, { scale });
    return { sprites: poses.poses, cx, floorY: floor + 6, bw, bh, scale };
  }
  drawSprite(fg, still, cx, floor + 6, bw, bh, { scale });
  return { sprites: [still], cx, floorY: floor + 6, bw, bh, scale };
}

/**
 * Card pixels a backdrop must stay clear of: whatever `fg` drew, every
 * trainer pose, and `rects` ({ x, y, w, h }, for things drawn later such as
 * animated Team sprites). → (x, y) => boolean
 */
export function occupancy(W, H, fg, trainers = [], rects = []) {
  const occ = new Uint8Array(W * H);
  const a = fg.getContext("2d").getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) if (a[i * 4 + 3] > 8) occ[i] = 1;
  const m = createCanvas(W, H), mc = m.getContext("2d");
  for (const t of trainers) if (t) for (const s of t.sprites) drawSprite(mc, s, t.cx, t.floorY, t.bw, t.bh, { scale: t.scale });
  const d = mc.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 8) occ[i] = 1;
  for (const r of rects) {
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(H, r.y + r.h); y++) occ.fill(1, y * W + Math.max(0, Math.floor(r.x)), y * W + Math.min(W, Math.ceil(r.x + r.w)));
  }
  return (x, y) => occ[y * W + x] === 1;
}

/**
 * A player's tier backdrop over their half: the half's own colour replaced
 * by the plain background plus the tier wash (drawn now, on `ctx`), and
 * { draw(ctx, f) } for the glow and effects, or null below Epic. The glow
 * runs diagonally from the half's outer bottom corner toward the seam. An art
 * Aura's vs.png is drawn mirrored on the right half, so it sits around that
 * half's trainer (at the mirror of the left trainer's place) and moves the
 * mirrored way; text and trainers are drawn elsewhere and never flip.
 */
export function halfBackdrop(ctx, { side, tier, field, W, H, occupied, floor }) {
  if (!hasBackdrop(tier)) return null;
  const left = side === "left";
  const x0 = left ? 0 : Math.floor(field.bottom / 4) * 4;
  const rect = { x: x0, y: 0, w: (left ? field.top : W) - x0, h: field.h };
  const bd = regionBackdrop({
    tier, rect, u: 4, occupied, floor, frames: FRAMES, variant: "vs", mirror: !left, // an art Aura's vs.png, if it has one
    from: left ? [0, field.h] : [W, field.h],
    to: left ? [field.top * 0.95, -field.h * 0.3] : [x0 + (W - x0) * 0.05, -field.h * 0.3],
    clip: (c) => halfPath(c, side, field, W),
  });
  ctx.save();
  halfPath(ctx, side, field, W);
  ctx.clip();
  drawBackground(ctx, W, H);
  ctx.restore();
  bd.drawWash(ctx);
  return bd;
}
