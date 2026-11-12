// ==========================================================
// utils/render/showteam.js — PROTOTYPE (Milestone B)
// Three candidate layouts for the redesigned /showteam image, drawn from a
// team view (utils/render/teamView.js). Not wired to the command yet: the
// production /showteam keeps its current card until a layout is approved.
//
//   grid    — A: six equal cards, 3×2
//   roster  — B: battle-style stage, Pokémon on platforms, text box
//   hybrid  — C: trainer panel + featured lead + five compact slots
//
// Output is a PNG (first animation frame of every sprite) or, with
// animate: true, a looping GIF whose sprites play like the battle's.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TEXT, tierColor } from "./tokens.js";
import {
  rr, font, fitText, fitFont, drawBackground, drawCard, drawTypeChips, typeChipsWidth, drawTierPips,
  drawShinyMark, drawLevel, levelWidth, drawExpBar, drawSlotBadge, drawPlatform, drawBall, drawTag, fillTextMid,
} from "./primitives.js";
import { loadStaticSprite, loadPlaceholder, loadTrainerSprite, drawSprite } from "./sprites.js";
import { loadAnimatedSprite, spritePlayer } from "../battle/render.js";
import { encodeGif } from "./gif.js";
import { shinyFxEnabled } from "./shinyBackdrop.js";
import { refinedLayout } from "./showteamRefined.js";

export const LAYOUTS = Object.freeze({
  grid: { w: 1200, h: 820 },
  roster: { w: 1200, h: 800 },
  hybrid: { w: 1200, h: 780 },
  refined: { w: 1200, h: 920 }, // + 44 when the no-Team note shows (sizeFor)
});

/** Image size for a layout and view (the refined layout grows for its note). */
export const sizeFor = (layout, view) => (layout === "refined" ? refinedLayout.size(view) : LAYOUTS[layout]);

const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

// ---------- shared pieces ----------

