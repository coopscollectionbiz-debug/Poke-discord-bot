// ==========================================================
// public/shared/auraArt.js — the parts of an art Aura that the bot's
// renderers (Node) and the dashboard (browser) must agree on exactly, so the
// two can't drift. Pure functions: no canvas, no DOM. Imported by
// utils/render/trainerBackdrop.js.
//
// Timing. Every Aura plays once per 2.4 s card loop: 24 aura frames of
// 100 ms. A sheet of n frames is sampled onto those 24 (n = 48 shows every
// other frame; n = 12 holds each frame for two). The trainer's idle runs on
// the same 2.4 s loop (utils/render/sprites.js loadTrainerPoses), so the
// backdrop and the trainer close together every loop.
//
// Placement (sheet pixels = sprite pixels):
//   back.png  card panel. The trainer is centred on the sheet and the bottom
//             edge of their feet sits BACK_FEET_FROM_BOTTOM rows above the
//             sheet's bottom (row 98 of a 105-row sheet).
//   vs.png    a VS half, drawn from the half's bottom-left; the opponent's
//             half shows it mirrored, so motifs stay around each trainer.
//   row.png   a playback row, drawn from its bottom-left, never mirrored.
// ==========================================================

export const AURA_FRAMES = 24;
export const AURA_FRAME_MS = 100;
export const AURA_LOOP_MS = AURA_FRAMES * AURA_FRAME_MS;
export const BACK_FEET_FROM_BOTTOM = 7;

const mod = (a, n) => ((a % n) + n) % n;
/** The aura frame (0–23) at card time `ms`. */
export const auraFrameAt = (ms) => mod(Math.floor(ms / AURA_FRAME_MS), AURA_FRAMES);
/** The sheet frame (0…n-1) shown on aura frame f of the 24-frame loop. */
export const sheetFrame = (f, n) => Math.floor((mod(Math.floor(f), AURA_FRAMES) * n) / AURA_FRAMES);

