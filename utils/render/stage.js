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
//   • the loop: one length for every sprite on the card, fitted so their
//     animations don't cut mid-motion (utils/render/spriteLoops.js), at 50 ms
//     steps. Trainers and backdrops keep their 2.4 s, 100 ms-a-step schedule
//     inside it. A GIF over MAX_GIF_BYTES falls back to the old 2.4 s loop,
//     then to the still PNG.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { performance } from "perf_hooks";
import { drawSprite } from "./sprites.js";
import { loadAnimatedSprite, spritePlayer } from "../battle/render.js";
import { encodeGif } from "./gif.js";
import { createRenderGate } from "./renderGate.js";
import { getRenderPool, renderOptions } from "./renderPool.js";
import { shinyBackdrop, shinyFxEnabled } from "./shinyBackdrop.js";
import { loopPlan, fitLoop, spriteTime, pokemonLoopFit, STEP_MS, MAX_GIF_BYTES } from "./spriteLoops.js";

export const FRAMES = 24, DELAY_MS = 100;
// Discord takes up to 10 MB a file; past this, the card falls back (see above).
export { MAX_GIF_BYTES };

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
     * `opts.light(sprite, frame)`: the Aura's trainer lighting
     * (utils/render/auraArt.js trainerLight), applied to the current pose.
     */
    placePosed(ctx, poses, poseAt, cx, floorY, boxW, boxH, opts = {}) {
      const { light = null, ...draw } = opts;
      // One pose (no idle, or TRAINERS_ANIMATED=0) is just a static sprite, unless its lighting animates.
      if (!animate || !(poses?.length > 1 || light)) return drawSprite(ctx, light && poses?.[0] ? light(poses[0], 0) : poses?.[0], cx, floorY, boxW, boxH, draw);
      posed.push({ poses, poseAt: poses.length > 1 ? poseAt : () => 0, cx, floorY, boxW, boxH, opts: draw, light });
      return null;
    },
    /**
     * The finished card: PNG, or GIF when anything placed animates (a Pokémon
     * sprite, a shiny backdrop, a layer, or a breathing trainer). `overlay`:
     * static content a layer draws over its animation (see above).
     */
    async output(canvas, { overlay = null } = {}) {
      const ctx = canvas.getContext("2d");
      const drawAll = (frameOf) => placed.forEach((p, i) => drawSprite(ctx, p.sprite, p.cx, p.floorY, p.boxW, p.boxH, { ...p.opts, frame: frameOf(i) }));
      const drawPosed = (f) => posed.forEach((p) => {
        const pose = p.poses[p.poseAt(f, FRAMES)] ?? p.poses[0];
        drawSprite(ctx, p.light ? p.light(pose, f) : pose, p.cx, p.floorY, p.boxW, p.boxH, p.opts);
      });
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
      // The static layer the GIF encoder dithers (utils/render/gif.js): the
      // card as drawn, plus `overlay`, static content a layer redraws each
      // frame over an animated backdrop.
      const still = createCanvas(canvas.width, canvas.height);
      still.getContext("2d").drawImage(base, 0, 0);
      if (overlay) still.getContext("2d").drawImage(overlay, 0, 0);
      const background = still.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      // The old loop: 2.4 s at 100 ms, each sprite from its start (also the size fallback).
      const fixed = () => encodeGif(canvas, (f) => {
        ctx.drawImage(base, 0, 0);
        layers.forEach((draw) => draw(ctx, f));
        backdrops.forEach((b) => b?.draw(ctx, f, FRAMES));
        drawPosed(f);
        drawAll((i) => (players[i] ? players[i](f * DELAY_MS) : null));
      }, FRAMES, DELAY_MS, { background });
      if (!pokemonLoopFit(env)) return fixed();
      // The fitted loop. Anything on the trainers' clock keeps it whole.
      const plans = players.map((p, i) => (p ? loopPlan(anims[i]) : null));
      const trainerClock = layers.length > 0 || posed.length > 0 || backdrops.some(Boolean);
      const { L, fit } = fitLoop(plans.map((p) => p?.period ?? null), { trainerClock });
      const total = Math.max(1, Math.round(L / STEP_MS));
      const gif = await encodeGif(canvas, (f) => {
        const t = f * STEP_MS, f100 = Math.floor(t / DELAY_MS) % FRAMES;
        ctx.drawImage(base, 0, 0);
        layers.forEach((draw) => draw(ctx, f100));
        backdrops.forEach((b) => b?.draw(ctx, f100, FRAMES));
        drawPosed(f100);
        drawAll((i) => (players[i] ? players[i](spriteTime(plans[i], fit[i], t)) : null));
      }, total, STEP_MS, { background });
      if (gif.length <= MAX_GIF_BYTES) return gif;
      const short = await fixed();
      if (short.length <= MAX_GIF_BYTES) return short;
      ctx.drawImage(base, 0, 0);
      layers.forEach((draw) => draw(ctx, 0));
      backdrops.forEach((b) => b?.draw(ctx, 0, FRAMES));
      drawPosed(0);
      drawAll(() => null);
      return canvas.toBuffer("image/png");
    },
  };
}

