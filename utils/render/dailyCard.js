// ==========================================================
// utils/render/dailyCard.js
// /daily as one image instead of three embeds: the two Pokémon (each as a
// catch tile: sprite, Level, types, rarity, NEW or +EXP), then CC, TP, an
// Evolution Stone when one dropped, the new balances, and a rank-up tag
// when the TP crossed a rank. Each Pokémon's facts come from catchView()
// (grantCatch's own result). Read-only.
// ==========================================================

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitFont, drawTypeChips, typeChipsWidth, drawShinyMark, drawLevel, drawTag, dexNo, fillTextMid, drawSoftPlatform } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { spriteStage } from "./stage.js";
import { drawDexProgress } from "./dexProgress.js";

export const DAILY_SIZE = Object.freeze({ w: 1000, h: 600 });
const DEX_H = 68;
/** Card size: the Pokédex strip (v.dex) adds a row. */
export const dailySize = (v) => ({ w: DAILY_SIZE.w, h: DAILY_SIZE.h + (v?.dex?.length ? DEX_H + 12 : 0) });
const M = 16, TILE_Y = 104, TILE_H = 330;
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const ITEMS = new URL("../../public/sprites/items/", import.meta.url);
const icon = (file) => loadImage(fileURLToPath(new URL(file, ITEMS))).catch(() => null);

