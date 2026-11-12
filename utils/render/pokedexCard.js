// ==========================================================
// utils/render/pokedexCard.js
// /pokedex entry as one image: the sprite (normal or shiny), dex number,
// name, types, rarity, region, flavor text, the evolution line, and how
// many of each variant the player owns. Sprites #650+ keep their artist
// credit on the card (as the old embed footer did). Read-only.
// ==========================================================

import fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitText, fitFont, drawTypeChips, drawShinyMark, dexNo, fillTextMid, drawSoftPlatform } from "./primitives.js";
import { loadStaticSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { spriteStage } from "./stage.js";
import { displaySpeciesName } from "./names.js";
import { dexProgress, drawDexProgress } from "./dexProgress.js";
import { spriteRecord } from "../sprites.js";
import { getSpecies, TYPE_ID_TO_NAME } from "../battle/data.js";
import { registeredMask, copiesOf } from "../../services/box.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
export const POKEDEX_SIZE = Object.freeze({ w: 1000, h: 560 });
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

/** The entry's facts for one species and the viewer's record. */
export function pokedexView(id, user) {
  const p = POKEMON[id] ?? {};
  const names = (ids) => {
    const all = (Array.isArray(ids) ? ids : []).map((x) => displaySpeciesName(x, POKEMON[x]?.name));
    return all.length > 2 ? [`${all[0]} +${all.length - 1} more`] : all; // Eevee has eight
  };
  const owned = user?.pokemon?.[id] ?? {};
  const credit = Number(id) >= 650 ? spriteRecord(id)?.credit : null;
  return {
    id: Number(id),
    name: displaySpeciesName(id, p.name),
    types: getSpecies(id)?.types ?? (p.types ?? []).map((t) => TYPE_ID_TO_NAME[t]).filter(Boolean),
    tier: String(p.tier ?? "common").toLowerCase(),
    region: p.region ?? null,
    flavor: p.flavor ?? "",
    from: names(p.evolvesFrom),
    to: names(p.evolvesTo),
    normal: Number(owned.normal ?? 0),
    shiny: Number(owned.shiny ?? 0),
    // Pokédex (docs/adr/0001): ever caught, per variant, and the best copy's Level now.
    caughtNormal: user ? (registeredMask(user, id) & 1) !== 0 : false,
    caughtShiny: user ? (registeredMask(user, id) & 2) !== 0 : false,
    bestNormal: user ? copiesOf(user, id, "normal")[0]?.level ?? null : null,
    bestShiny: user ? copiesOf(user, id, "shiny")[0]?.level ?? null : null,
    dex: user ? dexProgress(user, [id]) : null, // the viewer's own progress: this region + national
    credit: credit ? `Sprite: ${credit.artist ? `${credit.artist}, ` : ""}${String(credit.project ?? "").replace(/ \(.*$/, "")} · /credits` : null,
  };
}

/** Word-wraps text into at most `maxLines` lines of `width`. */
function wrap(ctx, text, width, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width) line = next;
    else { lines.push(line); line = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) lines[maxLines - 1] = fitText(ctx, `${lines[maxLines - 1]}…`, width);
  return lines;
}

