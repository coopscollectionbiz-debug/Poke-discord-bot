// ==========================================================
// utils/render/primitives.js
// Reusable drawing pieces for Discord images: background, cards, type chips,
// tier pips, the shiny sparkle, level tags, EXP bars, battle platforms.
// Every piece takes explicit coordinates and returns its drawn width where
// that helps layout; none reads game state.
// ==========================================================

import { COLOR, FONT, RADIUS, TIER_PIPS, tierColor, typeStyle } from "./tokens.js";

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export const font = (size, weight = 600) => `${weight} ${size}px ${FONT}`;

/** Truncates with an ellipsis to fit maxWidth in the current font. */
export function fitText(ctx, text, maxWidth) {
  const s = String(text ?? "");
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo).trimEnd()}…`;
}

/** Largest size (from `size` down to `min`) at which text fits; then truncates. */
export function fitFont(ctx, text, maxWidth, size, min, weight = 700) {
  for (let s = size; s >= min; s -= 1) {
    ctx.font = font(s, weight);
    if (ctx.measureText(text).width <= maxWidth) return { text, size: s };
  }
  ctx.font = font(min, weight);
  return { text: fitText(ctx, text, maxWidth), size: min };
}

/** The battle background: the night-sky gradient with a soft floor glow. */
export function drawBackground(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, COLOR.bgTop);
  bg.addColorStop(1, COLOR.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h * 1.1, 10, w / 2, h * 1.1, h);
  glow.addColorStop(0, "#4f8cff18");
  glow.addColorStop(1, "#4f8cff00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/** A card: filled surface, 1 px hairline, optional accent ring and drop shadow. */
export function drawCard(ctx, x, y, w, h, { fill = COLOR.surface, stroke = COLOR.line, ring = null, radius = RADIUS.md, shadow = true } = {}) {
  if (shadow) {
    ctx.save();
    ctx.shadowColor = "#00000066";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = fill;
    rr(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = fill;
    rr(ctx, x, y, w, h, radius);
    ctx.fill();
  }
  ctx.lineWidth = ring ? 3 : 1.5;
  ctx.strokeStyle = ring ?? stroke;
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
  ctx.stroke();
}

/** A type chip ("FIRE"); returns its width. */
export function drawTypeChip(ctx, type, x, y, { h = 30, size = 17 } = {}) {
  const st = typeStyle(type);
  ctx.font = font(size, 800);
  const label = String(type ?? "???").toUpperCase();
  const w = Math.ceil(ctx.measureText(label).width) + h * 0.9;
  ctx.fillStyle = st.fill;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff30"; // top sheen, as on the battle HP bar
  rr(ctx, x + 3, y + 2, w - 6, h * 0.36, h * 0.18);
  ctx.fill();
  ctx.fillStyle = st.text;
  ctx.textAlign = "center";
  fillTextMid(ctx, label, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  return w;
}

/** Chips for one or two types, left to right; returns total width. */
export function drawTypeChips(ctx, types, x, y, opts = {}) {
  const gap = opts.gap ?? 8;
  let cx = x;
  for (const t of types) cx += drawTypeChip(ctx, t, cx, y, opts) + gap;
  return cx - x - gap;
}

/** Measured width of drawTypeChips without drawing. */
export function typeChipsWidth(ctx, types, { h = 30, size = 17, gap = 8 } = {}) {
  ctx.font = font(size, 800);
  return types.reduce((w, t) => w + Math.ceil(ctx.measureText(String(t).toUpperCase()).width) + h * 0.9, 0) + gap * Math.max(0, types.length - 1);
}

/** Tier pips: filled diamonds in the tier color (1 common … 6 mythic). */
export function drawTierPips(ctx, tier, x, cy, { size = 7, gap = 5 } = {}) {
  const n = TIER_PIPS[String(tier || "").toLowerCase()] ?? 1;
  ctx.fillStyle = tierColor(tier);
  for (let i = 0; i < n; i++) {
    const px = x + size + i * (size * 2 + gap);
    ctx.beginPath();
    ctx.moveTo(px, cy - size);
    ctx.lineTo(px + size, cy);
    ctx.lineTo(px, cy + size);
    ctx.lineTo(px - size, cy);
    ctx.closePath();
    ctx.fill();
  }
  return n * (size * 2 + gap) - gap;
}

/** A four-point sparkle (vector, so it renders without emoji fonts). */
export function drawSparkle(ctx, cx, cy, r, color = COLOR.gold) {
  ctx.fillStyle = color;
  ctx.beginPath();
  const k = r * 0.28;
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  ctx.fill();
}

/** The shiny mark: a large and a small sparkle. */
export function drawShinyMark(ctx, cx, cy, r = 12) {
  drawSparkle(ctx, cx, cy, r);
  drawSparkle(ctx, cx + r * 0.95, cy - r * 0.8, r * 0.45);
}

/** "Lv 42" — the label small, the number large; returns width. Anchored left. */
export function drawLevel(ctx, level, x, baseline, { size = 26, color = COLOR.text } = {}) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(Math.round(size * 0.62), 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("Lv", x, baseline);
  const lw = ctx.measureText("Lv").width + 4;
  ctx.font = font(size, 800);
  ctx.fillStyle = color;
  ctx.fillText(String(level), x + lw, baseline);
  return lw + ctx.measureText(String(level)).width;
}

export function levelWidth(ctx, level, size = 26) {
  ctx.font = font(Math.round(size * 0.62), 800);
  const lw = ctx.measureText("Lv").width + 4;
  ctx.font = font(size, 800);
  return lw + ctx.measureText(String(level)).width;
}

/** EXP progress bar in the games' blue (frac 0..1). */
export function drawExpBar(ctx, x, y, w, frac, { h = 8 } = {}) {
  ctx.fillStyle = COLOR.surfaceSunken;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    ctx.fillStyle = COLOR.exp;
    rr(ctx, x, y, Math.max(h, w * f), h, h / 2);
    ctx.fill();
  }
}

/**
 * Fills text with its capitals centred on cy: pill, chip and badge labels.
 * (textBaseline "middle" centres the em box, which leaves capitals sitting
 * low.) Keeps textAlign; leaves textBaseline "alphabetic".
 */
export function fillTextMid(ctx, text, x, cy) {
  ctx.textBaseline = "alphabetic";
  const cap = ctx.measureText("H").actualBoundingBoxAscent;
  ctx.fillText(text, x, cy + cap / 2);
}

/** A round slot badge with the slot number (1–6). */
export function drawSlotBadge(ctx, n, cx, cy, { r = 17, lead = false } = {}) {
  ctx.fillStyle = lead ? COLOR.blue : COLOR.surfaceSunken;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = lead ? COLOR.blue : COLOR.line;
  ctx.stroke();
  ctx.fillStyle = lead ? "#ffffff" : COLOR.textMuted;
  ctx.font = font(Math.round(r * 1.05), 800);
  ctx.textAlign = "center";
  fillTextMid(ctx, String(n), cx, cy);
  ctx.textAlign = "left";
}

/** The battle platform ellipse, optionally lit in an accent color. */
export function drawPlatform(ctx, cx, cy, rx, ry, accent = null) {
  if (accent) {
    const glow = ctx.createRadialGradient(cx, cy - ry * 3, 4, cx, cy - ry * 3, rx * 1.3);
    glow.addColorStop(0, `${accent}44`);
    glow.addColorStop(1, `${accent}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy - ry * 3, rx * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = accent ? `${accent}66` : "#ffffff14";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent ? `${accent}cc` : "#ffffff22";
  ctx.stroke();
}

