// ==========================================================
// utils/render/trainerCard.js
// /trainercard and /showcard as one image: the equipped trainer on a
// tier-lit platform, rank with progress to the next one, TP / CC, the
// collection numbers, battle record, and the Team strip (the battle Team,
// from buildTeamView, same as /showteam). Read-only.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBall, drawShinyMark, drawMegaTag } from "./primitives.js";
import { createCanvas as makeCanvas } from "@napi-rs/canvas";
import { loadStaticSprite, loadTrainerSprite, loadTrainerPoses, loadPlaceholder, spriteScale } from "./sprites.js";
import { spriteStage, FRAMES } from "./stage.js";
import { createBackdrop, hasBackdrop } from "./trainerBackdrop.js";
import { poseAtFrame } from "../trainerIdle.js";
import { trainersAnimated } from "../trainerAssets.js";
import { buildTeamView } from "./teamView.js";
import { getRankProgress } from "../rankSystem.js";

export const TRAINER_CARD_SIZE = Object.freeze({ w: 1200, h: 640 });
const M = 20, LEFT_W = 360;
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

/**
 * @param trainer { name, tier } of the equipped trainer (from trainerSprites.json), or null
 */
export function trainerCardView(user, { displayName, trainer }) {
  const owned = Object.entries(user?.pokemon ?? {}).filter(([k, v]) => /^\d+$/.test(k) && (v?.normal ?? 0) + (v?.shiny ?? 0) > 0);
  const trainers = Array.isArray(user?.trainers) ? user.trainers.length : Object.keys(user?.trainers ?? {}).length;
  const team = buildTeamView(user, { displayName });
  return {
    displayName,
    trainerFile: user?.displayedTrainer ?? null,
    trainer: trainer ?? null,
    rank: getRankProgress(user?.tp ?? 0),
    tp: user?.tp ?? 0,
    cc: user?.cc ?? 0,
    owned: owned.length,
    shinies: owned.filter(([, v]) => (v?.shiny ?? 0) > 0).length,
    trainers,
    battle: team.battle,
    team: team.slots,
    fallbackTeam: team.fallback,
  };
}

/**
 * The Epic+ tier backdrop behind the trainer, on a grid of the trainer's own
 * on-card pixels (so its pixel art lines up with the sprite). Animated through
 * the stage; one still frame when TRAINERS_ANIMATED=0 or for PNG cards.
 */
export function trainerBackdrop(ctx, stage, { tier, sprite, cx, box, panel, floor }) {
  const s = spriteScale(sprite.width, sprite.height, box.w, box.h, box.scale);
  const w = Math.round(sprite.width * s), h = Math.round(sprite.height * s);
  const x = Math.round(cx - w / 2), y = Math.round(box.floor - h);
  const u = s; // one grid cell = one sprite pixel on the card
  const X0 = x - u * Math.floor((x - panel.x) / u), Y0 = y - u * Math.floor((y - panel.y) / u);
  const gridW = Math.floor((panel.x + panel.w - X0) / u), gridH = Math.floor((floor + 20 - Y0) / u);
  const ox = Math.round((x - X0) / u), oy = Math.round((y - Y0) / u);
  // Silhouette mask (dilated 3 cells), so sparkles never sit behind the trainer.
  const px = makeCanvas(sprite.width, sprite.height);
  px.getContext("2d").drawImage(sprite.image, 0, 0);
  const rgba = px.getContext("2d").getImageData(0, 0, sprite.width, sprite.height).data;
  const mask = new Uint8Array(gridW * gridH);
  for (let sy = 0; sy < sprite.height; sy++) for (let sx = 0; sx < sprite.width; sx++) {
    if (rgba[(sy * sprite.width + sx) * 4 + 3] < 8) continue;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const gx = ox + sx + dx, gy = oy + sy + dy;
      if (gx >= 0 && gy >= 0 && gx < gridW && gy < gridH) mask[gy * gridW + gx] = 1;
    }
  }
  const bd = createBackdrop({
    tier, gridW, gridH, mask, frames: FRAMES,
    halo: { cx: (cx - X0) / u, cy: (y + h * 0.45 - Y0) / u, rx: 40, ry: 54 },
    floorRow: Math.floor((floor - Y0) / u),
  });
  if (!bd) return;
  const draw = (c, f) => {
    c.imageSmoothingEnabled = false;
    c.drawImage(bd.frame(f), X0, Y0, gridW * u, gridH * u);
    c.imageSmoothingEnabled = true;
  };
  if (trainersAnimated()) stage.layer(ctx, draw);
  else draw(ctx, 0);
}

function stat(ctx, label, value, x, y, w, color = COLOR.text) {
  ctx.fillStyle = "#1a2135";
  rr(ctx, x, y, w, 86, 14);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#323c5c";
  ctx.stroke();
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(label, x + 18, y + 30);
  const v = fitFont(ctx, value, w - 36, 32, 20, 800);
  ctx.font = font(v.size, 800);
  ctx.fillStyle = color;
  ctx.fillText(v.text, x + 18, y + 70);
}