/** Trainer header: name, rank · TP, balls for the six slots, power/record. */
function drawHeader(ctx, view, x, y, w) {
  const { text, size } = fitFont(ctx, view.displayName, w * 0.5, TEXT.display, 28, 800);
  ctx.font = font(size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y + 40);
  const nameW = ctx.measureText(text).width;
  for (let i = 0; i < 6; i++) drawBall(ctx, x + nameW + 30 + i * 30, y + 26, 11, i < view.slots.length);
  ctx.font = font(TEXT.label, 600);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(fitText(ctx, `${view.rank}  ·  ${fmt(view.tp)} TP`, w * 0.55), x, y + 76);

  // Right: team power and battle record, the two numbers battles actually use.
  ctx.textAlign = "right";
  ctx.font = font(TEXT.micro, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("TEAM POWER", x + w, y + 22);
  ctx.font = font(TEXT.title + 4, 800);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText(fmt(view.power), x + w, y + 56);
  if (view.battle) {
    ctx.font = font(TEXT.micro, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(`Rating ${fmt(view.battle.rating)}  ·  ${view.battle.wins}W–${view.battle.losses}L`, x + w, y + 82);
  }
  ctx.textAlign = "left";
}

/** The note shown when the image falls back to the first owned Pokémon. */
function drawFallbackNote(ctx, view, x, y, w) {
  if (!view.fallback && view.slots.length) return;
  const msg = view.slots.length
    ? "No Team set: showing your first Pokémon. Pick your Team on /dashboard."
    : "No Pokémon yet. Catch some by chatting, then pick your Team on /dashboard.";
  ctx.font = font(TEXT.micro, 700);
  const tw = Math.min(w, ctx.measureText(msg).width + 32);
  ctx.fillStyle = "#f5c84c22";
  rr(ctx, x + (w - tw) / 2, y, tw, 32, 16);
  ctx.fill();
  ctx.fillStyle = COLOR.gold;
  ctx.textAlign = "center";
  fillTextMid(ctx, fitText(ctx, msg, tw - 24), x + w / 2, y + 16);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** An empty slot that looks deliberate: dashed outline, ghost ball, label. */
function drawEmptySlot(ctx, n, x, y, w, h, { compact = false } = {}) {
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.line;
  rr(ctx, x + 1, y + 1, w - 2, h - 2, 14);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#ffffff06";
  rr(ctx, x, y, w, h, 14);
  ctx.fill();
  const cy = y + h * (compact ? 0.4 : 0.42);
  ctx.globalAlpha = 0.35;
  drawBall(ctx, x + w / 2, cy, compact ? 18 : 26, false);
  ctx.globalAlpha = 1;
  ctx.font = font(compact ? TEXT.micro : TEXT.label, 700);
  ctx.fillStyle = COLOR.textFaint;
  ctx.textAlign = "center";
  ctx.fillText(`Slot ${n} · Empty`, x + w / 2, cy + (compact ? 52 : 66));
  ctx.textAlign = "left";
}

/** Name line with the shiny mark after it, centered on cx; fits maxW. */
function drawNameCentered(ctx, slot, cx, baseline, maxW, size, min = 18) {
  const markW = slot.shiny ? size * 0.9 : 0;
  const { text, size: s } = fitFont(ctx, slot.name, maxW - markW, size, min, 800);
  ctx.font = font(s, 800);
  const w = ctx.measureText(text).width;
  const x = cx - (w + markW) / 2;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, baseline);
  if (slot.shiny) drawShinyMark(ctx, x + w + markW * 0.55, baseline - s * 0.42, s * 0.3);
  return s;
}

/** Level and type chips on one centered row. */
function drawLevelTypesRow(ctx, slot, cx, y, { lvSize = 24, chipH = 28, chipSize = 15, maxW = 340 } = {}) {
  const lw = levelWidth(ctx, slot.level, lvSize);
  let chipOpts = { h: chipH, size: chipSize };
  let cw = typeChipsWidth(ctx, slot.types, chipOpts);
  if (lw + 14 + cw > maxW) { chipOpts = { h: chipH - 4, size: chipSize - 3 }; cw = typeChipsWidth(ctx, slot.types, chipOpts); }
  const total = lw + 14 + cw;
  const x = cx - total / 2;
  drawLevel(ctx, slot.level, x, y + chipOpts.h * 0.5 + lvSize * 0.36, { size: lvSize });
  drawTypeChips(ctx, slot.types, x + lw + 14, y, chipOpts);
}

/** Shiny tint behind a sprite: a faint gold radial wash. */
function drawShinyWash(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
  g.addColorStop(0, "#f5c84c30");
  g.addColorStop(1, "#f5c84c00");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- A: grid ----------

function drawGrid(ctx, view, sprites, frameFor) {
  const { w: W, h: H } = LAYOUTS.grid;
  drawBackground(ctx, W, H);
  drawHeader(ctx, view, 32, 22, W - 64);
  drawFallbackNote(ctx, view, 32, 112, W - 64);
  const top = view.fallback || !view.slots.length ? 156 : 130, gap = 18, m = 32;
  const cw = (W - 2 * m - 2 * gap) / 3, ch = (H - top - m - gap) / 2;
  for (let i = 0; i < 6; i++) {
    const x = m + (i % 3) * (cw + gap), y = top + Math.floor(i / 3) * (ch + gap);
    const slot = view.slots[i];
    if (!slot) { drawEmptySlot(ctx, i + 1, x, y, cw, ch); continue; }
    drawCard(ctx, x, y, cw, ch, { ring: slot.shiny ? COLOR.gold : i === 0 ? "#4f8cff99" : null });
    // Sprite stage: a sunken panel with the platform.
    ctx.fillStyle = COLOR.surfaceSunken;
    const stageH = ch - 114; // text block is anchored to the card bottom
    rr(ctx, x + 10, y + 10, cw - 20, stageH, 10);
    ctx.fill();
    const cx = x + cw / 2, floor = y + stageH - 14;
    if (slot.shiny) drawShinyWash(ctx, cx, floor - 70, 120);
    drawPlatform(ctx, cx, floor, 78, 14, i === 0 ? COLOR.blue : null);
    drawSprite(ctx, sprites[i], cx, floor + 6, cw - 40, stageH - 22, { scale: 2, frame: frameFor(i) });
    drawSlotBadge(ctx, i + 1, x + 32, y + 32, { lead: i === 0 });
    drawTierPips(ctx, slot.tier, x + cw - 24 - pipsWidth(slot.tier), y + 32);
    drawNameCentered(ctx, slot, cx, y + ch - 70, cw - 32, TEXT.title);
    drawLevelTypesRow(ctx, slot, cx, y + ch - 58, { maxW: cw - 32 });
    drawExpBar(ctx, x + 22, y + ch - 20, cw - 44, slot.expFrac);
  }
}

const pipsWidth = (tier) => {
  const n = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 }[tier] ?? 1;
  return n * 14 + (n - 1) * 5;
};

// ---------- B: battle roster ----------

function drawRoster(ctx, view, sprites, frameFor) {
  const { w: W, h: H } = LAYOUTS.roster;
  drawBackground(ctx, W, H);
  const pad = 16, textH = 92, rowGap = 14;
  const rowH = (H - pad * 3 - textH - rowGap) / 2;
  for (let r = 0; r < 2; r++) {
    const top = pad + r * (rowH + rowGap);
    ctx.fillStyle = `${COLOR.blue}14`;
    rr(ctx, pad, top, W - 2 * pad, rowH, 18);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `${COLOR.blue}55`;
    ctx.stroke();
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const slot = view.slots[i];
      const colW = (W - 2 * pad) / 3;
      const cx = pad + colW * (c + 0.5);
      const floor = top + rowH - 128;
      if (!slot) {
        drawPlatform(ctx, cx, floor, 92, 16, null);
        ctx.globalAlpha = 0.3;
        drawBall(ctx, cx, floor - 34, 22, false);
        ctx.globalAlpha = 1;
        ctx.font = font(TEXT.label, 700);
        ctx.fillStyle = COLOR.textFaint;
        ctx.textAlign = "center";
        ctx.fillText(`Slot ${i + 1} · Empty`, cx, floor + 58);
        ctx.textAlign = "left";
        continue;
      }
      const lead = i === 0;
      if (slot.shiny) drawShinyWash(ctx, cx, floor - 70, 120);
      drawPlatform(ctx, cx, floor, 96, 17, slot.shiny ? COLOR.gold : COLOR.blue);
      drawSprite(ctx, sprites[i], cx, floor + 8, colW - 70, floor - top - 6, { scale: 2, frame: frameFor(i) });
      drawSlotBadge(ctx, i + 1, pad + colW * c + 34, top + 32, { lead });
      drawTierPips(ctx, slot.tier, pad + colW * (c + 1) - 24 - pipsWidth(slot.tier), top + 32);
      if (lead) drawTag(ctx, "LEAD", pad + colW * c + 60, top + 19, { h: 26, size: 14, fill: COLOR.blue, color: "#ffffff" });
      drawNameCentered(ctx, slot, cx, floor + 50, colW - 40, TEXT.title);
      drawLevelTypesRow(ctx, slot, cx, floor + 66, { maxW: colW - 40 });
      drawExpBar(ctx, cx - 110, floor + 104, 220, slot.expFrac, { h: 7 });
    }
  }
  // Game-style text box with the trainer line.
  const ty = H - pad - textH;
  ctx.fillStyle = COLOR.textbox;
  rr(ctx, pad, ty, W - 2 * pad, textH, 14);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLOR.textboxBorder;
  ctx.stroke();
  ctx.fillStyle = "#1d2233";
  const { text, size } = fitFont(ctx, `${view.displayName}'s Team`, 520, TEXT.title, 22, 800);
  ctx.font = font(size, 800);
  ctx.fillText(text, pad + 26, ty + 40);
  ctx.font = font(TEXT.label, 600);
  ctx.fillStyle = "#4a5068";
  const sub = view.fallback ? "No Team set: showing first Pokémon · /dashboard to pick one" : `${view.rank}  ·  ${fmt(view.tp)} TP`;
  ctx.fillText(fitText(ctx, sub, 560), pad + 26, ty + 74);
  ctx.textAlign = "right";
  ctx.font = font(TEXT.micro, 800);
  ctx.fillStyle = "#6a7088";
  ctx.fillText("TEAM POWER", W - pad - 26, ty + 32);
  ctx.font = font(TEXT.title + 2, 800);
  ctx.fillStyle = "#1d2233";
  ctx.fillText(fmt(view.power), W - pad - 26, ty + 66);
  if (view.battle) {
    ctx.font = font(TEXT.micro, 700);
    ctx.fillStyle = "#4a5068";
    ctx.fillText(`Rating ${fmt(view.battle.rating)} · ${view.battle.wins}W–${view.battle.losses}L`, W - pad - 210, ty + 66);
  }
  ctx.textAlign = "left";
}

// ---------- C: hybrid ----------

function drawHybrid(ctx, view, sprites, frameFor, trainer) {
  const { w: W, h: H } = LAYOUTS.hybrid;
  drawBackground(ctx, W, H);
  const m = 24, gap = 16, leftW = 300;

  // Trainer panel.
  drawCard(ctx, m, m, leftW, H - 2 * m, { fill: "#171d30" });
  ctx.textAlign = "center";
  ctx.font = font(TEXT.micro, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("TRAINER", m + leftW / 2, m + 40);
  const nm = fitFont(ctx, view.displayName, leftW - 40, TEXT.title + 2, 20, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, m + leftW / 2, m + 80);
  ctx.font = font(TEXT.micro + 1, 600);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(fitText(ctx, view.rank, leftW - 40), m + leftW / 2, m + 110);
  ctx.textAlign = "left";
  const stageTop = m + 128, stageH = 300;
  ctx.fillStyle = COLOR.surfaceSunken;
  rr(ctx, m + 16, stageTop, leftW - 32, stageH, 12);
  ctx.fill();
  drawPlatform(ctx, m + leftW / 2, stageTop + stageH - 34, 96, 16, null);
  if (trainer) drawSprite(ctx, trainer, m + leftW / 2, stageTop + stageH - 26, leftW - 60, stageH - 40, { scale: 2 });
  else {
    ctx.globalAlpha = 0.35;
    drawBall(ctx, m + leftW / 2, stageTop + stageH / 2, 30, false);
    ctx.globalAlpha = 1;
  }
  // Stat rows.
  const rows = [
    ["Team Power", fmt(view.power), COLOR.gold],
    ["Battle Rating", view.battle ? fmt(view.battle.rating) : "—", COLOR.text],
    ["Record", view.battle ? `${view.battle.wins}W – ${view.battle.losses}L` : "—", COLOR.text],
    ["Trainer Points", fmt(view.tp), COLOR.text],
  ];
  let ry = stageTop + stageH + 26;
  for (const [label, value, color] of rows) {
    ctx.font = font(TEXT.micro, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(label, m + 26, ry + 18);
    ctx.textAlign = "right";
    ctx.font = font(TEXT.body, 800);
    ctx.fillStyle = color;
    ctx.fillText(value, m + leftW - 26, ry + 20);
    ctx.textAlign = "left";
    ry += 46;
    if (ry < H - m - 30) {
      ctx.fillStyle = COLOR.line;
      ctx.fillRect(m + 26, ry - 12, leftW - 52, 1);
    }
  }

  // Right column.
  const rx = m + leftW + gap, rw = W - rx - m;
  const lead = view.slots[0];
  const leadH = 350;
  drawFallbackNote(ctx, view, rx, m - 4, rw);
  const leadTop = m + (view.fallback || !view.slots.length ? 36 : 0);
  if (!lead) drawEmptySlot(ctx, 1, rx, leadTop, rw, leadH - (leadTop - m));
  else {
    drawCard(ctx, rx, leadTop, rw, leadH - (leadTop - m), { ring: lead.shiny ? COLOR.gold : `${COLOR.blue}99` });
    const stageW = 360;
    ctx.fillStyle = COLOR.surfaceSunken;
    rr(ctx, rx + 12, leadTop + 12, stageW, leadH - (leadTop - m) - 24, 12);
    ctx.fill();
    const scx = rx + 12 + stageW / 2, floor = leadTop + leadH - (leadTop - m) - 52;
    if (lead.shiny) drawShinyWash(ctx, scx, floor - 90, 160);
    drawPlatform(ctx, scx, floor, 120, 20, lead.shiny ? COLOR.gold : COLOR.blue);
    drawSprite(ctx, sprites[0], scx, floor + 8, stageW - 50, leadH - (leadTop - m) - 90, { scale: 3, frame: frameFor(0) });
    drawSlotBadge(ctx, 1, rx + 40, leadTop + 40, { lead: true });
    drawTag(ctx, "LEAD", rx + 64, leadTop + 27, { h: 26, size: 14, fill: COLOR.blue, color: "#ffffff" });
    // Details.
    const dx = rx + 12 + stageW + 28, dw = rw - stageW - 12 - 28 - 24;
    let y = leadTop + 58;
    const nm2 = fitFont(ctx, lead.name, dw - (lead.shiny ? 40 : 0), TEXT.display + 4, 26, 800);
    ctx.font = font(nm2.size, 800);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(nm2.text, dx, y);
    if (lead.shiny) drawShinyMark(ctx, dx + ctx.measureText(nm2.text).width + 20, y - nm2.size * 0.36, 13);
    y += 18;
    const lw = drawLevel(ctx, lead.level, dx, y + 32, { size: TEXT.title });
    drawTypeChips(ctx, lead.types, dx + lw + 18, y + 6, { h: 32, size: 17 });
    y += 56;
    drawTierPips(ctx, lead.tier, dx, y + 8);
    ctx.font = font(TEXT.micro, 700);
    ctx.fillStyle = tierColor(lead.tier);
    ctx.fillText(lead.tier.toUpperCase(), dx + pipsWidth(lead.tier) + 12, y + 15);
    ctx.fillStyle = COLOR.textMuted;
    const meta = [lead.region, `#${String(lead.id).padStart(4, "0")}`].filter(Boolean).join("  ·  ");
    ctx.textAlign = "right";
    ctx.fillText(meta, dx + dw, y + 15);
    ctx.textAlign = "left";
    y += 34;
    ctx.font = font(TEXT.micro - 2, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("EXP TO NEXT LEVEL", dx, y + 14);
    drawExpBar(ctx, dx, y + 24, dw, lead.expFrac, { h: 10 });
    y += 52;
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("BATTLE MOVES", dx, y + 14);
    y += 26;
    const mw = (dw - 10) / 2;
    lead.moves.slice(0, 4).forEach((mv, k) => {
      const mx = dx + (k % 2) * (mw + 10), my = y + Math.floor(k / 2) * 42;
      ctx.fillStyle = COLOR.surfaceRaised;
      rr(ctx, mx, my, mw, 34, 8);
      ctx.fill();
      ctx.font = font(TEXT.micro, 700);
      ctx.fillStyle = COLOR.text;
      ctx.fillText(fitText(ctx, mv, mw - 20), mx + 12, my + 23);
    });
  }

  // Five compact slots.
  const rowTop = m + leadH + gap, rowH = H - rowTop - m;
  const cw = (rw - 4 * 12) / 5;
  for (let k = 1; k < 6; k++) {
    const x = rx + (k - 1) * (cw + 12);
    const slot = view.slots[k];
    if (!slot) { drawEmptySlot(ctx, k + 1, x, rowTop, cw, rowH, { compact: true }); continue; }
    drawCard(ctx, x, rowTop, cw, rowH, { ring: slot.shiny ? COLOR.gold : null });
    const cx = x + cw / 2, floor = rowTop + 196;
    ctx.fillStyle = COLOR.surfaceSunken;
    rr(ctx, x + 8, rowTop + 8, cw - 16, 208, 10);
    ctx.fill();
    if (slot.shiny) drawShinyWash(ctx, cx, floor - 60, 80);
    drawPlatform(ctx, cx, floor - 6, 56, 11, null);
    drawSprite(ctx, sprites[k], cx, floor, cw - 20, 180, { scale: 2, frame: frameFor(k) });
    drawSlotBadge(ctx, k + 1, x + 26, rowTop + 26, { r: 15 });
    drawNameCentered(ctx, slot, cx, rowTop + 246, cw - 20, TEXT.label + 2, 16);
    const lvW = levelWidth(ctx, slot.level, 22);
    drawLevel(ctx, slot.level, cx - lvW / 2, rowTop + 276, { size: 22 });
    // Types stacked when two would not fit side by side.
    const chip = { h: 24, size: 12 };
    if (typeChipsWidth(ctx, slot.types, chip) <= cw - 16) {
      drawTypeChips(ctx, slot.types, cx - typeChipsWidth(ctx, slot.types, chip) / 2, rowTop + 288, chip);
    } else {
      slot.types.forEach((t, j) => drawTypeChips(ctx, [t], cx - typeChipsWidth(ctx, [t], chip) / 2, rowTop + 288 + j * 28, chip));
    }
    drawExpBar(ctx, x + 14, rowTop + rowH - 16, cw - 28, slot.expFrac, { h: 6 });
  }
}

// ---------- entry point ----------

const DRAW = { grid: drawGrid, roster: drawRoster, hybrid: drawHybrid };
// Layered layouts: base drawn once, sprites per frame, then the top layer.
const LAYERED = { refined: refinedLayout };

/**
 * Renders a team view.
 * @param {object} view       buildTeamView() output
 * @param {object} opts
 *   layout: "grid" | "roster" | "hybrid"
 *   animate: false → PNG Buffer; true → GIF Buffer (sprites play)
 *   frames, delayMs: animation length (default 24 × 100 ms)
 */
export async function renderShowteam(view, { layout = "hybrid", animate = false, frames = 24, delayMs = 100, env = process.env } = {}) {
  const size = LAYOUTS[layout] && sizeFor(layout, view);
  if (!size) throw new Error(`Unknown layout ${layout}`);
  const ph = await loadPlaceholder();
  const sprites = await Promise.all(view.slots.map(async (s) => (await loadStaticSprite(s.spriteId ?? s.id, s.variant)) ?? ph));
  const trainer = layout === "hybrid" ? await loadTrainerSprite(view.trainerFile) : null;
  const canvas = createCanvas(size.w, size.h);
  const ctx = canvas.getContext("2d");

  const layered = LAYERED[layout];
  // Shiny backdrop context for the layered (refined) layout.
  const fx = { enabled: shinyFxEnabled(env), frame: 0, total: frames, anims: null, cache: new Map() };
  if (!animate) {
    if (layered) {
      layered.base(ctx, view, size.h);
      layered.sprites(ctx, view, sprites, () => null, fx);
      layered.top(ctx, view);
    } else DRAW[layout](ctx, view, sprites, () => null, trainer);
    return canvas.toBuffer("image/png");
  }
  // Animated: each slot's GIF plays through the battle's sprite player.
  const anim = await Promise.all(view.slots.map((s, i) => (sprites[i]?.placeholder ? null : loadAnimatedSprite(s.spriteId ?? s.id, s.variant))));
  const players = anim.map((a) => (a && a.gif.numFrames() > 1 ? spritePlayer(a) : null));
  let ms = 0;
  const frameFor = (i) => (players[i] ? players[i](ms) : null);
  fx.anims = anim;
  if (layered) {
    // Everything except the sprites is drawn once and copied into each frame.
    const base = createCanvas(size.w, size.h);
    layered.base(base.getContext("2d"), view, size.h);
    return encodeGif(canvas, (f) => {
      ms = f * delayMs;
      fx.frame = f;
      ctx.drawImage(base, 0, 0);
      layered.sprites(ctx, view, sprites, frameFor, fx);
      layered.top(ctx, view);
    }, frames, delayMs);
  }
  return encodeGif(canvas, (f) => {
    ms = f * delayMs;
    DRAW[layout](ctx, view, sprites, frameFor, trainer);
  }, frames, delayMs);
}
