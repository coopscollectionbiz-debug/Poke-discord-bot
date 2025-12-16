// utils/trainerCardCanvas.js
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { rarityEmojis } from "../spriteconfig.js";

const TIER_COLORS = {
  common: "#9ca3af",
  uncommon: "#10b981",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#facc15",
  mythic: "#ef4444",
};

// Softer + symbol-friendly fonts on Linux/Render
const FONT_STACK =
  "ui-rounded, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'DejaVu Sans', 'Noto Sans', Arial, sans-serif";

const SAFE_RARITY = {
  common: "•",
  uncommon: "✦",
  rare: "★",
  epic: "✮✮",
  legendary: "✮✮✮",
  mythic: "✮✮✮✮",
};

function normTier(t) {
  return String(t || "common").toLowerCase();
}

// Strip variation selectors that can render as tofu boxes on canvas fonts
function stripVariationSelectors(s) {
  return String(s || "").replace(/[\uFE0E\uFE0F]/g, "");
}

function getTierMark(tierKey) {
  const raw = rarityEmojis?.[tierKey] ?? SAFE_RARITY[tierKey] ?? "";
  const cleaned = stripVariationSelectors(raw).trim();
  return cleaned || SAFE_RARITY[tierKey] || "";
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCenteredText(ctx, text, x, y, maxWidth) {
  const m = ctx.measureText(text);
  const tx = x + (maxWidth - m.width) / 2;
  ctx.fillText(text, tx, y);
}

function drawCircleImage(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

// Keep aspect ratio (prevents "squished" sprites)
function drawImageContain(ctx, img, x, y, boxW, boxH) {
  const sw = img.width || 1;
  const sh = img.height || 1;

  const scale = Math.min(boxW / sw, boxH / sh);
  const dw = Math.floor(sw * scale);
  const dh = Math.floor(sh * scale);

  const dx = x + Math.floor((boxW - dw) / 2);
  const dy = y + Math.floor((boxH - dh) / 2);

  ctx.drawImage(img, dx, dy, dw, dh);
}

// Stack multiple centered lines with proper spacing
function drawStackedCenteredText(ctx, lines, x, startY, maxWidth, lineGap = 6) {
  let y = startY;
  for (const { text, font, color } of lines) {
    ctx.font = font;
    ctx.fillStyle = color;

    const m = ctx.measureText(text);
    const tx = x + (maxWidth - m.width) / 2;

    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, tx, y);

    y += (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + lineGap;
  }
}

/**
 * Loads sprites reliably:
 * - If url ends with .gif, try .png first (canvas-friendly), then fallback to .gif
 * - Otherwise load directly
 */
async function loadSprite(url) {
  if (!url) throw new Error("Missing sprite URL");

  if (url.toLowerCase().endsWith(".gif")) {
    const png = url.replace(/\.gif$/i, ".png");
    try {
      return await loadImage(png);
    } catch {
      return await loadImage(url);
    }
  }

  return await loadImage(url);
}

/**
 * Draw a badge where the text is PERFECTLY centered (both axes),
 * and the width auto-sizes to the text (with optional cap).
 */
function drawCenteredBadge(
  ctx,
  {
    x,
    y,
    text,
    font = `600 16px ${FONT_STACK}`,
    bgColor,
    textColor = "#0b1220",
    paddingX = 14,
    height = 30,
    radius = 10,
    maxWidth = Infinity,
  }
) {
  ctx.font = font;

  const metrics = ctx.measureText(text);
  const textW = metrics.width;

  const badgeW = Math.min(Math.ceil(textW + paddingX * 2), maxWidth);

  ctx.fillStyle = bgColor;
  roundRect(ctx, x, y, badgeW, height, radius);
  ctx.fill();

  const textX = x + (badgeW - textW) / 2;
  const textY =
    y +
    height / 2 +
    (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;

  ctx.fillStyle = textColor;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, textX, textY);

  return badgeW;
}

// Build canonical lookup: sprite filename -> { key, tier }
export function buildSpriteToTrainerMap(trainerSprites) {
  const map = new Map();

  for (const [key, entry] of Object.entries(trainerSprites || {})) {
    const tier = String(entry?.tier || "common");

    if (!Array.isArray(entry?.sprites)) continue;

    for (const s of entry.sprites) {
      if (typeof s !== "string") continue;

      const filename = s.toLowerCase(); // "acerola-masters.png"
      const basename = filename.replace(/\.(png|gif)$/i, ""); // "acerola-masters"

      if (!map.has(filename)) map.set(filename, { key, tier });
      if (!map.has(basename)) map.set(basename, { key, tier });
    }
  }

  return map;
}

export async function renderTrainerCardCanvas({
  displayName,
  avatarUrl,

  // replaces "TRAINER" above avatar
  rankLabel, // string (already computed in command)
  tp, // number

  trainerSpriteUrl,
  trainerSpriteFileName,
  spriteToTrainerMap,
  team, // [{ id, name, tier, spriteUrl, isShiny }]
}) {
  const W = 1200;
  const H = 520;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  // Panels
  const pad = 24;
  const leftW = 380;
  const rightX = pad + leftW + 18;
  const rightW = W - rightX - pad;

  // Left panel bg
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, pad, pad, leftW, H - pad * 2, 20);
  ctx.fill();

  // Right panel bg
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, rightX, pad, rightW, H - pad * 2, 20);
  ctx.fill();

  // Resolve trainer tier via canonical map (sprite filename -> tier)
  const tFile = String(trainerSpriteFileName || "").toLowerCase();
  const tBare = tFile.replace(/\.(png|gif)$/i, "");
  const hit = spriteToTrainerMap?.get(tFile) || spriteToTrainerMap?.get(tBare);

  const trainerTierKey = normTier(hit?.tier || "common");
  const trainerTierColor = TIER_COLORS[trainerTierKey] || TIER_COLORS.common;
  const trainerTierEmoji = getTierMark(trainerTierKey);

  // ======= Rank + TP (centered above avatar) =======
  const safeRank = (rankLabel ? String(rankLabel) : "RANK").toUpperCase();
  const safeTp = Number.isFinite(tp) ? Math.floor(tp) : 0;

  drawStackedCenteredText(
    ctx,
    [
      { text: safeRank, font: `600 26px ${FONT_STACK}`, color: "#ffffff" },
      {
        text: `TP: ${safeTp.toLocaleString()}`,
        font: `500 18px ${FONT_STACK}`,
        color: "rgba(255,255,255,0.85)",
      },
    ],
    pad,
    pad + 48,
    leftW,
    4
  );

  // Avatar
  let avatarImg = null;
  try {
    avatarImg = await loadSprite(avatarUrl);
  } catch {}

  const avatarCx = pad + leftW / 2;
  const avatarCy = pad + 128;
  if (avatarImg) drawCircleImage(ctx, avatarImg, avatarCx, avatarCy, 44);

  // Display name
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 26px ${FONT_STACK}`;
  drawCenteredText(ctx, displayName, pad, pad + 210, leftW);

  // Trainer sprite
  let trainerImg = null;
  try {
    trainerImg = await loadSprite(trainerSpriteUrl);
  } catch {}

  if (trainerImg) {
    const spriteMaxW = 260;
    const spriteMaxH = 220;

    const sw = trainerImg.width || 1;
    const sh = trainerImg.height || 1;
    const scale = Math.min(spriteMaxW / sw, spriteMaxH / sh);

    const dw = Math.floor(sw * scale);
    const dh = Math.floor(sh * scale);

    const dx = pad + Math.floor((leftW - dw) / 2);
    const dy = pad + 240;

    ctx.drawImage(trainerImg, dx, dy, dw, dh);

    // Tier badge under sprite (centered + never clipped)
const badgeH = 38;
const trainerBadgeText = `${trainerTierEmoji} ${trainerTierKey.toUpperCase()}`.trim();

// Measure first so we can center the badge perfectly
ctx.font = `600 18px ${FONT_STACK}`;
const m = ctx.measureText(trainerBadgeText);
const paddingX = 14;
const badgeW = Math.min(Math.ceil(m.width + paddingX * 2), leftW - 40);

// Center horizontally in left panel
const bx = pad + Math.floor((leftW - badgeW) / 2);

// Clamp vertically so it never goes below the panel
const panelTop = pad;
const panelBottom = H - pad;
const maxBy = panelBottom - badgeH - 12;

let by = dy + dh + 14;
if (by > maxBy) by = maxBy;

// Draw the badge (uses your perfect centering function)
drawCenteredBadge(ctx, {
  x: bx,
  y: by,
  text: trainerBadgeText,
  font: `600 18px ${FONT_STACK}`,
  bgColor: trainerTierColor,
  height: badgeH,
  radius: 12,
  maxWidth: leftW - 40,
});

  } else {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `500 18px ${FONT_STACK}`;
    drawCenteredText(ctx, "Trainer sprite failed to load", pad, pad + 340, leftW);
  }

  // Right side: Team grid (2x3)
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 26px ${FONT_STACK}`;
  ctx.fillText("TEAM", rightX + 18, pad + 44);

  const cols = 3;
  const rows = 2;
  const gap = 16;

  const gridTop = pad + 72;
  const tileW = Math.floor((rightW - 18 * 2 - gap * (cols - 1)) / cols);
  const tileH = Math.floor((H - pad * 2 - gridTop + pad - gap * (rows - 1)) / rows);

  for (let i = 0; i < cols * rows; i++) {
    const rr = Math.floor(i / cols);
    const cc = i % cols;

    const x = rightX + 18 + cc * (tileW + gap);
    const y = gridTop + rr * (tileH + gap);

    // tile bg
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x, y, tileW, tileH, 16);
    ctx.fill();

    const p = team?.[i];
    if (!p) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = `500 18px ${FONT_STACK}`;
      ctx.fillText("Empty", x + 14, y + 30);
      continue;
    }

    const tierKey = normTier(p.tier);
    const tierColor = TIER_COLORS[tierKey] || TIER_COLORS.common;
    const tierEmoji = getTierMark(tierKey);

    // tier badge (emoji + perfectly centered)
    const badgeText = `${tierEmoji} ${tierKey.toUpperCase()}`.trim();
    drawCenteredBadge(ctx, {
      x: x + 12,
      y: y + 12,
      text: badgeText,
      font: `600 16px ${FONT_STACK}`,
      bgColor: tierColor,
      height: 30,
      radius: 10,
      maxWidth: tileW - 24,
    });

    // sprite (aspect-ratio preserved)
    try {
      const img = await loadSprite(p.spriteUrl);
      drawImageContain(ctx, img, x + 14, y + 50, 86, 86);
    } catch {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = `500 14px ${FONT_STACK}`;
      ctx.fillText("Sprite failed", x + 14, y + 95);
    }

    // name
ctx.fillStyle = "rgba(255,255,255,0.92)";
ctx.font = `600 18px ${FONT_STACK}`;
ctx.fillText(p.name, x + 110, y + 88);


    // id
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `500 16px ${FONT_STACK}`;
    ctx.fillText(`#${p.id}`, x + 110, y + 112);
  }

  return canvas.toBuffer("image/png");
}
