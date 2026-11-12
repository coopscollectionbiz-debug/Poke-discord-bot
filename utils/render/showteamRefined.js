// ==========================================================
// utils/render/showteamRefined.js — PROTOTYPE: refined A/B hybrid
// Layout A's six-card 3×2 grid and trainer header, rebuilt around B's
// strengths: bigger battle-style sprites on lit platforms, edge-to-edge
// stages instead of inset panels, and fewer, larger text elements.
//
// Drawn in three layers so animation is cheap: base (everything under the
// sprites, drawn once), sprites (per frame), top (badges over the stage).
// ==========================================================

import { COLOR, TIER, tierColor } from "./tokens.js";
import {
  rr, font, fitText, fitFont, drawTypeChips, typeChipsWidth, drawShinyMark, drawLevel, levelWidth, drawBall, dexNo, drawMegaTag, fillTextMid,
} from "./primitives.js";
import { drawSprite } from "./sprites.js";
import { shinyBackdrop } from "./shinyBackdrop.js";
import { backdropSeed } from "./stage.js";

const W = 1200, M = 16, G = 12, HEADER = 92, CARD_H = 392, NOTE = 44;
const CARD_W = (W - 2 * M - 2 * G) / 3;
const INFO_H = 104; // name + level/type row + EXP strip, anchored to the card bottom
const SPRITE_SCALE = 3; // every Pokémon at 3×; the few taller than ~85 px shrink just enough
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

const hasNote = (view) => view.fallback || !view.slots.length;
export const refinedSize = (view) => ({ w: W, h: M + HEADER + (hasNote(view) ? NOTE : 0) + 2 * CARD_H + G + M });

function cardRect(view, i) {
  const top = M + HEADER + (hasNote(view) ? NOTE : 0);
  return {
    x: Math.round(M + (i % 3) * (CARD_W + G)),
    y: top + Math.floor(i / 3) * (CARD_H + G),
    w: Math.round(CARD_W),
    h: CARD_H,
  };
}
// Shiny gold, then lead blue, then a Mega's own colour (only a slot that battles as a Mega).
const accentOf = (slot) => (slot.shiny ? COLOR.gold : slot.slot === 1 ? COLOR.blue : slot.mega ? COLOR.mega : null);

// ---------- base layer ----------

