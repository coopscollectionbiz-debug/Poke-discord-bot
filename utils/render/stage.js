// ==========================================================
// utils/render/stage.js
// Animated sprites on any card. A renderer draws its card as usual but
// places Pokémon sprites through a stage instead of drawSprite directly:
//   • still (animate: false): the stage draws each sprite immediately → PNG
//   • animated: the stage records each placement; output() copies the
//     finished card once and redraws only the sprites per frame, played by
//     the battle's GIF sprite player → GIF. A card whose sprites are all
//     static (no animated GIF for them) still comes out as a PNG.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { drawSprite } from "./sprites.js";
import { loadAnimatedSprite, spritePlayer } from "../battle/render.js";
import { encodeGif } from "./gif.js";
import { createRenderGate } from "./renderGate.js";

export const FRAMES = 24, DELAY_MS = 100;

export function spriteStage({ animate = false } = {}) {
  const placed = [];
  const layers = []; // (ctx, frame) => void, drawn under every sprite each frame
  const posed = []; // sprites with procedural pose frames (trainer breathing)
  return {
    /** Like drawSprite; `who` = { id, variant } lets the sprite animate. */
    place(ctx, sprite, cx, floorY, boxW, boxH, opts = {}, who = null) {
      if (!animate || !who || !sprite || sprite.placeholder) return drawSprite(ctx, sprite, cx, floorY, boxW, boxH, opts);
      placed.push({ sprite, cx, floorY, boxW, boxH, opts, who });
      return null;
    },
    /**
     * An animated background drawn under the sprites, `draw(ctx, frame)`.
     * Still cards draw frame 0 right away.
     */
    layer(ctx, draw) {
      if (!animate) return draw(ctx, 0);
      layers.push(draw);
      return null;
    },
    /**
     * A sprite with pose frames (sprite-like objects of the same size) and
     * `poseAt(frame, totalFrames)` → pose index. Still cards draw pose 0.
     */
    placePosed(ctx, poses, poseAt, cx, floorY, boxW, boxH, opts = {}) {
      // One pose (no idle, or TRAINERS_ANIMATED=0) is just a static sprite.
      if (!animate || !(poses?.length > 1)) return drawSprite(ctx, poses?.[0], cx, floorY, boxW, boxH, opts);
      posed.push({ poses, poseAt, cx, floorY, boxW, boxH, opts });
      return null;
    },
    /** The finished card: PNG, or GIF when anything placed animates. */
    async output(canvas) {
      const ctx = canvas.getContext("2d");
      const drawAll = (frameOf) => placed.forEach((p, i) => drawSprite(ctx, p.sprite, p.cx, p.floorY, p.boxW, p.boxH, { ...p.opts, frame: frameOf(i) }));
      const drawPosed = (f) => posed.forEach((p) => drawSprite(ctx, p.poses[p.poseAt(f, FRAMES)] ?? p.poses[0], p.cx, p.floorY, p.boxW, p.boxH, p.opts));
      if (!placed.length && !layers.length && !posed.length) return canvas.toBuffer("image/png");
      const anims = await Promise.all(placed.map((p) => loadAnimatedSprite(p.who.id, p.who.variant)));
      const players = anims.map((a) => (a && a.gif.numFrames() > 1 ? spritePlayer(a) : null));
      if (!players.some(Boolean) && !layers.length && !posed.length) {
        drawAll(() => null);
        return canvas.toBuffer("image/png");
      }
      const base = createCanvas(canvas.width, canvas.height);
      base.getContext("2d").drawImage(canvas, 0, 0);
      return encodeGif(canvas, (f) => {
        ctx.drawImage(base, 0, 0);
        layers.forEach((draw) => draw(ctx, f));
        drawPosed(f);
        drawAll((i) => (players[i] ? players[i](f * DELAY_MS) : null));
      }, FRAMES, DELAY_MS);
    },
  };
}

/** True when a rendered buffer is a GIF. */
export const isGif = (buf) => buf?.subarray?.(0, 3)?.toString() === "GIF";

// One gate for every card's GIF encode, so at most two run at once across
// the bot (each adds tens of MB at peak on the 512 MB machine); anyone else
// gets the still PNG straight away.
export const cardGifGate = createRenderGate(2);

/**
 * Renders a card animated when allowed and a slot is free, else still.
 * `render(animate)` returns a Buffer. → { buffer, name: `${base}.gif|png` }
 * CARDS_ANIMATED=0 (or the per-surface `flag`=0) forces still images.
 */
export async function cardImage(render, base, { gate = cardGifGate, env = process.env, flag = null } = {}) {
  const off = env.CARDS_ANIMATED === "0" || (flag && env[flag] === "0");
  const release = off ? null : gate.tryAcquire();
  if (release) {
    try {
      const buffer = await render(true);
      return { buffer, name: `${base}.${isGif(buffer) ? "gif" : "png"}` };
    } catch (err) {
      console.warn(`⚠️ animated ${base} render failed; sending PNG:`, err?.message || err);
    } finally {
      release();
    }
  }
  return { buffer: await render(false), name: `${base}.png` };
}
