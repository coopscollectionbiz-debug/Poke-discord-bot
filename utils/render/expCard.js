// ==========================================================
// utils/render/expCard.js
// The private post-battle EXP message as an image: win or loss, the
// player's new Battle rating, and each Team member's EXP gain, Level-up
// and newly learned moves. Reads runBattle's outcome (exp, rating, winner)
// and, for the EXP bars, the player's record after the battle was saved.
// Pure: never mutates either.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR } from "./tokens.js";
import { rr, font, fitText, fitFont, drawShinyMark, drawTag } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { getTraining } from "../training.js";
import { expProgress } from "./teamView.js";
import { displaySpeciesName } from "./names.js";

const W = 1000, HEADER = 126, TILE_H = 150, GAP = 12, M = 16;
export const expCardSize = (n) => ({ w: W, h: M + HEADER + Math.ceil(Math.max(1, n) / 2) * (TILE_H + GAP) - GAP + M });
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

/** One player's EXP view. `user` is their record after the battle. */
export function expView(outcome, userId, names, user) {
  const opponentId = outcome.sides.find((s) => s.userId !== userId).userId;
  return {
    opponent: names[opponentId],
    won: outcome.winnerId === userId,
    rating: outcome.rating?.[userId] ?? null,
    surge: outcome.surge ? outcome.sides[outcome.surge.side].userId === userId : false,
    pot: outcome.mode === "wager" && outcome.winnerId === userId ? 2 * outcome.stake : 0,
    members: (outcome.exp[userId] ?? []).map((e) => {
      const [id, variant] = String(e.key).split(":");
      const t = user ? getTraining(user, Number(id), variant) : null;
      return {
        id: Number(id),
        variant,
        shiny: variant === "shiny",
        name: displaySpeciesName(id, e.name),
        fromLevel: e.fromLevel,
        toLevel: e.toLevel,
        gained: e.gained,
        learned: e.learned ?? [],
        expFrac: t ? expProgress(t.exp, t.level) : null,
      };
    }),
  };
}

function drawHeader(ctx, v) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const tagW = drawTag(ctx, v.won ? "VICTORY" : "DEFEAT", M + 8, M + 10, {
    fill: v.won ? COLOR.gold : "#3a4256", color: v.won ? COLOR.ink : COLOR.text, h: 32, size: 18,
  });
  ctx.font = font(20, 700);
  ctx.fillStyle = COLOR.textMuted;
  const extras = [v.surge && "Underdog surge!", v.pot && `+${fmt(v.pot)} CC pot`].filter(Boolean).join("  ·  ");
  if (extras) ctx.fillText(fitText(ctx, extras, 380), M + 8 + tagW + 14, M + 33);
  const t = fitFont(ctx, `EXP from your battle with ${v.opponent}`, 640, 34, 24, 800);
  ctx.font = font(t.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(t.text, M + 8, M + 88);

  if (v.rating) {
    const d = v.rating.to - v.rating.from;
    ctx.textAlign = "right";
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("BATTLE RATING", W - M - 8, M + 28);
    ctx.font = font(40, 800);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(fmt(v.rating.to), W - M - 8, M + 74);
    const nw = ctx.measureText(fmt(v.rating.to)).width;
    ctx.font = font(22, 800);
    ctx.fillStyle = d >= 0 ? "#3fd46c" : COLOR.red;
    ctx.fillText(`${d >= 0 ? "▲" : "▼"}${Math.abs(d)}`, W - M - 8 - nw - 12, M + 72);
    ctx.textAlign = "left";
  }
}

function drawTile(ctx, m, x, y, w, sprite) {
  const up = m.toLevel > m.fromLevel;
  const accent = up ? "#3fd46c" : m.shiny ? COLOR.gold : null;
  ctx.fillStyle = "#1a2135";
  rr(ctx, x, y, w, TILE_H, 14);
  ctx.fill();
  ctx.lineWidth = accent ? 2.5 : 1.5;
  ctx.strokeStyle = accent ?? "#323c5c";
  ctx.stroke();

  // Sprite on a small platform.
  const sx = x + 82, floor = y + TILE_H - 26;
  ctx.fillStyle = m.shiny ? "#f5c84c40" : "#ffffff12";
  ctx.beginPath();
  ctx.ellipse(sx, floor, 58, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  drawSprite(ctx, sprite, sx, floor + 6, 150, TILE_H - 36, { scale: 2 });

  const tx = x + 168, tw = w - 168 - 18;
  // Name.
  const nm = fitFont(ctx, m.name, tw - (m.shiny ? 30 : 0) - (up ? 120 : 0), 28, 20, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(nm.text, tx, y + 42);
  let after = tx + ctx.measureText(nm.text).width;
  if (m.shiny) { drawShinyMark(ctx, after + 16, y + 42 - nm.size * 0.4, 10); after += 30; }
  if (up) drawTag(ctx, "LEVEL UP!", x + w - 18 - 112, y + 20, { fill: "#3fd46c", color: COLOR.ink, h: 28, size: 15 });

  // Level line: "Lv 41 → 42" or "Lv 41", then the EXP gained.
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("Lv", tx, y + 78);
  let lx = tx + ctx.measureText("Lv").width + 5;
  ctx.font = font(26, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(String(m.fromLevel), lx, y + 78);
  lx += ctx.measureText(String(m.fromLevel)).width;
  if (up) {
    ctx.fillStyle = "#3fd46c";
    ctx.fillText(` → ${m.toLevel}`, lx, y + 78);
    lx += ctx.measureText(` → ${m.toLevel}`).width;
  }
  ctx.textAlign = "right";
  ctx.font = font(22, 800);
  ctx.fillStyle = COLOR.exp;
  ctx.fillText(`+${fmt(m.gained)} EXP`, x + w - 18, y + 78);
  ctx.textAlign = "left";

  // EXP bar (progress now) — flat, in EXP blue, never an HP bar.
  if (m.expFrac !== null) {
    ctx.fillStyle = "#0c111e";
    rr(ctx, tx, y + 92, tw, 8, 4);
    ctx.fill();
    if (m.expFrac > 0) {
      ctx.fillStyle = COLOR.exp;
      rr(ctx, tx, y + 92, Math.max(8, tw * m.expFrac), 8, 4);
      ctx.fill();
    }
  }
  // New moves.
  if (m.learned.length) {
    ctx.font = font(18, 700);
    ctx.fillStyle = "#3fd46c";
    ctx.fillText(fitText(ctx, `Learned ${m.learned.join(", ")}`, tw), tx, y + 130);
  }
}

/** PNG of one player's post-battle EXP. */
export async function renderExpCard(v) {
  const { w, h } = expCardSize(v.members.length);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (v.won) {
    const glow = ctx.createRadialGradient(140, -60, 10, 140, -60, 420);
    glow.addColorStop(0, "#f5c84c22");
    glow.addColorStop(1, "#f5c84c00");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
  drawHeader(ctx, v);
  const ph = await loadPlaceholder();
  const tileW = (W - 2 * M - GAP) / 2;
  for (const [i, m] of v.members.entries()) {
    const sprite = (await loadStaticSprite(m.id, m.variant)) ?? ph;
    drawTile(ctx, m, M + (i % 2) * (tileW + GAP), M + HEADER + Math.floor(i / 2) * (TILE_H + GAP), tileW, sprite);
  }
  return canvas.toBuffer("image/png");
}
