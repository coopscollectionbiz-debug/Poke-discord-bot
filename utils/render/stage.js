// ==========================================================
// utils/render/stage.js
// Animated sprites on any card. A renderer draws its card as usual but
// places Pokémon sprites through a stage instead of drawSprite directly:
//   • still (animate: false): the stage draws each sprite immediately → PNG
//   • animated: the stage records each placement; output() copies the
//     finished card once and redraws only the sprites per frame, played by
//     the battle's GIF sprite player → GIF. A card whose sprites are all
//     static (no animated GIF for them) still comes out as a PNG.
//   • shiny Pokémon get the Legendary-tier backdrop (rising gold motes and
//     twinkling stars, utils/render/shinyBackdrop.js) behind them; on an
//     animated card it moves, so a shiny alone makes the card a GIF.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { performance } from "perf_hooks";
import { drawSprite } from "./sprites.js";
import { loadAnimatedSprite, spritePlayer } from "../battle/render.js";
import { encodeGif } from "./gif.js";
import { createRenderGate } from "./renderGate.js";
import { shinyBackdrop, shinyFxEnabled } from "./shinyBackdrop.js";

export const FRAMES = 24, DELAY_MS = 100;

/** Stable layout seed per Pokémon, so a shiny's stars sit in the same places every time. */
export const backdropSeed = (id) => [...String(id)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);
const wantsBackdrop = (who, sprite, env) => who?.variant === "shiny" && sprite && !sprite.placeholder && shinyFxEnabled(env);

export function spriteStage({ animate = false, env = process.env } = {}) {
  const placed = [];
  const layers = []; // (ctx, frame) => void, drawn under every sprite each frame
  const posed = []; // sprites with procedural pose frames (trainer breathing)
  return {
    /** Like drawSprite; `who` = { id, variant } lets the sprite animate (and a shiny get its backdrop). */
    place(ctx, sprite, cx, floorY, boxW, boxH, opts = {}, who = null) {
      if (!animate || !who || !sprite || sprite.placeholder) {
        if (wantsBackdrop(who, sprite, env)) shinyBackdrop({ sprite, cx, floorY, boxW, boxH, scale: opts.scale, seed: backdropSeed(who.id) })?.draw(ctx, 0, FRAMES);
        return drawSprite(ctx, sprite, cx, floorY, boxW, boxH, opts);
      }
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
    /**
     * The finished card: PNG, or GIF when anything placed animates (a Pokémon
     * sprite, a shiny backdrop, a layer, or a breathing trainer).
     */
    async output(canvas) {
      const ctx = canvas.getContext("2d");
      const drawAll = (frameOf) => placed.forEach((p, i) => drawSprite(ctx, p.sprite, p.cx, p.floorY, p.boxW, p.boxH, { ...p.opts, frame: frameOf(i) }));
      const drawPosed = (f) => posed.forEach((p) => drawSprite(ctx, p.poses[p.poseAt(f, FRAMES)] ?? p.poses[0], p.cx, p.floorY, p.boxW, p.boxH, p.opts));
      if (!placed.length && !layers.length && !posed.length) return canvas.toBuffer("image/png");
      const anims = await Promise.all(placed.map((p) => loadAnimatedSprite(p.who.id, p.who.variant)));
      const players = anims.map((a) => (a && a.gif.numFrames() > 1 ? spritePlayer(a) : null));
      // Every backdrop first, then every sprite, so no backdrop covers a neighbour.
      const backdrops = placed.map((p, i) => (wantsBackdrop(p.who, p.sprite, env)
        ? shinyBackdrop({ sprite: p.sprite, anim: anims[i], cx: p.cx, floorY: p.floorY, boxW: p.boxW, boxH: p.boxH, scale: p.opts.scale, seed: backdropSeed(p.who.id) })
        : null));
      if (!players.some(Boolean) && !backdrops.some(Boolean) && !layers.length && !posed.length) {
        drawAll(() => null);
        return canvas.toBuffer("image/png");
      }
      const base = createCanvas(canvas.width, canvas.height);
      base.getContext("2d").drawImage(canvas, 0, 0);
      return encodeGif(canvas, (f) => {
        ctx.drawImage(base, 0, 0);
        layers.forEach((draw) => draw(ctx, f));
        backdrops.forEach((b) => b?.draw(ctx, f, FRAMES));
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
 * A short random suffix for a card that replaces an earlier image in the same
 * message (paging, a menu pick). With one fixed name per edit, a desktop
 * client whose first load failed kept showing the broken image for every
 * later edit; a new name each time makes it load fresh.
 */
export const uniqueSuffix = () => Math.random().toString(36).slice(2, 8);

/**
 * Renders a card animated when allowed and a slot is free, else still.
 * `render(animate)` returns a Buffer. → { buffer, name: `${base}.gif|png` }
 * CARDS_ANIMATED=0 (or the per-surface `flag`=0) forces still images.
 * `unique: true` names it `${base}-<random>.gif|png` (see uniqueSuffix).
 * Logs one timing line per card: `🖼️ card <base> gif|png <KB> KB <ms> ms`,
 * plus "(gate full)" when it wanted to animate but had to send the PNG.
 */
export async function cardImage(render, base, { gate = cardGifGate, env = process.env, flag = null, unique = false, log = console.log } = {}) {
  const started = performance.now();
  const name = unique ? `${base}-${uniqueSuffix()}` : base;
  const done = (buffer, note = "") => {
    const kind = isGif(buffer) ? "gif" : "png";
    log(`🖼️ card ${base} ${kind} ${Math.round(buffer.length / 1024)} KB ${Math.round(performance.now() - started)} ms${note}`);
    return { buffer, name: `${name}.${kind}` };
  };
  const off = env.CARDS_ANIMATED === "0" || (flag && env[flag] === "0");
  const release = off ? null : gate.tryAcquire();
  if (release) {
    try {
      return done(await render(true));
    } catch (err) {
      console.warn(`⚠️ animated ${base} render failed; sending PNG:`, err?.message || err);
    } finally {
      release();
    }
  }
  return done(await render(false), !off && !release ? " (gate full)" : "");
}
