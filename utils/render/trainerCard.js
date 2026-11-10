// ==========================================================
// utils/render/trainerCard.js
// /trainercard and /showcard as one image: the equipped trainer on a
// tier-lit platform, rank with progress to the next one, TP / CC, the
// collection numbers, battle record, the 8 Badges from /challenge, and the
// Team strip (the battle Team, from buildTeamView, same as /showteam). Read-only.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER, tierColor } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBall, drawShinyMark } from "./primitives.js";
import { loadStaticSprite, loadTrainerSprite, loadBadgeSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { buildTeamView } from "./teamView.js";
import { getRankProgress } from "../rankSystem.js";
import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";

export const TRAINER_CARD_SIZE = Object.freeze({ w: 1200, h: 708 });
const M = 20, LEFT_W = 360;
// The Badge row sits under the two rows of stat tiles. Badges are 16 px art
// stored at 8×, so 48 px is an exact 3× with smoothing off.
const BADGE = 48, BADGE_GAP = 14, BADGE_LABEL_W = 120, BADGE_ROW_Y = M + 166 + 2 * 86 + 12 + 20;

/** Where Badge i (Gym order) is drawn. */
export function badgeSlot(i) {
  return { x: M + LEFT_W + 24 + BADGE_LABEL_W + i * (BADGE + BADGE_GAP), y: BADGE_ROW_Y, size: BADGE };
}
const TIER_NAME = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

/**
 * @param trainer { name, tier } of the equipped trainer (from trainerSprites.json), or null
 */
export function trainerCardView(user, { displayName, trainer }) {
  const owned = Object.entries(user?.pokemon ?? {}).filter(([k, v]) => /^\d+$/.test(k) && (v?.normal ?? 0) + (v?.shiny ?? 0) > 0);
  const trainers = Array.isArray(user?.trainers) ? user.trainers.length : Object.keys(user?.trainers ?? {}).length;
  const team = buildTeamView(user, { displayName });
  const earned = earnedBadgeKeys(user);
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
    badges: GYM_BADGES.map((b) => ({ key: b.key, file: b.image.split("/").pop(), earned: earned.includes(b.key) })),
    battle: team.battle,
    team: team.slots,
    fallbackTeam: team.fallback,
  };
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

export async function renderTrainerCard(v) {
  const { w: W, h: H } = TRAINER_CARD_SIZE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
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
  const spot = ctx.createRadialGradient(cx, floor - 130, 10, cx, floor - 130, 240);
  spot.addColorStop(0, `${accent}30`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(M, M, LEFT_W, 460);
  ctx.fillStyle = `${accent}3a`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 120, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${accent}aa`;
  ctx.stroke();
  const t = await loadTrainerSprite(v.trainerFile);
  if (t) drawSprite(ctx, t, cx, floor + 6, LEFT_W - 40, 330, { scale: 4 });
  else { ctx.globalAlpha = 0.35; drawBall(ctx, cx, floor - 70, 40, false); ctx.globalAlpha = 1; }
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

  // Badges from /challenge: earned ones in color, the rest dimmed.
  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("BADGES", rx, BADGE_ROW_Y + 18);
  ctx.font = font(24, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(`${v.badges.filter((b) => b.earned).length}/${v.badges.length}`, rx, BADGE_ROW_Y + 46);
  ctx.imageSmoothingEnabled = false;
  for (const [i, b] of v.badges.entries()) {
    const sprite = await loadBadgeSprite(b.file);
    if (!sprite) continue;
    const { x, y, size } = badgeSlot(i);
    ctx.globalAlpha = b.earned ? 1 : 0.22;
    ctx.drawImage(sprite.image, x, y, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;

  // Team strip, under the Badge row.
  const ty = BADGE_ROW_Y + BADGE + 20;
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
    ctx.strokeStyle = !s ? "#2a3350" : s.shiny ? COLOR.gold : i === 0 ? COLOR.blue : "#323c5c";
    ctx.stroke();
    if (!s) continue;
    const sp = (await loadStaticSprite(s.id, s.variant)) ?? ph;
    drawSprite(ctx, sp, x + slotW / 2, y + slotH - 40, slotW - 12, slotH - 50, { scale: 2 });
    ctx.textAlign = "center";
    ctx.font = font(15, 800);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(fitText(ctx, `Lv ${s.level}`, slotW - 10), x + slotW / 2, y + slotH - 14);
    ctx.textAlign = "left";
    if (s.shiny) drawShinyMark(ctx, x + slotW - 18, y + 18, 8);
  }
  return canvas.toBuffer("image/png");
}
