// ==========================================================
// public/shared/auraArt.js — the parts of an art Aura that the bot's
// renderers (Node) and the dashboard (browser) must agree on exactly, so the
// two can't drift. Pure functions over numbers and RGBA arrays: no canvas,
// no DOM. Imported by utils/render/trainerBackdrop.js and utils/render/auraArt.js.
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
//
// Lighting (optional; off unless aura.json has "light"):
//   "light": { "color": "#rrggbb",
//              "from": "behind" | "sides" | [dx, dy],   // [dx, dy] points toward the light (+x right, +y down)
//              "strength": 0..1 | [24 numbers 0..1] }   // per aura frame
// The trainer's outline keeps its colour (tinted a little), and the pixel
// just inside it is screen-blended toward the light, so outlines, faces and
// clothing colours survive. Mirrored with the opponent's half.
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

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * aura.json's "light" → { color: [r, g, b], from, strength: Float32Array(24) }, or null
 * when absent. Throws on a malformed value (the loader logs it and draws the Aura unlit).
 */
export function normalizeLight(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("light must be an object");
  if (!HEX.test(raw.color ?? "")) throw new Error("light.color must be #rrggbb");
  let from = raw.from ?? "behind";
  if (Array.isArray(from)) {
    if (from.length !== 2 || !from.every(Number.isFinite) || (from[0] === 0 && from[1] === 0)) throw new Error("light.from must be [dx, dy], not [0, 0]");
    const n = Math.hypot(from[0], from[1]); from = [from[0] / n, from[1] / n];
  } else if (from !== "behind" && from !== "sides") throw new Error('light.from must be "behind", "sides" or [dx, dy]');
  const s = raw.strength ?? 1;
  const list = Array.isArray(s) ? s : Array(AURA_FRAMES).fill(s);
  if (list.length !== AURA_FRAMES || !list.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error(`light.strength must be 0–1 or ${AURA_FRAMES} numbers 0–1`);
  return { color: hex(raw.color), from, strength: Float32Array.from(list) };
}

/** Strength on aura frame f, rounded to the 0.05 step the lit-pose caches use. */
export const lightStrengthAt = (light, f) => Math.round(light.strength[mod(Math.floor(f), AURA_FRAMES)] * 20) / 20;

/**
 * A lit copy of one trainer pose (RGBA, w × h, alpha ≥ 128 is the sprite).
 * `strength` 0–1 (a frame's value from the track); `mirror` flips the light
 * for the opponent's VS half. Returns a new Uint8ClampedArray; the input is untouched.
 */
export function lightPose(rgba, w, h, light, strength, { mirror = false } = {}) {
  const out = new Uint8ClampedArray(rgba);
  if (!light || !(strength > 0)) return out;
  const A = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] >= 128;
  let y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (A(x, y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (y1 < 0) return out;
  const headY = y0 + Math.round((y1 - y0) * 0.3), span = Math.max(1, y1 - y0);
  const dir = Array.isArray(light.from) ? [mirror ? -light.from[0] : light.from[0], light.from[1]] : null;
  const [cr, cg, cb] = light.color, lit = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!A(x, y)) continue;
    let ex = 0, ey = 0;
    if (!A(x - 1, y)) ex--; if (!A(x + 1, y)) ex++; if (!A(x, y - 1)) ey--; if (!A(x, y + 1)) ey++;
    if (!ex && !ey) continue;                               // interior (or enclosed both ways)
    const en = Math.hypot(ex, ey);
    let a;
    if (dir) { const dot = (ex * dir[0] + ey * dir[1]) / en; a = dot > 0.7 ? 0.75 : dot > 0.25 ? 0.55 : 0; }
    else if (light.from === "sides") { const dot = Math.abs(ex) / en; a = dot > 0.5 ? 0.65 * dot : 0; }
    else a = (ey < 0 ? 0.3 : 0.7) * (0.45 + 0.55 * ((y - y0) / span)); // behind: strongest low on the body
    a *= strength;
    if (y < headY && ey >= 0) a *= 0.35;                    // face and hair sides: a whisper; the crown keeps its light
    a = Math.round(a * 4) / 4;                              // stepped, never smooth
    if (a <= 0) continue;
    const o = (y * w + x) * 4;                              // the outline keeps its colour, tinted a little
    out[o] = Math.round(rgba[o] + (cr - rgba[o]) * a * 0.22);
    out[o + 1] = Math.round(rgba[o + 1] + (cg - rgba[o + 1]) * a * 0.22);
    out[o + 2] = Math.round(rgba[o + 2] + (cb - rgba[o + 2]) * a * 0.22);
    const ix = x - Math.sign(ex), iy = y - Math.sign(ey);   // the pixel just inside: screen-blended toward the light
    if (!A(ix, iy) || lit[iy * w + ix]) continue;
    lit[iy * w + ix] = 1;
    const q = (iy * w + ix) * 4;
    for (let k = 0; k < 3; k++) { const p = rgba[q + k], c = light.color[k] * a, sc = 255 - ((255 - p) * (255 - c)) / 255; out[q + k] = Math.round(p + (sc - p) * 0.85); }
  }
  return out;
}
