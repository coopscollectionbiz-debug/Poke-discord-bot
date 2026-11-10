// ==========================================================
// utils/render/catchCard.js — PROTOTYPE: the random-catch announcement
// as one image card, replacing today's embed (80 px thumbnail under a
// "GIF" badge, the catch said twice, no types or Level).
//
// catchView() reads the player AFTER grantCatch() and takes grantCatch's
// own result ({ level, isNew, expGained }), which the live code currently
// discards. Pure: never mutates the record.
// ==========================================================

import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitText, fitFont, drawTypeChips, typeChipsWidth, drawShinyMark, drawLevel, levelWidth } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { loadSprite as loadAnimated, spritePlayer } from "../battle/render.js";
import { encodeGif } from "./gif.js";
import { displaySpeciesName } from "./names.js";
import { getSpecies, TYPE_ID_TO_NAME } from "../battle/data.js";
import { ALL_REGIONS } from "../../catalog/achievements.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
export const CATCH_SIZE = Object.freeze({ w: 1000, h: 360 });
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

/** Distinct species owned now in a region (CONTEXT.md "Pokédex completion"). */
export function regionCompletion(user, region) {
  const total = ALL_REGIONS[region];
  if (!total) return null;
  let owned = 0;
  for (const [key, v] of Object.entries(user?.pokemon ?? {})) {
    if (!/^\d+$/.test(key) || POKEMON[key]?.region !== region) continue;
    if ((v?.normal ?? 0) + (v?.shiny ?? 0) > 0) owned++;
  }
  return { region, owned, total };
}

/**
 * @param user        the player record after grantCatch
 * @param catchResult grantCatch's return: { level, isNew, expGained }
 */
export function catchView(user, { id, variant, catchResult, trainerName }) {
  const entry = POKEMON[id] ?? {};
  const species = getSpecies(id);
  return {
    trainerName,
    id,
    variant,
    shiny: variant === "shiny",
    name: displaySpeciesName(id, entry.name),
    types: species?.types ?? (entry.types ?? []).map((t) => TYPE_ID_TO_NAME[t]).filter(Boolean),
    tier: String(entry.tier ?? "common").toLowerCase(),
    level: catchResult.level,
    isNew: catchResult.isNew,
    expGained: catchResult.expGained,
    copies: user?.pokemon?.[id]?.[variant] ?? 1,
    dex: entry.region ? regionCompletion(user, entry.region) : null,
  };
}

function drawCard(ctx, v) {
  const { w: W, h: H } = CATCH_SIZE;
  const accent = v.shiny ? COLOR.gold : tierColor(v.tier);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Tier (or shiny) color edge on the left, like an embed's color bar.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 8, H);

  // Stage.
  const sx = 8, sw = 340, cx = sx + sw / 2, floor = H - 62;
  const spot = ctx.createRadialGradient(cx, floor - 100, 10, cx, floor - 100, 220);
  spot.addColorStop(0, `${accent}2e`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(sx, 0, sw, H);
  ctx.fillStyle = `${accent}3a`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 118, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${accent}aa`;
  ctx.stroke();

  // Text column.
  const x = 372, right = W - 36;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(22, 800);
  ctx.fillStyle = v.shiny ? COLOR.gold : COLOR.textMuted;
  const eyebrow = v.shiny ? "SHINY POKÉMON CAUGHT!" : "WILD POKÉMON CAUGHT!";
  ctx.fillText(eyebrow, x, 62);

  // Rarity pill, top right.
  const label = (TIER_NAME[v.tier] ?? "Common").toUpperCase();
  ctx.font = font(19, 800);
  const pw = ctx.measureText(label).width + 36;
  ctx.fillStyle = `${tierColor(v.tier)}22`;
  rr(ctx, right - pw, 36, pw, 36, 18);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${tierColor(v.tier)}aa`;
  ctx.stroke();
  ctx.fillStyle = TIER[v.tier] ?? tierColor(v.tier);
  ctx.textBaseline = "middle";
  ctx.fillText(label, right - pw + 18, 55);
  ctx.textBaseline = "alphabetic";

  // Name.
  const nm = fitFont(ctx, v.name, right - x - (v.shiny ? 50 : 0), 64, 36, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, x, 134);
  if (v.shiny) drawShinyMark(ctx, x + ctx.measureText(nm.text).width + 28, 134 - nm.size * 0.42, 15);

  // Level + types.
  const lw = drawLevel(ctx, v.level, x, 196, { size: 38 });
  if (v.types.length) drawTypeChips(ctx, v.types, x + lw + 20, 166, { h: 40, size: 22, gap: 10 });

  // Outcome: NEW (first catch of this species + variant) or the duplicate's EXP.
  let bx = x;
  const tag = (text, fill, color) => {
    ctx.font = font(21, 800);
    const w = ctx.measureText(text).width + 32;
    ctx.fillStyle = fill;
    rr(ctx, bx, 230, w, 40, 20);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 16, 251);
    ctx.textBaseline = "alphabetic";
    bx += w + 12;
  };
  if (v.isNew) tag("NEW", COLOR.blue, "#ffffff");
  else {
    if (v.expGained > 0) tag(`+${fmt(v.expGained)} EXP`, "#5ab4ff26", COLOR.exp);
    tag(`×${fmt(v.copies)} owned`, "#ffffff12", COLOR.textMuted);
  }

  // Footer: who caught it, and regional Pokédex progress.
  ctx.fillStyle = COLOR.line;
  ctx.fillRect(x, 292, right - x, 1.5);
  let nameRoom = right - x;
  if (v.dex) {
    const txt = `${v.dex.region} Pokédex  ${v.dex.owned}/${v.dex.total}`;
    ctx.font = font(20, 700);
    const tw = ctx.measureText(txt).width;
    const barW = 120, bxr = right - barW;
    nameRoom = bxr - 16 - tw - 28 - x; // the trainer name never runs into the Pokédex line
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(txt, bxr - 16 - tw, 330);
    ctx.fillStyle = "#0c111e";
    rr(ctx, bxr, 318, barW, 10, 5);
    ctx.fill();
    ctx.fillStyle = COLOR.exp;
    rr(ctx, bxr, 318, Math.max(10, (barW * v.dex.owned) / v.dex.total), 10, 5);
    ctx.fill();
  }
  ctx.font = font(22, 600);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(fitText(ctx, `Caught by ${v.trainerName}`, nameRoom), x, 330);
  return { cx, floor };
}

/** PNG (default) or looping GIF of the catch card. */
export async function renderCatchCard(v, { animate = false, frames = 20, delayMs = 100 } = {}) {
  const { w: W, h: H } = CATCH_SIZE;
  const sprite = (await loadStaticSprite(v.id, v.variant)) ?? (await loadPlaceholder());
  const base = createCanvas(W, H);
  const { cx, floor } = drawCard(base.getContext("2d"), v);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const draw = (frame) => {
    ctx.drawImage(base, 0, 0);
    drawSprite(ctx, sprite, cx, floor + 8, 320, floor - 14, { scale: 3, frame });
  };
  if (!animate) {
    draw(null);
    return canvas.toBuffer("image/png");
  }
  const anim = sprite.placeholder ? null : await loadAnimated(v.variant, v.id);
  const play = anim && anim.gif.numFrames() > 1 ? spritePlayer(anim) : null;
  return encodeGif(canvas, (f) => draw(play ? play(f * delayMs) : null), frames, delayMs);
}