async function tile(ctx, p, x, w, stage) {
  const y = TILE_Y, accent = p.shiny ? COLOR.gold : tierColor(p.tier);
  ctx.fillStyle = "#1a2135";
  rr(ctx, x, y, w, TILE_H, 16);
  ctx.fill();
  ctx.lineWidth = p.shiny ? 3 : 1.5;
  ctx.strokeStyle = p.shiny ? COLOR.gold : "#323c5c";
  ctx.stroke();
  // Stage.
  const cx = x + w / 2, floor = y + 190;
  ctx.save();
  rr(ctx, x, y, w, TILE_H, 16);
  ctx.clip();
  const spot = ctx.createRadialGradient(cx, floor - 80, 8, cx, floor - 80, 200);
  spot.addColorStop(0, `${accent}2a`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(x, y, w, TILE_H);
  ctx.restore();
  // The floor: a dithered pixel platform, like the floors under Pokémon in battle.
  drawSoftPlatform(ctx, cx, floor, 100, 18, accent, { u: 4, peak: 0.6 });
  const sprite = (await loadStaticSprite(p.id, p.variant)) ?? (await loadPlaceholder());
  stage.place(ctx, sprite, cx, floor + 6, w - 40, 150, { scale: 3 }, { id: p.id, variant: p.variant });

  // Rarity pill (top right) and NEW / +EXP (top left).
  const label = (TIER_NAME[p.tier] ?? "Common").toUpperCase();
  ctx.font = font(16, 800);
  const pw = ctx.measureText(label).width + 28;
  ctx.fillStyle = "#101626";
  rr(ctx, x + w - 14 - pw, y + 14, pw, 28, 14);
  ctx.fill();
  ctx.fillStyle = `${tierColor(p.tier)}22`;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${tierColor(p.tier)}aa`;
  ctx.stroke();
  ctx.fillStyle = TIER[p.tier] ?? tierColor(p.tier);
  fillTextMid(ctx, label, x + w - 14 - pw + 14, y + 28);
  const tw = p.isNew
    ? drawTag(ctx, "NEW", x + 14, y + 14, { fill: COLOR.blue, color: "#ffffff", h: 28, size: 15 })
    : drawTag(ctx, `+${fmt(p.expGained)} EXP`, x + 14, y + 14, { fill: "#16314f", color: COLOR.exp, h: 28, size: 15 });
  // National Pokédex number after the NEW / +EXP tag.
  ctx.font = font(17, 800);
  ctx.fillStyle = COLOR.textMuted;
  fillTextMid(ctx, dexNo(p.id), x + 14 + tw + 12, y + 28); // level with the tag beside it

  // Name, then Level + types.
  const nm = fitFont(ctx, p.name, w - 40 - (p.shiny ? 30 : 0), 36, 24, 800);
  ctx.font = font(nm.size, 800);
  const nw = ctx.measureText(nm.text).width;
  const nx = cx - (nw + (p.shiny ? 30 : 0)) / 2;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.fillText(nm.text, nx, y + 252);
  if (p.shiny) drawShinyMark(ctx, nx + nw + 18, y + 252 - nm.size * 0.32, 11);
  ctx.font = font(17, 800);
  const lvW = ctx.measureText("Lv").width + 4 + (ctx.font = font(28, 800), ctx.measureText(String(p.level)).width);
  const chip = { h: 32, size: 17, gap: 8 };
  const rowW = lvW + 14 + typeChipsWidth(ctx, p.types, chip);
  const rx = cx - rowW / 2;
  drawLevel(ctx, p.level, rx, y + 302, { size: 28 });
  drawTypeChips(ctx, p.types, rx + lvW + 14, y + 278, chip);
}

async function reward(ctx, img, value, label, x, y) {
  if (img) {
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(44 / img.width, 44 / img.height);
    ctx.drawImage(img, x, y + 4, img.width * s, img.height * s);
    ctx.imageSmoothingEnabled = true;
  }
  ctx.font = font(30, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(value, x + 56, y + 30);
  const vw = ctx.measureText(value).width;
  ctx.font = font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(label, x + 56, y + 52);
  return 56 + Math.max(vw, ctx.measureText(label).width) + 36;
}

/**
 * @param v { pokemon: [catchView, catchView], cc, tp, stone, balance: { cc, tp }, rankUp: string|null, note }
 */
export async function renderDailyCard(v, { animate = false } = {}) {
  const { w: W, h: H } = dailySize(v);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "left";
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("DAILY REWARDS", M + 8, M + 26);
  ctx.font = font(38, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText("Daily claimed!", M + 8, M + 68);
  ctx.textAlign = "right";
  ctx.font = font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("Next claim after 00:00 UTC", W - M - 8, M + 68);
  ctx.textAlign = "left";
  if (v.rankUp) {
    const t = `RANK UP · ${v.rankUp.toUpperCase()}`;
    ctx.font = font(16, 800);
    drawTag(ctx, t, W - M - 8 - (Math.ceil(ctx.measureText(t).width) + 32), M + 8, { fill: COLOR.gold, color: COLOR.ink, h: 32, size: 16 });
  }

  const tw = (W - 2 * M - 14) / 2;
  for (const [i, p] of v.pokemon.slice(0, 2).entries()) await tile(ctx, p, M + i * (tw + 14), tw, stage);

  // Pokédex progress (private card, so it's shown here and never on the
  // public catch card): today's regions, then national.
  let sy = TILE_Y + TILE_H + 16;
  if (v.dex?.length) {
    ctx.fillStyle = "#151b2d";
    rr(ctx, M, sy, W - 2 * M, DEX_H, 16);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#323c5c";
    ctx.stroke();
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("POKÉDEX", M + 24, sy + 30);
    drawDexProgress(ctx, v.dex, M + 130, sy + 16, W - 2 * M - 130 - 24);
    sy += DEX_H + 12;
  }

  // Rewards strip.
  ctx.fillStyle = "#151b2d";
  rr(ctx, M, sy, W - 2 * M, H - sy - M, 16);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#323c5c";
  ctx.stroke();
  const [coin, tpIcon, stone] = await Promise.all([icon("cc_coin.png"), icon("tp_icon.png"), v.stone ? icon("evolution_stone.png") : null]);
  let x = M + 24;
  const y = sy + 26;
  x += await reward(ctx, coin, `+${fmt(v.cc)}`, "CC", x, y);
  x += await reward(ctx, tpIcon, `+${fmt(v.tp)}`, "TP", x, y);
  if (v.stone) x += await reward(ctx, stone, "+1", "Evolution Stone", x, y);

  ctx.textAlign = "right";
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("BALANCE", W - M - 24, y + 14);
  ctx.font = font(24, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(`${fmt(v.balance.cc)} CC`, W - M - 24, y + 44);
  ctx.font = font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(`${fmt(v.balance.tp)} TP`, W - M - 24, y + 68);
  ctx.textAlign = "left";
  return stage.output(canvas);
}