/** Poké Ball icon (battle nameplate style): filled when the slot is used. */
export function drawBall(ctx, cx, cy, r, filled) {
  ctx.lineWidth = Math.max(1.5, r / 4);
  ctx.strokeStyle = COLOR.ink;
  ctx.fillStyle = filled ? "#f4f4f4" : "#3a4256";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  if (filled) {
    ctx.fillStyle = "#e5483d";
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = filled ? "#f4f4f4" : "#3a4256";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** A small rounded tag ("LEAD", "SHINY"); returns width. */
export function drawTag(ctx, text, x, y, { fill = COLOR.gold, color = COLOR.ink, h = 26, size = 15 } = {}) {
  ctx.font = font(size, 800);
  const w = Math.ceil(ctx.measureText(text).width) + h;
  ctx.fillStyle = fill;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  fillTextMid(ctx, text, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  return w;
}

// The games' "!" over a Trainer who has spotted the player, as 16 × 16 pixel
// art: o outline, w bubble, x mark, . clear. Drawn at a whole scale with hard
// edges, like the Badges.
export const ALERT_BUBBLE = [
  "................",
  "..oooooooooooo..",
  ".owwwwwwwwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwwwwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwxxwwwwwo.",
  ".owwwwwwwwwwwwo.",
  "..ooooowwooooo..",
  "......owwo......",
  ".......oo.......",
];
const ALERT_COLORS = { o: COLOR.ink, w: "#ffffff", x: COLOR.ink };

export function drawAlertBubble(ctx, x, y, scale) {
  for (const [row, line] of ALERT_BUBBLE.entries()) {
    for (const [col, ch] of [...line].entries()) {
      if (ch === ".") continue;
      ctx.fillStyle = ALERT_COLORS[ch];
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
}

/**
 * The MEGA indicator, one look on every image (Mega colour, ink text). Drawn
 * only for a slot that really is a Mega (teamView/megaDisplay decide).
 * `align: "right"` makes x the right edge. Returns the tag width.
 */
export function drawMegaTag(ctx, x, y, { h = 26, size = 15, align = "left", muted = false } = {}) {
  ctx.font = font(size, 800);
  const w = Math.ceil(ctx.measureText("MEGA").width) + h;
  drawTag(ctx, "MEGA", align === "right" ? x - w : x, y, { fill: muted ? "#7d8396" : COLOR.mega, color: COLOR.ink, h, size });
  return w;
}

/** National Pokédex number as shown on every card: "#0613". */
export const dexNo = (id) => `#${String(Number(id)).padStart(4, "0")}`;
