// utils/trainerCardCanvas.js
import { createCanvas, loadImage } from "@napi-rs/canvas";
import path from "path";

const TIER_COLORS = {
  common: "#9ca3af",
  uncommon: "#10b981",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#facc15",
  mythic: "#ef4444",
};

function normTier(t) {
  return String(t || "common").toLowerCase();
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

// Build canonical lookup: sprite filename -> { key, tier }
export function buildSpriteToTrainerMap(trainerSprites) {
  const map = new Map();

  for (const [key, entry] of Object.entries(trainerSprites || {})) {
    const tier = String(entry?.tier || "common");

    if (!Array.isArray(entry?.sprites)) continue;

    for (const s of entry.sprites) {
      // Only strings (you said you don't want {file: ...} entries)
      if (typeof s !== "string") continue;

      const filename = s.toLowerCase();
      const basename = filename.replace(/\.(png|gif)$/i, "");

      if (!map.has(filename)) map.set(filename, { key, tier });
      if (!map.has(basename)) map.set(basename, { key, tier });
    }
  }

  return map;
}

export async function renderTrainerCardCanvas({
  displayName,
  avatarUrl,
  trainerSpriteUrl,      // full URL/path to the trainer sprite
  trainerSpriteFileName, // e.g. "acerola-masters.png"
  spriteToTrainerMap,    // Map from buildSpriteToTrainerMap()
  team,                  // [{ id, name, tier, spriteUrl }]
}) {
  // Canvas sizing
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

  // Resolve trainer tier via canonical map
  const tFile = String(trainerSpriteFileName || "").toLowerCase();
  const tBare = tFile.replace(/\.(png|gif)$/i, "");
  const hit = spriteToTrainerMap?.get(tFile) || spriteToTrainerMap?.get(tBare);
  const trainerTierKey = normTier(hit?.tier || "common");
  const trainerTierColor = TIER_COLORS[trainerTierKey] || TIER_COLORS.common;

  // Header text (left)
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  drawCenteredText(ctx, "TRAINER", pad, pad + 44, leftW);

  // Avatar
  let avatarImg = null;
  try { avatarImg = await loadImage(avatarUrl); } catch {}
  const avatarCx = pad + leftW / 2;
  const avatarCy = pad + 105;
  if (avatarImg) drawCircleImage(ctx, avatarImg, avatarCx, avatarCy, 44);

  // Display name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  drawCenteredText(ctx, displayName, pad, pad + 180, leftW);

  // Trainer sprite
  let trainerImg = null;
  try { trainerImg = await loadImage(trainerSpriteUrl); } catch {}

  if (trainerImg) {
    const spriteMaxW = 260;
    const spriteMaxH = 220;

    // Fit within box
    const sw = trainerImg.width || 1;
    const sh = trainerImg.height || 1;
    const scale = Math.min(spriteMaxW / sw, spriteMaxH / sh);

    const dw = Math.floor(sw * scale);
    const dh = Math.floor(sh * scale);

    const dx = pad + Math.floor((leftW - dw) / 2);
    const dy = pad + 210;

    ctx.drawImage(trainerImg, dx, dy, dw, dh);

    // Tier badge under sprite
    const badgeW = 200;
    const badgeH = 38;
    const bx = pad + Math.floor((leftW - badgeW) / 2);
    const by = dy + dh + 16;

    ctx.fillStyle = trainerTierColor;
    roundRect(ctx, bx, by, badgeW, badgeH, 12);
    ctx.fill();

    ctx.fillStyle = "#0b1220";
    ctx.font = "bold 18px sans-serif";
    drawCenteredText(ctx, trainerTierKey.toUpperCase(), bx, by + 26, badgeW);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "18px sans-serif";
    drawCenteredText(ctx, "Trainer sprite failed to load", pad, pad + 320, leftW);
  }

  // Right side: Team grid (2x3)
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("TEAM", rightX + 18, pad + 44);

  const cols = 3;
  const rows = 2;
  const gap = 16;

  const gridTop = pad + 72;
  const tileW = Math.floor((rightW - 18 * 2 - gap * (cols - 1)) / cols);
  const tileH = Math.floor((H - pad * 2 - gridTop + pad - gap * (rows - 1)) / rows);

  for (let i = 0; i < cols * rows; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;

    const x = rightX + 18 + c * (tileW + gap);
    const y = gridTop + r * (tileH + gap);

    // tile bg
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x, y, tileW, tileH, 16);
    ctx.fill();

    const p = team[i];
    if (!p) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "18px sans-serif";
      ctx.fillText("Empty", x + 14, y + 30);
      continue;
    }

    const tierKey = normTier(p.tier);
    const tierColor = TIER_COLORS[tierKey] || TIER_COLORS.common;

    // tier badge
    ctx.fillStyle = tierColor;
    roundRect(ctx, x + 12, y + 12, 110, 30, 10);
    ctx.fill();

    ctx.fillStyle = "#0b1220";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(tierKey.toUpperCase(), x + 20, y + 33);

    // sprite
    try {
      const img = await loadImage(p.spriteUrl);
      ctx.drawImage(img, x + 14, y + 50, 86, 86);
    } catch {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "14px sans-serif";
      ctx.fillText("Sprite failed", x + 14, y + 95);
    }

    // name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(p.name, x + 110, y + 88);

    // id
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "16px sans-serif";
    ctx.fillText(`#${p.id}`, x + 110, y + 112);
  }

  return canvas.toBuffer("image/png");
}
