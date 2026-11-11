// ==========================================================
// utils/spriteBreathing.js
// The procedural idle for static Pokémon sprites: the trainer idle's
// clean-step breathing (utils/trainerIdle.js) and closed-lid blink
// (blinkEyes in utils/trainerMotion.js), re-exported here so Pokémon and
// trainers always move the same way, plus the Pokémon loop (per-sprite
// tempo, no phase offset, one blink where data/sprites/pokemon-blinks.json
// lists eyes).
//
// Every pose is made only from the sprite's own pixels. On the exhale the
// upper body drops 1 px; the drop moves in up to 3 in-between steps, the
// head first on the out-breath and the waist first on the in-breath. A
// blink closes each eye: the eye takes the lid colour, with a lash line on
// its bottom row. Frame 0 is always the untouched sprite.
// ==========================================================

import { breathLoop } from "./trainerIdle.js";
import { nameHash } from "./trainerMotion.js";

export { opaqueBounds, idleCuts, stepCount, breathPose, breathingPoses, STEP_MS, breathLoop, IDLE_LOOP } from "./trainerIdle.js";
export { blinkEyes, nameHash } from "./trainerMotion.js";

// ---- Pokémon loop ---------------------------------------------------------
/**
 * Per-sprite breath tempo, 0.85×–1.2× of the base loop (the trainer rule),
 * so a team shown together never breathes in step. Unlike trainers there is
 * no phase offset: the loop always starts on the rest pose, so frame 0 stays
 * the untouched sprite.
 */
export function breathTiming(key) {
  const tempo = 0.85 + ((nameHash(key) % 1000) / 1000) * 0.35;
  return { rest: Math.round((900 * tempo) / 10) * 10, exhale: Math.round((700 * tempo) / 10) * 10 };
}

/** When the blink falls (fraction of the loop: late in the rest hold before the out-breath) and how long it holds. */
export const BLINK_MS = 120;
export const blinkAt = (key) => 0.08 + ((nameHash(key) >>> 12) % 100) / 100 * 0.2;

/**
 * The standalone loop for one sprite as [{ pose, blink, ms }]: the clean-step
 * breath at the sprite's tempo, and (when it has eyes) one 120 ms blink.
 * Starts on the rest pose with open eyes.
 */
export function pokemonLoop(key, steps, { blink = false } = {}) {
  const breath = breathLoop(steps, breathTiming(key));
  const total = breath.reduce((s, [, ms]) => s + ms, 0);
  const a = Math.round((blinkAt(key) * total) / 10) * 10, b = a + BLINK_MS;
  const out = [];
  let t = 0;
  for (const [pose, ms] of breath) {
    const cuts = blink ? [t, Math.max(t, Math.min(a, t + ms)), Math.max(t, Math.min(b, t + ms)), t + ms] : [t, t + ms];
    for (let i = 0; i < cuts.length - 1; i++) {
      const d = cuts[i + 1] - cuts[i];
      if (d <= 0) continue;
      const shut = blink && cuts[i] >= a && cuts[i] < b;
      const last = out.at(-1);
      if (last && last.pose === pose && last.blink === shut) last.ms += d;
      else out.push({ pose, blink: shut, ms: d });
    }
    t += ms;
  }
  return out;
}