export async function renderPokedexCard(v, { shiny = false, animate = false } = {}) {
  const { w: W, h: H } = POKEDEX_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  const accent = shiny ? COLOR.gold : tierColor(v.tier);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Stage with the dex number above it.
  const sw = 360, cx = sw / 2, floor = H - 96;
  const spot = ctx.createRadialGradient(cx, floor - 120, 10, cx, floor - 120, 240);
  spot.addColorStop(0, `${accent}2e`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, sw, H);
  ctx.font = font(22, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(dexNo(v.id), 28, 44);
  // The floor: a dithered pixel platform, like the floors under Pokémon in battle.
  drawSoftPlatform(ctx, cx, floor, 124, 22, accent, { u: 4, peak: 0.6 });
  const sprite = (await loadStaticSprite(v.id, shiny ? "shiny" : "normal")) ?? (await loadPlaceholder());
  stage.place(ctx, sprite, cx, floor + 8, sw - 30, floor - 70, { scale: 3 }, { id: v.id, variant: shiny ? "shiny" : "normal" });
  ctx.textAlign = "center";
  ctx.font = font(17, 800);
  ctx.fillStyle = shiny ? COLOR.gold : COLOR.textMuted;
  ctx.fillText(shiny ? "SHINY SPRITE" : "NORMAL SPRITE", cx, floor + 50);
  if (v.credit) {
    ctx.font = font(13, 600);
    ctx.fillStyle = COLOR.textFaint;
    wrap(ctx, v.credit, sw - 30, 2).forEach((l, i, a) => ctx.fillText(l, cx, H - 14 - (a.length - 1 - i) * 17));
  }
  ctx.textAlign = "left";

  // Details.
  const x = 384, right = W - 32;
  const label = (TIER_NAME[v.tier] ?? "Common").toUpperCase();
  ctx.font = font(18, 800);
  const pw = ctx.measureText(label).width + 34;
  ctx.fillStyle = `${tierColor(v.tier)}22`;
  rr(ctx, right - pw, 26, pw, 34, 17);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${tierColor(v.tier)}aa`;
  ctx.stroke();
  ctx.fillStyle = TIER[v.tier] ?? tierColor(v.tier);
  fillTextMid(ctx, label, right - pw + 17, 43);
  ctx.font = font(20, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(`${(v.region ?? "Unknown").toUpperCase()} POKÉDEX`, x, 50);

  const nm = fitFont(ctx, v.name, right - x - (shiny ? 46 : 0), 56, 32, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, x, 112);
  if (shiny) drawShinyMark(ctx, x + ctx.measureText(nm.text).width + 26, 112 - nm.size * 0.4, 14);
  if (v.types.length) drawTypeChips(ctx, v.types, x, 132, { h: 36, size: 19, gap: 10 });

  // Flavor text.
  ctx.font = font(20, 500);
  ctx.fillStyle = "#cfd5e6";
  wrap(ctx, v.flavor, right - x, 3).forEach((l, i) => ctx.fillText(l, x, 210 + i * 30));

  // Evolution line.
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("EVOLUTION", x, 316);
  const chain = [...(v.from.length ? [v.from.join(" / ")] : []), v.name, ...(v.to.length ? [v.to.join(" / ")] : [])];
  let ex = x;
  chain.forEach((n, i) => {
    const me = n === v.name;
    ctx.font = font(20, 800);
    const t = fitText(ctx, n, (right - x) / chain.length - 30);
    const tw = ctx.measureText(t).width + 28;
    ctx.fillStyle = me ? `${accent}26` : COLOR.surfaceRaised;
    rr(ctx, ex, 326, tw, 40, 10);
    ctx.fill();
    if (me) { ctx.lineWidth = 2; ctx.strokeStyle = `${accent}aa`; ctx.stroke(); }
    ctx.fillStyle = me ? COLOR.text : COLOR.textMuted;
    fillTextMid(ctx, t, ex + 14, 346);
    ex += tw;
    if (i < chain.length - 1) {
      ctx.fillStyle = COLOR.textFaint;
      ctx.textBaseline = "middle";
      ctx.fillText("→", ex + 8, 347);
      ctx.textBaseline = "alphabetic";
      ex += 34;
    }
  });
  if (!v.from.length && !v.to.length) {
    ctx.font = font(16, 700);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("Does not evolve", ex + 14, 353);
  }

  // Ownership now, and whether the Pokédex has it (caught before, none now).
  const own = (lab, n, ox, color, caught = n > 0, best = null) => {
    const ok = n > 0;
    ctx.fillStyle = ok ? `${color}1f` : "#ffffff08";
    rr(ctx, ox, 392, (right - x - 12) / 2, 72, 12);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ok ? `${color}99` : "#323c5c";
    ctx.stroke();
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText(lab, ox + 16, 418);
    ctx.font = font(22, 800);
    ctx.fillStyle = ok ? color : COLOR.textFaint;
    ctx.fillText(ok ? `×${n}${best ? ` · Lv ${best}` : ""}` : caught ? "Caught · none now" : "Not caught", ox + 16, 450);
  };
  own("NORMAL", v.normal, x, "#3fd46c", v.caughtNormal, v.bestNormal);
  own("SHINY", v.shiny, x + (right - x - 12) / 2 + 12, COLOR.gold, v.caughtShiny, v.bestShiny);

  // The viewer's Pokédex progress (this reply is only visible to them).
  if (v.dex?.length) {
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText("YOUR POKÉDEX", x, 494);
    drawDexProgress(ctx, v.dex, x, 504, right - x);
  }
  return stage.output(canvas);
}
