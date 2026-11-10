// ==========================================================
// utils/render/catchCard.js
// The catch announcement card: a compact banner (900 × 200, about 550 × 122
// in Discord) with the animated sprite on a tier-lit platform, name, Level,
// types, rarity, National Pokédex number, and NEW or +EXP. Pokédex progress
// is private, so it lives on /daily and /pokedex instead (dexProgress.js).
//
// catchView() reads the player AFTER grantCatch() and takes grantCatch's
// own result ({ level, isNew, expGained }). sightingView() is the same card
// for broadcasts that have no catch result (daily, starter pack, dashboard
// rewards): sprite, name, types and rarity only. Both are pure.
// ==========================================================

import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitFont, drawTypeChips, drawShinyMark, drawLevel, dexNo } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder } from "./sprites.js";
import { spriteStage } from "./stage.js";
import { displaySpeciesName } from "./names.js";
import { getSpecies, TYPE_ID_TO_NAME } from "../battle/data.js";
import { ALL_REGIONS } from "../../catalog/achievements.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
export const CATCH_SIZE = Object.freeze({ w: 900, h: 200 });
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

function speciesFacts(id, variant) {
  const entry = POKEMON[id] ?? {};
  return {
    id: Number(id),
    variant,
    shiny: variant === "shiny",
    name: displaySpeciesName(id, entry.name),
    types: getSpecies(id)?.types ?? (entry.types ?? []).map((t) => TYPE_ID_TO_NAME[t]).filter(Boolean),
    tier: String(entry.tier ?? "common").toLowerCase(),
    region: entry.region ?? null,
  };
}

/**
 * @param user        the player record after grantCatch
 * @param catchResult grantCatch's return: { level, isNew, expGained }
 */
export function catchView(user, { id, variant, catchResult, trainerName }) {
  const f = speciesFacts(id, variant);
  return {
    ...f,
    trainerName,
    level: catchResult.level,
    isNew: catchResult.isNew,
    expGained: catchResult.expGained,
    copies: user?.pokemon?.[id]?.[variant] ?? 1,
    dex: f.region ? regionCompletion(user, f.region) : null,
  };
}

/** A broadcast without a catch result: no Level, NEW/EXP or Pokédex line. */
export function sightingView({ id, shiny = false }) {
  return { ...speciesFacts(id, shiny ? "shiny" : "normal"), level: null, isNew: null, expGained: 0, copies: null, dex: null, sighting: true };
}

function drawPill(ctx, text, right, y, color) {
  ctx.font = font(17, 800);
  const w = ctx.measureText(text).width + 30;
  ctx.fillStyle = `${color}22`;
  rr(ctx, right - w, y, w, 32, 16);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${color}aa`;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - w + 15, y + 17);
  ctx.textBaseline = "alphabetic";
  return w;
}

/** PNG, or (animate: true) a looping GIF when the sprite is animated. */
export async function renderCatchCard(v, { animate = false } = {}) {
  const { w: W, h: H } = CATCH_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  const accent = v.shiny ? COLOR.gold : tierColor(v.tier);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 7, H); // tier (or shiny) edge, like an embed's color bar

  // Stage.
  const sw = 260, cx = 7 + sw / 2, floor = H - 30;
  const spot = ctx.createRadialGradient(cx, floor - 70, 8, cx, floor - 70, 170);
  spot.addColorStop(0, `${accent}2e`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(7, 0, sw, H);
  ctx.fillStyle = `${accent}3a`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 96, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${accent}aa`;
  ctx.stroke();
  const sprite = (await loadStaticSprite(v.id, v.variant)) ?? (await loadPlaceholder());
  stage.place(ctx, sprite, cx, floor + 6, sw - 30, floor - 16, { scale: 3 }, { id: v.id, variant: v.variant });

  // Text column.
  const x = 292, right = W - 28;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = v.shiny ? COLOR.gold : COLOR.textMuted;
  const eyebrow = v.sighting
    ? (v.shiny ? "SHINY POKÉMON FOUND!" : `${(TIER_NAME[v.tier] ?? "Common").toUpperCase()} POKÉMON FOUND!`)
    : (v.shiny ? "SHINY POKÉMON CAUGHT!" : "WILD POKÉMON CAUGHT!");
  ctx.fillText(eyebrow, x, 44);
  const pillW = drawPill(ctx, (TIER_NAME[v.tier] ?? "Common").toUpperCase(), right, 22, TIER[v.tier] ?? tierColor(v.tier));
  // National Pokédex number, beside the rarity pill.
  ctx.textAlign = "right";
  ctx.font = font(19, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(dexNo(v.id), right - pillW - 14, 44);
  ctx.textAlign = "left";

  // Name, shiny sparkle, then NEW or +EXP right beside the name.
  const tag = v.isNew === true ? { text: "NEW", fill: COLOR.blue, color: "#ffffff" }
    : v.isNew === false && v.expGained > 0 ? { text: `+${fmt(v.expGained)} EXP`, fill: "#16314f", color: COLOR.exp }
    : null;
  ctx.font = font(17, 800);
  const tagW = tag ? ctx.measureText(tag.text).width + 26 : 0;
  const nm = fitFont(ctx, v.name, right - x - (v.shiny ? 44 : 0) - (tag ? tagW + 16 : 0), 52, 30, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, x, 104);
  let after = x + ctx.measureText(nm.text).width;
  if (v.shiny) { drawShinyMark(ctx, after + 24, 104 - nm.size * 0.4, 13); after += 40; }
  if (tag) {
    const ty = Math.round(104 - nm.size * 0.36 - 16); // centred on the name's capitals
    ctx.fillStyle = tag.fill;
    rr(ctx, after + 16, ty, tagW, 32, 16);
    ctx.fill();
    ctx.font = font(17, 800);
    ctx.fillStyle = tag.color;
    ctx.textBaseline = "middle";
    ctx.fillText(tag.text, after + 16 + 13, ty + 17);
    ctx.textBaseline = "alphabetic";
  }

  // Level and types.
  let rx = x;
  if (v.level != null) rx += drawLevel(ctx, v.level, x, 158, { size: 32 }) + 16;
  const chip = { h: 34, size: 18, gap: 8 };
  if (v.types.length) drawTypeChips(ctx, v.types, rx, 132, chip);

  // Pokédex progress is the catcher's own business: it is not on the public
  // card (and would read confusingly next to the National Pokédex number).
  return stage.output(canvas);
}