function drawBackdrop(ctx, H) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // One soft light from above the header gives the scene depth.
  const light = ctx.createRadialGradient(W / 2, -120, 40, W / 2, -120, 900);
  light.addColorStop(0, "#5a7dff1c");
  light.addColorStop(1, "#5a7dff00");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader(ctx, view) {
  const y = M;
  // Left: name with a Poké Ball per Team slot (the battle nameplate), rank · TP.
  const nm = fitFont(ctx, view.displayName, 520, 38, 26, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(nm.text, M + 8, y + 42);
  const bx = M + 8 + ctx.measureText(nm.text).width + 26;
  for (let i = 0; i < 6; i++) drawBall(ctx, bx + i * 28, y + 29, 10, i < view.slots.length);
  ctx.font = font(22, 600);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(fitText(ctx, `${view.rank}  ·  ${fmt(view.tp)} TP`, 600), M + 8, y + 76);

  // Right: up to three stat blocks, right-aligned, divided by hairlines.
  const stats = [["TEAM POWER", fmt(view.power), COLOR.gold]];
  if (view.battle) {
    stats.push(["RATING", fmt(view.battle.rating), COLOR.text]);
    stats.push(["RECORD", `${view.battle.wins}–${view.battle.losses}`, COLOR.text]);
  }
  let right = W - M - 8;
  for (let k = stats.length - 1; k >= 0; k--) {
    const [label, value, color] = stats[k];
    ctx.font = font(32, 800);
    const vw = ctx.measureText(value).width;
    ctx.font = font(15, 800);
    const lw = ctx.measureText(label).width;
    const bw = Math.max(vw, lw);
    ctx.textAlign = "right";
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText(label, right, y + 26);
    ctx.font = font(32, 800);
    ctx.fillStyle = color;
    ctx.fillText(value, right, y + 64);
    right -= bw + 22;
    if (k > 0) {
      ctx.fillStyle = COLOR.line;
      ctx.fillRect(right + 10, y + 12, 1.5, 56);
    }
  }
  ctx.textAlign = "left";

  if (hasNote(view)) {
    const msg = view.slots.length
      ? "No Team set: showing your first Pokémon. Pick your Team on /dashboard."
      : "No Pokémon yet. Catch some by chatting, then pick your Team on /dashboard.";
    ctx.font = font(19, 700);
    const tw = ctx.measureText(msg).width + 36;
    ctx.fillStyle = "#f5c84c1f";
    rr(ctx, (W - tw) / 2, y + HEADER, tw, 34, 17);
    ctx.fill();
    ctx.fillStyle = COLOR.gold;
    ctx.textAlign = "center";
    fillTextMid(ctx, msg, W / 2, y + HEADER + 17);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

function drawEmpty(ctx, r, n) {
  ctx.fillStyle = "#ffffff05";
  rr(ctx, r.x, r.y, r.w, r.h, 16);
  ctx.fill();
  ctx.save();
  ctx.setLineDash([12, 9]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a4466";
  rr(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 16);
  ctx.stroke();
  ctx.restore();
  const cx = r.x + r.w / 2, floor = r.y + r.h - INFO_H - 22;
  ctx.fillStyle = "#ffffff0d";
  ctx.beginPath();
  ctx.ellipse(cx, floor, 100, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.3;
  drawBall(ctx, cx, floor - 46, 28, false);
  ctx.globalAlpha = 1;
  ctx.font = font(26, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.textAlign = "center";
  ctx.fillText("Empty slot", cx, r.y + r.h - 50);
  ctx.textAlign = "left";
}

function drawCardBase(ctx, slot, r) {
  const accent = accentOf(slot);
  ctx.save();
  // Card: flat surface with one soft shadow; no inset panel, so the stage
  // runs edge to edge.
  ctx.shadowColor = "#00000059";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#1a2135";
  rr(ctx, r.x, r.y, r.w, r.h, 16);
  ctx.fill();
  ctx.restore();

  ctx.save();
  rr(ctx, r.x, r.y, r.w, r.h, 16);
  ctx.clip();
  // Stage light: a broad, faint spotlight tinted by the accent.
  const cx = r.x + r.w / 2, floor = r.y + r.h - INFO_H - 22;
  const spot = ctx.createRadialGradient(cx, floor - 110, 10, cx, floor - 110, 230);
  spot.addColorStop(0, accent ? `${accent}26` : "#ffffff0d");
  spot.addColorStop(1, accent ? `${accent}00` : "#ffffff00");
  ctx.fillStyle = spot;
  ctx.fillRect(r.x, r.y, r.w, r.h - INFO_H);
  // Info band: darker floor under the stage.
  ctx.fillStyle = "#141a2b";
  ctx.fillRect(r.x, r.y + r.h - INFO_H, r.w, INFO_H);
  ctx.fillStyle = "#ffffff0f";
  ctx.fillRect(r.x, r.y + r.h - INFO_H, r.w, 1);

  // Platform (the battle's), lit for the lead (blue) and shiny (gold).
  ctx.fillStyle = accent ? `${accent}40` : "#ffffff12";
  ctx.beginPath();
  ctx.ellipse(cx, floor, 108, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent ? `${accent}b0` : "#ffffff26";
  ctx.stroke();

  // EXP: a flat strip along the card's bottom edge in the games' EXP blue —
  // deliberately unlike the battle HP bar (rounded pill, "HP" tag, green).
  ctx.fillStyle = "#0c111e";
  ctx.fillRect(r.x, r.y + r.h - 8, r.w, 8);
  ctx.fillStyle = COLOR.exp;
  ctx.fillRect(r.x, r.y + r.h - 8, Math.round(r.w * slot.expFrac), 8);
  ctx.restore();

  // Border last so it sits over the stage and strip.
  ctx.lineWidth = accent ? 3 : 1.5;
  ctx.strokeStyle = accent ?? "#323c5c";
  rr(ctx, r.x + (accent ? 1.5 : 0.75), r.y + (accent ? 1.5 : 0.75), r.w - (accent ? 3 : 1.5), r.h - (accent ? 3 : 1.5), 15);
  ctx.stroke();

  // Name (+ shiny sparkle), then Level and types on one row.
  const markW = slot.shiny ? 30 : 0;
  const nm = fitFont(ctx, slot.name, r.w - 40 - markW, 36, 24, 800);
  ctx.font = font(nm.size, 800);
  const nw = ctx.measureText(nm.text).width;
  const nx = cx - (nw + markW) / 2, ny = r.y + r.h - 58;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic"; // chips leave it at "middle"
  ctx.fillText(nm.text, nx, ny);
  if (slot.shiny) drawShinyMark(ctx, nx + nw + 18, ny - nm.size * 0.4, 11);

  let chip = { h: 32, size: 18, gap: 8 };
  const lw = levelWidth(ctx, slot.level, 28);
  if (lw + 14 + typeChipsWidth(ctx, slot.types, chip) > r.w - 32) chip = { h: 30, size: 16, gap: 6 };
  const rowW = lw + (slot.types.length ? 14 + typeChipsWidth(ctx, slot.types, chip) : 0);
  const rx = cx - rowW / 2, ry = r.y + r.h - 46;
  drawLevel(ctx, slot.level, rx, ry + 26, { size: 28 });
  if (slot.types.length) drawTypeChips(ctx, slot.types, rx + lw + 14, ry, chip);
}

function drawBase(ctx, view, H) {
  drawBackdrop(ctx, H);
  drawHeader(ctx, view);
  for (let i = 0; i < 6; i++) {
    const r = cardRect(view, i);
    if (view.slots[i]) drawCardBase(ctx, view.slots[i], r);
    else drawEmpty(ctx, r, i + 1);
  }
}

// ---------- sprite layer ----------

/**
 * `fx` (optional): { enabled, frame, total, anims, cache } — the shiny
 * backdrop (Legendary motes + stars, utils/render/shinyBackdrop.js) behind
 * every shiny slot; `anims[i]` lets its clear-space mask cover every frame.
 */
function drawSprites(ctx, view, sprites, frameFor, fx = null) {
  view.slots.forEach((slot, i) => {
    const r = cardRect(view, i);
    const cx = r.x + r.w / 2, floor = r.y + r.h - INFO_H - 22;
    const sp = sprites[i];
    if (fx?.enabled && slot?.variant === "shiny" && sp && !sp.placeholder) {
      if (!fx.cache.has(i)) fx.cache.set(i, shinyBackdrop({ sprite: sp, anim: fx.anims?.[i] ?? null, cx, floorY: floor + 8, boxW: r.w - 36, boxH: floor + 8 - (r.y + 14), scale: SPRITE_SCALE, seed: backdropSeed(slot.spriteId ?? slot.id) }));
      fx.cache.get(i)?.draw(ctx, fx.frame, fx.total);
    }
    // Grounding shadow under the feet, sized to the sprite.
    if (sp && !sp.placeholder) {
      const sw = Math.min(r.w - 60, sp.width * SPRITE_SCALE);
      const sh = ctx.createRadialGradient(cx, floor + 2, 2, cx, floor + 2, sw * 0.42);
      sh.addColorStop(0, "#00000070");
      sh.addColorStop(1, "#00000000");
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.ellipse(cx, floor + 2, sw * 0.42, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawSprite(ctx, sp, cx, floor + 8, r.w - 36, floor + 8 - (r.y + 14), { scale: SPRITE_SCALE, frame: frameFor(i) });
  });
}

// ---------- top layer ----------

/** Rarity pill: the tier name in its color, the same pill as the catch card. */
function drawTierPill(ctx, tier, right, y) {
  const color = TIER[tier] ?? tierColor(tier);
  const label = (TIER_NAME[tier] ?? "Common").toUpperCase();
  ctx.font = font(17, 800);
  const w = ctx.measureText(label).width + 30, h = 30, x = right - w;
  ctx.fillStyle = "#101626"; // opaque backing: the pill can sit over a tall sprite
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = `${color}22`;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${color}aa`;
  ctx.stroke();
  ctx.fillStyle = color;
  fillTextMid(ctx, label, x + 15, y + h / 2);
}

function drawTop(ctx, view) {
  view.slots.forEach((slot, i) => {
    const r = cardRect(view, i);
    const lead = i === 0;
    // Slot number; the lead also gets a LEAD tag (it fights first).
    const bx = r.x + 30, by = r.y + 30;
    ctx.fillStyle = lead ? COLOR.blue : "#101626e6";
    ctx.beginPath();
    ctx.arc(bx, by, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = lead ? COLOR.blue : "#3a4466";
    ctx.stroke();
    ctx.font = font(19, 800);
    ctx.fillStyle = lead ? "#ffffff" : COLOR.textMuted;
    ctx.textAlign = "center";
    fillTextMid(ctx, String(i + 1), bx, by);
    let nx = bx + 24;
    if (lead) {
      ctx.font = font(15, 800);
      const tw = ctx.measureText("LEAD").width + 22;
      ctx.fillStyle = COLOR.blue;
      rr(ctx, nx, by - 13, tw, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      fillTextMid(ctx, "LEAD", nx + tw / 2, by);
      nx += tw + 8;
    }
    // National Pokédex number, on a dark backing so it reads over a sprite.
    ctx.font = font(16, 800);
    const dw = ctx.measureText(dexNo(slot.id)).width + 20;
    ctx.fillStyle = "#101626e6";
    rr(ctx, nx, by - 13, dw, 26, 13);
    ctx.fill();
    ctx.fillStyle = COLOR.textMuted;
    fillTextMid(ctx, dexNo(slot.id), nx + dw / 2, by);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    drawTierPill(ctx, slot.tier, r.x + r.w - 14, r.y + 15);
    // MEGA under the rarity pill, right-aligned with it.
    if (slot.mega) drawMegaTag(ctx, r.x + r.w - 14, r.y + 53, { h: 28, size: 16, align: "right" });
  });
}

export const refinedLayout = { size: refinedSize, base: drawBase, sprites: drawSprites, top: drawTop };
