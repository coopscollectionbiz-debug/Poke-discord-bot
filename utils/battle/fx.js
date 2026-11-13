// ==========================================================
// utils/battle/fx.js — Battle FX's effects: one games-style pixel
// animation per beat (utils/battle/timeline.js), drawn over the Pokémon's
// sprite on the same 2-pixel grid as the ring. Pure: the same beat and
// phase always draw the same pixels, so replay GIFs are deterministic.
//
// drawEffect(ctx, seg, box, phase): box is the sprite's drawn box
// ({ cx, top, floor, w, h }), phase runs 0 → 1 through the beat. Effects
// stay within 24 px of the box: flames, Zs and the stat pop rise above it.
// The render tints the sprite itself (tinted, tintAt) and shakes it
// (jitterAt).
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { typeStyle } from "../render/tokens.js";

const FONT = "system-ui, 'DejaVu Sans', 'Noto Sans', Arial, sans-serif";
const INK = "#0e1120";
const GOLD = "#f5c84c"; // the award screen's and ring's gold
const WHITE = "#fff8e8";
const darken = (hex, k) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, "0")).join("")}`;

/** Each status condition's tag and effect color: its type's color (bad poison a deeper purple). */
export const STATUS_COLORS = Object.freeze({
  brn: typeStyle("Fire").fill,
  psn: typeStyle("Poison").fill,
  tox: darken(typeStyle("Poison").fill, 0.25),
  par: typeStyle("Electric").fill,
  slp: typeStyle("Normal").fill,
  frz: typeStyle("Ice").fill,
});
/** Stat chips and chevrons: a raise in the low-HP red, a drop in the Water blue. */
export const CHIP_COLORS = Object.freeze({ up: "#ef4b4b", down: typeStyle("Water").fill });
/** The effects with no tag: confusion's stars, Leech Seed's sprouts and orbs, a cure's sparkles. */
export const EFFECT_COLORS = Object.freeze({ confusion: GOLD, leechseed: typeStyle("Grass").fill, cure: GOLD });

const U = 2;
const snap = (v) => Math.round(v / U) * U;
// A pixel pattern centered on (x, y): one 2-px cell per character, "." empty.
function cells(ctx, x, y, rows, palette) {
  const x0 = snap(x - (rows[0].length * U) / 2), y0 = snap(y - (rows.length * U) / 2);
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const color = palette[row[i]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x0 + i * U, y0 + j * U, U, U);
    }
  });
}
const cycle = (phase, k, n) => (phase + k / n) % 1;

const FLAME = { big: ["..o..", ".ooo.", "ooyoo", "oyyyo", "oywyo", ".ooo."], small: [".o.", "oyo", "oyo", ".o."] };
const BUBBLE = [".pp.", "pw.p", "p..p", ".pp."];
const BOLT = ["..y", ".y.", "yyy", ".y.", "y.."];
const ZED = ["zzzzz", "...z.", "..z..", ".z...", "zzzzz"];
const SHARD = [".w.", "wiw", ".i.", ".i."];
const STAR = ["..s..", ".sss.", "sssss", ".sss.", "..s.."];
const ORB = [".g.", "gwg", ".g."];
const CHEVRON_UP = ["...c...", "..ccc..", ".cc.cc.", "cc...cc"];
const CHEVRON_DOWN = [...CHEVRON_UP].reverse();

const DRAW = {
  brn(ctx, b, phase) {
    [-30, -16, -4, 8, 20, 32].forEach((dx, k) => {
      const t = cycle(phase, k, 6);
      cells(ctx, b.cx + dx, b.floor - 8 - t * b.h * 0.7, t < 0.5 ? FLAME.big : FLAME.small, { o: STATUS_COLORS.brn, y: "#ffd34d", w: WHITE });
    });
  },
  psn(ctx, b, phase, seg, color = STATUS_COLORS.psn) {
    [-28, -18, -8, 2, 12, 22, 30].forEach((dx, k) => {
      const t = cycle(phase, k, 7);
      cells(ctx, b.cx + dx, b.floor - 6 - t * b.h * 0.8, BUBBLE, { p: color, w: WHITE });
    });
  },
  tox(ctx, b, phase, seg) {
    DRAW.psn(ctx, b, phase, seg, STATUS_COLORS.tox);
  },
  par(ctx, b, phase) {
    const mid = (b.top + b.floor) / 2;
    for (let k = 0; k < 4; k++) {
      if ((k + Math.floor(phase * 8)) % 2) continue; // sparks flicker
      const a = (k * Math.PI) / 2 + phase * Math.PI;
      cells(ctx, b.cx + Math.cos(a) * b.w * 0.45, mid + Math.sin(a) * b.h * 0.38, BOLT, { y: STATUS_COLORS.par });
    }
  },
  slp(ctx, b, phase) {
    for (let k = 0; k < 3; k++) {
      const t = cycle(phase, k, 3);
      cells(ctx, b.cx + 14 + t * 22, b.top + 14 - t * 30, ZED, { z: STATUS_COLORS.slp });
    }
  },
  frz(ctx, b, phase) {
    const mid = (b.top + b.floor) / 2;
    const pal = { w: WHITE, i: STATUS_COLORS.frz };
    if (phase < 0.5) {
      // The burst: shards flying out from the middle.
      const r = 8 + phase * 2 * Math.min(b.w, b.h) * 0.45;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        cells(ctx, b.cx + Math.cos(a) * r, mid + Math.sin(a) * r * 0.8, SHARD, pal);
      }
    } else {
      // Then crystals glint around the frozen Pokémon.
      const glint = Math.floor(phase * 8) % 2;
      [[-0.4, -0.3], [0.38, -0.1], [-0.3, 0.32], [0.3, 0.36], [0, -0.42]].forEach(([fx, fy], k) => {
        if ((k + glint) % 2) cells(ctx, b.cx + fx * b.w, mid + fy * b.h, SHARD, pal);
      });
    }
  },
  confusion(ctx, b, phase) {
    for (let k = 0; k < 3; k++) {
      const a = phase * Math.PI * 2 + (k * Math.PI * 2) / 3;
      cells(ctx, b.cx + Math.cos(a) * 26, b.top + 4 + Math.sin(a) * 8, STAR, { s: EFFECT_COLORS.confusion });
    }
  },
  leechseed(ctx, b, phase, seg) {
    const grass = EFFECT_COLORS.leechseed;
    // Sprouts grow on the target...
    const grown = Math.min(3, 1 + Math.floor(phase * 4));
    [-20, 0, 20].forEach((dx) => {
      for (let j = 0; j < grown; j++) cells(ctx, b.cx + dx, b.floor - 4 - j * U * 2, ["g"], { g: grass });
      cells(ctx, b.cx + dx, b.floor - 4 - grown * U * 2, ["g.g"], { g: grass });
    });
    // ...and orbs fly toward the seeder's row (below the top row, above the bottom one).
    const dir = seg.side === 0 ? 1 : -1;
    const mid = (b.top + b.floor) / 2;
    for (let k = 0; k < 4; k++) {
      const t = cycle(phase, k, 4);
      cells(ctx, b.cx + (k - 1.5) * 14, mid + dir * t * (b.h / 2 + 18), ORB, { g: grass, w: WHITE });
    }
  },
  stats(ctx, b, phase, seg) {
    const marks = seg.up && seg.down ? ["up", "down", "up"] : [seg.up ? "up" : "down", seg.up ? "up" : "down", seg.up ? "up" : "down"];
    [-24, 0, 24].forEach((dx, k) => {
      const t = cycle(phase, k, 3);
      const up = marks[k] === "up";
      const y = up ? b.floor - 8 - t * (b.h - 16) : b.top + 8 + t * (b.h - 16);
      cells(ctx, b.cx + dx, y, up ? CHEVRON_UP : CHEVRON_DOWN, { c: up ? CHIP_COLORS.up : CHIP_COLORS.down });
    });
    if (seg.pop && phase >= 0.15) {
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      const y = Math.round(b.top - 6 - Math.min(1, phase * 2) * 4);
      ctx.strokeText(seg.pop, b.cx, y);
      ctx.fillStyle = seg.up ? CHIP_COLORS.up : CHIP_COLORS.down;
      ctx.fillText(seg.pop, b.cx, y);
    }
  },
  cure(ctx, b, phase) {
    const mid = (b.top + b.floor) / 2;
    [[-0.42, -0.25], [0.4, -0.35], [-0.35, 0.3], [0.42, 0.25]].forEach(([fx, fy], k) => {
      const s = Math.round(Math.abs(Math.sin((phase + k / 4) * Math.PI)) * 2);
      const arm = "s".repeat(s * 2 + 1), dot = `${".".repeat(s)}s${".".repeat(s)}`;
      const rows = Array.from({ length: s * 2 + 1 }, (_, j) => (j === s ? arm : dot));
      cells(ctx, b.cx + fx * b.w, mid + fy * b.h, rows, { s: EFFECT_COLORS.cure });
    });
  },
};

/** Draws a beat's effect over the Pokémon (seg: the timeline's beat, or { fx, up, down, pop, side }). */
export function drawEffect(ctx, seg, box, phase) {
  DRAW[seg.fx]?.(ctx, box, Math.max(0, Math.min(0.999, phase)), seg);
}

/** The sprite tinted toward `color`, its shape (alpha) unchanged. */
export function tinted(image, color, alpha) {
  const c = createCanvas(image.width, image.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, image.width, image.height);
  return c;
}

/** The sprite's tint at this point of the beat: ice blue while frozen, an early orange flash for a burn. */
export function tintAt(seg, phase) {
  if (seg.fx === "frz") return { color: STATUS_COLORS.frz, alpha: 0.45 };
  if (seg.fx === "brn") return { color: STATUS_COLORS.brn, alpha: Math.round(50 * Math.max(0, 1 - Math.abs(phase - 0.3) / 0.25)) / 100 };
  return null;
}

/** Paralysis shakes the sprite 2 px one way, then the other; nothing else moves it. */
export const jitterAt = (seg, phase) => (seg.fx === "par" ? (Math.floor(phase * 8) % 2 ? 2 : -2) : 0);
