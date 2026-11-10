// ==========================================================
// utils/render/inspectCard.js
// One Team member in detail: the ephemeral reply to /showteam's "Inspect"
// menu. Draws a slotView() (utils/render/teamView.js): Level, EXP, types,
// rarity, stats at Level and the battle moves, all as battles compute them.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitText, fitFont, drawTypeChips, drawShinyMark, drawLevel, dexNo, drawMegaTag } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { spriteStage } from "./stage.js";

export const INSPECT_SIZE = Object.freeze({ w: 1000, h: 440 });
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };
const STATS = [["hp", "HP"], ["atk", "Atk"], ["def", "Def"], ["spa", "SpA"], ["spd", "SpD"], ["spe", "Spe"]];

/** PNG of one slot. `owner` is the Team owner's display name. */
export async function renderInspectCard(slot, { owner, eyebrow: eyebrowText = null, animate = false } = {}) {
  const { w: W, h: H } = INSPECT_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  const accent = slot.shiny ? COLOR.gold : slot.slot === 1 ? COLOR.blue : slot.mega ? COLOR.mega : tierColor(slot.tier);
  const spriteId = slot.spriteId ?? slot.id; // a Mega slot (teamView) draws its Mega sprite

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Stage.
  const sw = 340, cx = sw / 2, floor = H - 70;
  const spot = ctx.createRadialGradient(cx, floor - 110, 10, cx, floor - 110, 230);
  spot.addColorStop(0, `${accent}2e`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, sw, H);
  ctx.fillStyle = `${accent}3a`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 120, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${accent}aa`;
  ctx.stroke();
  const sprite = (await loadStaticSprite(spriteId, slot.variant)) ?? (await loadPlaceholder());
  stage.place(ctx, sprite, cx, floor + 8, sw - 30, floor - 20, { scale: 3 }, { id: spriteId, variant: slot.variant });

  const x = 368, right = W - 32;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Eyebrow: whose Team, which slot.
  // Eyebrow: whose Team and which slot, or the caller's own line (/inspectpokemon).
  ctx.font = font(20, 800);
  ctx.fillStyle = !eyebrowText && slot.slot === 1 ? COLOR.blue : COLOR.textMuted;
  const eyebrow = eyebrowText ?? `SLOT ${slot.slot}${slot.slot === 1 ? " · LEAD" : ""}${owner ? `  ·  ${owner.toUpperCase()}'S TEAM` : ""}`;
  ctx.fillText(fitText(ctx, eyebrow, right - x - 180 - (slot.mega ? 104 : 0)), x, 50); // room for the MEGA tag beside the rarity pill
  const owned = slot.level != null; // null: a species the viewer doesn't own (base stats only)

  // Rarity pill.
  const label = (TIER_NAME[slot.tier] ?? "Common").toUpperCase();
  ctx.font = font(18, 800);
  const pw = ctx.measureText(label).width + 34;
  ctx.fillStyle = `${tierColor(slot.tier)}22`;
  rr(ctx, right - pw, 26, pw, 34, 17);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${tierColor(slot.tier)}aa`;
  ctx.stroke();
  ctx.fillStyle = TIER[slot.tier] ?? tierColor(slot.tier);
  ctx.textBaseline = "middle";
  ctx.fillText(label, right - pw + 17, 44);
  ctx.textBaseline = "alphabetic";
  if (slot.mega) drawMegaTag(ctx, right - pw - 10, 26, { h: 34, size: 18, align: "right" });

  // Name, Level, types.
  // Mega names ("Mega Charizard X") are the longest drawn here: a smaller cap keeps descenders clear of the type chips.
  const nm = fitFont(ctx, slot.name, right - x - (slot.shiny ? 50 : 0), slot.mega ? 46 : 56, 32, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, x, 112);
  if (slot.shiny) drawShinyMark(ctx, x + ctx.measureText(nm.text).width + 26, 112 - nm.size * 0.42, 14);
  const lw = owned ? drawLevel(ctx, slot.level, x, 164, { size: 34 }) + 18 : 0;
  if (slot.types.length) drawTypeChips(ctx, slot.types, x + lw, 136, { h: 36, size: 19, gap: 10 });
  ctx.textAlign = "right";
  ctx.font = font(19, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText([slot.region, dexNo(slot.id)].filter(Boolean).join("  ·  "), right, 160);
  ctx.textAlign = "left";

  // EXP to next Level (owned only).
  if (owned) {
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("EXP TO NEXT LEVEL", x, 200);
    ctx.textAlign = "right";
    ctx.fillText(slot.level >= 100 ? "MAX" : `${Math.floor(slot.expFrac * 100)}%`, right, 200);
    ctx.textAlign = "left";
    ctx.fillStyle = "#0c111e";
    rr(ctx, x, 210, right - x, 10, 5);
    ctx.fill();
    ctx.fillStyle = COLOR.exp;
    if (slot.expFrac > 0) {
      rr(ctx, x, 210, Math.max(10, (right - x) * slot.expFrac), 10, 5);
      ctx.fill();
    }
  } else {
    ctx.font = font(18, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText("Not caught yet: catch one to see its Level and battle moves.", x, 212);
  }

  // Stats at this Level (what battles use), or base stats when not owned.
  if (slot.stats) {
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText(owned ? `STATS AT LV ${slot.level}` : "BASE STATS", x, 254);
    const gap = 8, bw = (right - x - gap * 5) / 6;
    STATS.forEach(([k, name], i) => {
      const bx = x + i * (bw + gap);
      ctx.fillStyle = COLOR.surfaceRaised;
      rr(ctx, bx, 264, bw, 58, 10);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.font = font(15, 700);
      ctx.fillStyle = COLOR.textMuted;
      ctx.fillText(name, bx + bw / 2, 284);
      ctx.font = font(24, 800);
      ctx.fillStyle = COLOR.text;
      ctx.fillText(String(slot.stats[k]), bx + bw / 2, 312);
      ctx.textAlign = "left";
    });
  }

  // Battle moves (auto-chosen: the last four learned by this Level).
  if (slot.moves.length) {
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("BATTLE MOVES", x, 352);
  }
  const mw = (right - x - 8 * 3) / 4;
  slot.moves.slice(0, 4).forEach((mv, i) => {
    const mx = x + i * (mw + 8);
    ctx.fillStyle = COLOR.surfaceRaised;
    rr(ctx, mx, 362, mw, 44, 10);
    ctx.fill();
    ctx.font = font(18, 700);
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = "center";
    ctx.fillText(fitText(ctx, mv, mw - 16), mx + mw / 2, 390);
    ctx.textAlign = "left";
  });

  return stage.output(canvas);
}