export async function renderTrainerCard(v, { animate = false } = {}) {
  const { w: W, h: H } = TRAINER_CARD_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // ---- Left: the equipped trainer ----
  const tier = String(v.trainer?.tier ?? "common").toLowerCase();
  const accent = tierColor(tier);
  ctx.fillStyle = "#171d30";
  rr(ctx, M, M, LEFT_W, H - 2 * M, 18);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${accent}88`;
  ctx.stroke();
  const cx = M + LEFT_W / 2, floor = M + 400;
  const t = await loadTrainerSprite(v.trainerFile);
  // Epic and above get the pixel-art tier backdrop; Rare and below a plain
  // panel. (The old smooth spotlight banded into rings once the breathing
  // trainer made every card a GIF.) The tier-lit platform below stays for all.
  const fancy = Boolean(t && hasBackdrop(tier));
  ctx.fillStyle = `${accent}3a`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 120, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${accent}aa`;
  ctx.stroke();
  if (t) {
    const idle = await loadTrainerPoses(v.trainerFile);
    const box = { w: LEFT_W - 40, h: 330, floor: floor + 6, scale: 4 };
    if (fancy) trainerBackdrop(ctx, stage, { tier, sprite: t, cx, box, panel: { x: M, y: M, w: LEFT_W }, floor });
    stage.placePosed(ctx, idle?.poses ?? [t], poseAtFrame, cx, box.floor, box.w, box.h, { scale: box.scale });
  } else { ctx.globalAlpha = 0.35; drawBall(ctx, cx, floor - 70, 40, false); ctx.globalAlpha = 1; }
  ctx.textAlign = "center";
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("TRAINER", cx, floor + 58);
  const tn = fitFont(ctx, v.trainer?.name ?? "No trainer equipped", LEFT_W - 40, 30, 20, 800);
  ctx.font = font(tn.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(tn.text, cx, floor + 94);
  if (v.trainer) {
    const label = (TIER_NAME[tier] ?? "Common").toUpperCase();
    ctx.font = font(17, 800);
    const pw = ctx.measureText(label).width + 30;
    ctx.fillStyle = `${accent}22`;
    rr(ctx, cx - pw / 2, floor + 112, pw, 32, 16);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `${accent}aa`;
    ctx.stroke();
    ctx.fillStyle = TIER[tier] ?? accent;
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, floor + 129);
    ctx.textBaseline = "alphabetic";
  }
  ctx.textAlign = "left";

  // ---- Right: identity, rank, stats, Team ----
  const rx = M + LEFT_W + 24, rw = W - rx - M;
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("TRAINER CARD", rx, M + 26);
  const nm = fitFont(ctx, v.displayName, rw, 46, 28, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, rx, M + 74);

  // Rank + progress to the next rank.
  ctx.font = font(24, 800);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText(v.rank.current ?? "Unranked", rx, M + 118);
  ctx.textAlign = "right";
  ctx.font = font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(v.rank.next ? `${fmt(v.rank.remaining)} TP to ${v.rank.next}` : "Top rank reached", rx + rw, M + 118);
  ctx.textAlign = "left";
  ctx.fillStyle = "#0c111e";
  rr(ctx, rx, M + 132, rw, 10, 5);
  ctx.fill();
  ctx.fillStyle = COLOR.gold;
  rr(ctx, rx, M + 132, Math.max(10, (rw * v.rank.progress) / 100), 10, 5);
  ctx.fill();

  // Stat tiles.
  const sy = M + 166, gap = 12, sw = (rw - 3 * gap) / 4;
  stat(ctx, "TP", fmt(v.tp), rx, sy, sw);
  stat(ctx, "CC", fmt(v.cc), rx + (sw + gap), sy, sw, COLOR.gold);
  stat(ctx, "POKÉMON", fmt(v.owned), rx + 2 * (sw + gap), sy, sw);
  stat(ctx, "SHINY", fmt(v.shinies), rx + 3 * (sw + gap), sy, sw, COLOR.gold);
  const sy2 = sy + 86 + gap;
  stat(ctx, "TRAINERS", fmt(v.trainers), rx, sy2, sw);
  stat(ctx, "BATTLE RATING", v.battle ? fmt(v.battle.rating) : "—", rx + (sw + gap), sy2, sw);
  stat(ctx, "RECORD", v.battle ? `${v.battle.wins}W–${v.battle.losses}L` : "—", rx + 2 * (sw + gap), sy2, 2 * sw + gap);

  // Team strip.
  const ty = sy2 + 86 + 20;
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(v.fallbackTeam ? "TEAM  (none set: first Pokémon owned)" : "TEAM", rx, ty + 14);
  const slotW = (rw - 5 * 10) / 6, slotH = H - M - (ty + 26);
  const ph = await loadPlaceholder();
  for (let i = 0; i < 6; i++) {
    const x = rx + i * (slotW + 10), y = ty + 26;
    const s = v.team[i];
    ctx.fillStyle = s ? "#1a2135" : "#ffffff05";
    rr(ctx, x, y, slotW, slotH, 12);
    ctx.fill();
    ctx.lineWidth = s?.shiny || i === 0 ? 2.5 : 1.5;
    ctx.strokeStyle = !s ? "#2a3350" : s.shiny ? COLOR.gold : i === 0 ? COLOR.blue : s.mega ? COLOR.mega : "#323c5c";
    ctx.stroke();
    if (!s) continue;
    const spriteId = s.spriteId ?? s.id; // a Mega slot (teamView) draws its Mega sprite
    const sp = (await loadStaticSprite(spriteId, s.variant)) ?? ph;
    stage.place(ctx, sp, x + slotW / 2, y + slotH - 40, slotW - 12, slotH - 50, { scale: 2 }, { id: spriteId, variant: s.variant });
    ctx.textAlign = "center";
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(fitText(ctx, `Lv ${s.level}`, slotW - 10), x + slotW / 2, y + slotH - 14);
    ctx.textAlign = "left";
    if (s.shiny) drawShinyMark(ctx, x + slotW - 18, y + 18, 8);
    if (s.mega) drawMegaTag(ctx, x + 7, y + 7, { h: 20, size: 11 });
  }
  return stage.output(canvas);
}