/** True when a rendered buffer is a GIF. */
export const isGif = (buf) => buf?.subarray?.(0, 3)?.toString() === "GIF";

// With RENDER_THREADS=0 (no render threads), one gate for every card's GIF
// encode, so at most two run at once on the main thread; anyone else gets
// the still PNG straight away. With render threads, the pool's line is the
// limit instead (CARD_QUEUE_WAIT_MS).
export const cardGifGate = createRenderGate(2);

// How long an animated card waits for a free render thread before the
// still PNG goes instead. Every card command has already deferred its
// reply, so this is about the player's wait, not Discord's 3 s deadline.
export const CARD_QUEUE_WAIT_MS = 2000;

/**
 * A short random suffix for a card that replaces an earlier image in the same
 * message (paging, a menu pick). With one fixed name per edit, a desktop
 * client whose first load failed kept showing the broken image for every
 * later edit; a new name each time makes it load fresh.
 */
export const uniqueSuffix = () => Math.random().toString(36).slice(2, 8);

/**
 * Renders a card animated when allowed, else still.
 * `render(animate)` returns a Buffer. → { buffer, name: `${base}.gif|png` }
 * CARDS_ANIMATED=0 (or the per-surface `flag`=0) forces still images.
 * `unique: true` names it `${base}-<random>.gif|png` (see uniqueSuffix).
 * With render threads (`pool`), the GIF waits up to CARD_QUEUE_WAIT_MS for
 * a thread, then the PNG goes to the front of the line instead. Without
 * them, the GIF needs a slot in `gate`, else the PNG is sent.
 * Logs one timing line per card: `🖼️ card <base> gif|png <KB> KB <ms> ms`,
 * plus "(gate full)" or "(threads busy)" when it wanted to animate but had
 * to send the PNG.
 */
export async function cardImage(render, base, { gate = cardGifGate, pool = getRenderPool(), env = process.env, flag = null, unique = false, log = console.log, waitMs = CARD_QUEUE_WAIT_MS } = {}) {
  const started = performance.now();
  const name = unique ? `${base}-${uniqueSuffix()}` : base;
  const done = (buffer, note = "") => {
    const kind = isGif(buffer) ? "gif" : "png";
    log(`🖼️ card ${base} ${kind} ${Math.round(buffer.length / 1024)} KB ${Math.round(performance.now() - started)} ms${note}`);
    return { buffer, name: `${name}.${kind}` };
  };
  const off = env.CARDS_ANIMATED === "0" || (flag && env[flag] === "0");
  if (off) return done(await renderOptions.run({}, () => render(false)));

  if (pool) {
    try {
      return done(await renderOptions.run({ waitMs }, () => render(true)));
    } catch (err) {
      if (err?.code === "RENDER_QUEUE_TIMEOUT") {
        return done(await renderOptions.run({ priority: true }, () => render(false)), " (threads busy)");
      }
      console.warn(`⚠️ animated ${base} render failed; sending PNG:`, err?.message || err);
      return done(await renderOptions.run({ priority: true }, () => render(false)));
    }
  }

  const release = gate.tryAcquire();
  if (release) {
    try {
      return done(await render(true));
    } catch (err) {
      console.warn(`⚠️ animated ${base} render failed; sending PNG:`, err?.message || err);
    } finally {
      release();
    }
    return done(await render(false));
  }
  return done(await render(false), " (gate full)");
}
