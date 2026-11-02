// ==========================================================
// utils/battle/render.js
// One PNG frame of a Battle: both Teams with HP bars. Playback edits the
// message with a few of these at evenly spaced turns.
// ==========================================================

import { createCanvas, loadImage } from "@napi-rs/canvas";

const FONT = "system-ui, 'DejaVu Sans', 'Noto Sans', Arial, sans-serif";
const SPRITES = new URL("../../public/sprites/pokemon/", import.meta.url);
const W = 900;
const ROW_H = 150;
const TILE_W = W / 6;

export function pickFrameTurns(totalTurns, frames) {
  const turns = Array.from({ length: frames }, (_, i) => Math.max(1, Math.round((totalTurns * (i + 1)) / frames)));
  return [...new Set(turns)];
}

async function sprite(cache, folder, id) {
  const key = `${folder}/${id}`;
  if (!cache.has(key)) {
    cache.set(key, await loadImage(new URL(`${folder}/${id}.gif`, SPRITES).pathname).catch(() => null));
  }
  return cache.get(key);
}

const hpColor = (f) => (f > 0.5 ? "#4caf50" : f > 0.2 ? "#ffc107" : "#f44336");

export async function renderBattleFrame({ sides, hp, caption = "", surgeSide = null }) {
  const H = 40 + ROW_H * 2 + 36;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e2230";
  ctx.fillRect(0, 0, W, H);
  const cache = new Map();

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 22px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`${sides[0].name}  vs  ${sides[1].name}`, W / 2, 28);

  for (let s = 0; s < 2; s++) {
    const top = 40 + s * ROW_H;
    if (surgeSide === s) {
      ctx.strokeStyle = "#ff9800";
      ctx.lineWidth = 3;
      ctx.strokeRect(4, top + 2, W - 8, ROW_H - 4);
      ctx.fillStyle = "#ff9800";
      ctx.font = `700 13px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText("UNDERDOG SURGE", 12, top + 18);
    }
    for (let i = 0; i < sides[s].members.length; i++) {
      const m = sides[s].members[i];
      const x = i * TILE_W;
      const frac = hp[s][i] ?? 0;
      const img = await sprite(cache, frac <= 0 ? "grayscale" : m.variant, m.speciesId);
      if (img) {
        const scale = Math.min(80 / img.width, 80 / img.height);
        ctx.globalAlpha = frac <= 0 ? 0.5 : 1;
        ctx.drawImage(img, x + (TILE_W - img.width * scale) / 2, top + 22, img.width * scale, img.height * scale);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#3a3f52";
      ctx.fillRect(x + 15, top + 108, TILE_W - 30, 10);
      ctx.fillStyle = hpColor(frac);
      ctx.fillRect(x + 15, top + 108, (TILE_W - 30) * frac, 10);
      ctx.fillStyle = frac <= 0 ? "#888888" : "#dddddd";
      ctx.font = `600 14px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(frac <= 0 ? "Fainted" : `Lv ${m.level}`, x + TILE_W / 2, top + 138);
    }
  }

  ctx.fillStyle = "#aab0c0";
  ctx.font = `500 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(caption, W / 2, H - 12);
  return canvas.toBuffer("image/png");
}
