// ==========================================================
// utils/render/catchCard.js
// The catch announcement card: a small banner drawn at the size Discord shows
// it (320 × 96, the width of the old embed: Discord shows an image at its own
// size, up to about 550 wide) with the animated sprite on a tier-lit platform, name, Level, types,
// rarity, National Pokédex number, and NEW or +EXP. Pokédex progress is
// private, so it lives on /daily and /pokedex instead (dexProgress.js).
//
// catchView() reads the player AFTER grantCatch() and takes grantCatch's
// own result ({ level, isNew, expGained }). sightingView() is the same card
// for broadcasts that have no catch result (daily, starter pack, dashboard
// rewards): sprite, name, types and rarity only. Both are pure.
// ==========================================================

import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitFont, drawTypeChips, drawShinyMark, drawLevel, dexNo, fillTextMid, drawSoftPlatform } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder } from "./sprites.js";
import { spriteStage } from "./stage.js";
import { displaySpeciesName } from "./names.js";
import { getSpecies, TYPE_ID_TO_NAME } from "../battle/data.js";
import { ALL_REGIONS } from "../../catalog/achievements.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
export const CATCH_SIZE = Object.freeze({ w: 320, h: 96 });
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

function drawPill(ctx, text, right, y, color, { h = 18, size = 10 } = {}) {
  ctx.font = font(size, 800);
  const w = Math.ceil(ctx.measureText(text).width) + h * 0.9;
  ctx.fillStyle = `${color}22`;
  rr(ctx, right - w, y, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `${color}aa`;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  fillTextMid(ctx, text, right - w / 2, y + h / 2);
  ctx.textAlign = "left";
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
  ctx.fillRect(0, 0, 4, H); // tier (or shiny) edge, like an embed's color bar

  // Stage: the sprite at 1× (B/W sprites are 96 px), hard pixel edges.
  const sw = 92, cx = 4 + sw / 2, floor = H - 9;
  const spot = ctx.createRadialGradient(cx, floor - 34, 4, cx, floor - 34, 70);
  spot.addColorStop(0, `${accent}2e`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(4, 0, sw, H);
  // The floor: a dithered pixel platform, like the floors under Pokémon in battle.
  drawSoftPlatform(ctx, cx, floor, 36, 6, accent, { u: 2, peak: 0.6 });
  const sprite = (await loadStaticSprite(v.id, v.variant)) ?? (await loadPlaceholder());
  stage.place(ctx, sprite, cx, floor + 3, sw - 4, floor - 2, { scale: 1 }, { id: v.id, variant: v.variant });

  // Text column. No "WILD POKÉMON CAUGHT!" line: the message text above the
  // card already says it, and the rarity pill carries a sighting's tier.
  const x = 102, right = W - 10;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(11, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(dexNo(v.id), x, 25); // National Pokédex number
  drawPill(ctx, (TIER_NAME[v.tier] ?? "Common").toUpperCase(), right, 11, TIER[v.tier] ?? tierColor(v.tier));

  // Name, shiny sparkle, then NEW or +EXP right beside the name.
  const tag = v.isNew === true ? { text: "NEW", fill: COLOR.blue, color: "#ffffff" }
    : v.isNew === false && v.expGained > 0 ? { text: `+${fmt(v.expGained)} EXP`, fill: "#16314f", color: COLOR.exp }
    : null;
  const nameY = 56;
  ctx.font = font(10, 800);
  const tagW = tag ? Math.ceil(ctx.measureText(tag.text).width) + 16 : 0;
  const nm = fitFont(ctx, v.name, right - x - (v.shiny ? 24 : 0) - (tag ? tagW + 8 : 0), 24, 13, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, x, nameY);
  let after = x + ctx.measureText(nm.text).width;
  if (v.shiny) { drawShinyMark(ctx, after + 12, nameY - nm.size * 0.42, 7); after += 22; }
  if (tag) {
    const th = 18, ty = Math.round(nameY - nm.size * 0.36 - th / 2); // centred on the name's capitals
    ctx.fillStyle = tag.fill;
    rr(ctx, after + 8, ty, tagW, th, th / 2);
    ctx.fill();
    ctx.font = font(10, 800);
    ctx.fillStyle = tag.color;
    ctx.textAlign = "center";
    fillTextMid(ctx, tag.text, after + 8 + tagW / 2, ty + th / 2);
    ctx.textAlign = "left";
  }

  // Level and types.
  let rx = x;
  if (v.level != null) rx += drawLevel(ctx, v.level, x, 82, { size: 17 }) + 8;
  if (v.types.length) drawTypeChips(ctx, v.types, rx, 67, { h: 18, size: 10, gap: 4 });

  // Pokédex progress is the catcher's own business: it is not on the public
  // card (and would read confusingly next to the National Pokédex number).
  return stage.output(canvas);
}
