// ==========================================================
// utils/render/battleCard.js
// /showbattlecard as one image (owner-approved design option 2,
// docs/design/TEAMS-COLLECTION-REDESIGN.md): a banner with the equipped
// trainer, name, rank, "ALL LV 50" / streak / Power chips and the ranked
// rating panel (rating, leaderboard position, W/L bar), then the Battle team
// as six cards, every member at Lv 50 with its real Level beside it.
// Built from the shared render pieces; animated through the sprite stage
// (breathing sprites, shiny backdrops, the trainer's tier backdrop).
// Read-only.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, TIER } from "./tokens.js";
import * as P from "./primitives.js";
import { loadStaticSprite, loadTrainerSprite, loadTrainerPoses, loadPlaceholder } from "./sprites.js";
import { spriteStage } from "./stage.js";
import { poseAtFrame } from "../trainerIdle.js";
import { hasBackdrop, drawTierSky } from "./trainerBackdrop.js";
import { trainerBackdrop } from "./trainerCard.js";
import { slotView } from "./teamView.js";
import { buildBattleTeam } from "../battle/runBattle.js";
import { teamPower } from "../battle/power.js";
import { rankedRecord } from "../battle/rewards.js";
import { RANKED } from "../battle/tuning.js";
import { getRank } from "../rankSystem.js";

export const BATTLE_CARD_SIZE = Object.freeze({ w: 1200, h: 560 });
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const winPct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) : 0);

/**
 * @param board   rankBattleRatings(trainerData, userId) ({ you, total })
 * @param trainer { name, tier } of the equipped trainer, or null
 */
export function battleCardView(user, { displayName = "Trainer", trainer = null, board = null, env = process.env } = {}) {
  const members = buildBattleTeam(user ?? {}, { env });
  const record = rankedRecord(user);
  return {
    displayName,
    trainerFile: user?.displayedTrainer ?? null,
    trainer,
    rank: getRank(user?.tp ?? 0) ?? "Unranked",
    rating: record.rating,
    wins: record.wins,
    losses: record.losses,
    played: record.wins + record.losses > 0,
    position: board?.you?.position ?? null,
    players: board?.total ?? null,
    // The battle achievements' win streak (ranked + wager, owner decision); only once this season has a result.
    streak: record.wins + record.losses > 0 ? Number(user?.stats?.winStreak) || 0 : 0,
    power: members.length ? teamPower(members) : 0, // at Lv 50
    team: members.map((m, i) => ({ ...slotView(user, { ...m, level: m.realLevel }, i), level: RANKED.level, realLevel: m.realLevel })),
  };
}

async function card(ctx, stage, s, x, y, w, h, i, ph) {
  const ring = s.shiny ? COLOR.gold : i === 0 ? COLOR.blue : s.mega ? COLOR.mega : null;
  P.drawCard(ctx, x, y, w, h, { fill: "#1a2135", stroke: "#323c5c", ring, radius: 14, shadow: false });
  const cx = x + w / 2, floor = y + h - 104;
  P.drawPlatform(ctx, cx, floor, w * 0.32, 12, i === 0 ? COLOR.blue : null);
  const spriteId = s.spriteId ?? s.id;
  const sp = (await loadStaticSprite(spriteId, s.variant)) ?? ph;
  stage.place(ctx, sp, cx, floor + 4, w - 24, floor - y - 14, { scale: 2 }, { id: spriteId, variant: s.variant });
  P.drawSlotBadge(ctx, i + 1, x + 22, y + 22, { r: 14, lead: i === 0 });
  let tx = x + w - 10;
  if (s.shiny) { P.drawShinyMark(ctx, tx - 12, y + 22, 9); tx -= 32; }
  if (s.mega) P.drawMegaTag(ctx, tx, y + 10, { h: 22, size: 12, align: "right" });
  if (s.tier === "mythic") {
    // Centered at the top of the card, clear of the slot badge (left) and the shiny/Mega marks (right).
    ctx.font = P.font(12, 800);
    const tw = Math.ceil(ctx.measureText("MYTHIC").width) + 22;
    P.drawTag(ctx, "MYTHIC", cx - tw / 2, y + 10, { fill: TIER.mythic, color: "#fff", h: 22, size: 12 });
  }
  ctx.textBaseline = "alphabetic"; // the badge and tags leave it on "middle"
  ctx.textAlign = "center";
  const nm = P.fitFont(ctx, s.name, w - 16, 22, 15, 800);
  ctx.font = P.font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, cx, floor + 36);
  ctx.textAlign = "left";
  const lw = P.levelWidth(ctx, s.level, 24);
  ctx.font = P.font(18, 700);
  const real = `(Lv ${s.realLevel})`;
  const rw = ctx.measureText(real).width;
  const lx = cx - (lw + 8 + rw) / 2;
  P.drawLevel(ctx, s.level, lx, floor + 64, { size: 24, color: COLOR.blue });
  ctx.font = P.font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(real, lx + lw + 8, floor + 64);
  const tw = P.typeChipsWidth(ctx, s.types, { h: 24, size: 14, gap: 6 });
  P.drawTypeChips(ctx, s.types, cx - tw / 2, floor + 76, { h: 24, size: 14, gap: 6 });
}

function emptySlot(ctx, x, y, w, h) {
  ctx.fillStyle = "#ffffff05";
  P.rr(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#2a3350";
  ctx.stroke();
  ctx.setLineDash([]);
}

export async function renderBattleCard(v, { animate = false } = {}) {
  const { w: W, h: H } = BATTLE_CARD_SIZE;
  const M = 20;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  P.drawBackground(ctx, W, H);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // ---- Banner ----
  P.drawCard(ctx, M, M, W - 2 * M, 190, { fill: "#171d30", stroke: "#4f8cff88", radius: 18, shadow: false });
  const tier = String(v.trainer?.tier ?? "common").toLowerCase();
  const t = await loadTrainerSprite(v.trainerFile);
  const tcx = M + 90, tfloor = M + 172;
  P.drawPlatform(ctx, tcx, M + 168, 62, 12, COLOR.blue);
  if (t) {
    const box = { w: 150, h: 160, floor: tfloor, scale: 2 };
    if (hasBackdrop(tier)) drawTierSky(ctx, tier, { x: M + 8, y: M + 8, w: 164, h: 174 }, { u: 2, clip: (c) => P.rr(c, M + 8, M + 8, 164, 174, 12) });
    if (hasBackdrop(tier)) trainerBackdrop(ctx, stage, { tier, sprite: t, cx: tcx, box, panel: { x: M + 8, y: M + 8, w: 164 }, floor: tfloor - 6 });
    const idle = await loadTrainerPoses(v.trainerFile);
    // Breathing trainers share one schedule here; a real animation plays its own frames.
    stage.placePosed(ctx, idle?.poses ?? [t], idle?.real ? idle.poseAt : poseAtFrame, tcx, box.floor, box.w, box.h, { scale: box.scale });
  } else { ctx.globalAlpha = 0.35; P.drawBall(ctx, tcx, M + 110, 34, false); ctx.globalAlpha = 1; }

  const bx = M + 190;
  ctx.font = P.font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("RANKED CARD", bx, M + 34);
  const nm = P.fitFont(ctx, v.displayName, 420, 42, 26, 800);
  ctx.font = P.font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, bx, M + 80);
  ctx.font = P.font(20, 800);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText(v.rank, bx, M + 110);
  let cx2 = bx;
  cx2 += P.drawTag(ctx, `ALL LV ${RANKED.level}`, cx2, M + 130, { fill: COLOR.blue, color: "#fff", h: 30, size: 15 }) + 8;
  if (v.streak > 0) cx2 += P.drawTag(ctx, `STREAK W${v.streak}`, cx2, M + 130, { fill: "#3fd46c", color: COLOR.ink, h: 30, size: 15 }) + 8;
  if (v.team.length) P.drawTag(ctx, `POWER ${fmt(v.power)}`, cx2, M + 130, { fill: COLOR.surfaceRaised, color: COLOR.text, h: 30, size: 15 });
  ctx.textBaseline = "alphabetic"; // drawTag leaves it on "middle"

  // Rating panel.
  const rx = W - M - 360;
  ctx.fillStyle = "#0c111e";
  P.rr(ctx, rx, M + 18, 340, 154, 14);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#f5c84c66";
  ctx.stroke();
  ctx.font = P.font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("RATING", rx + 20, M + 48);
  ctx.font = P.font(60, 800);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText(fmt(v.rating), rx + 20, M + 112);
  ctx.textAlign = "right";
  if (v.position) {
    ctx.font = P.font(30, 800);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(`#${v.position}`, rx + 320, M + 84);
    ctx.font = P.font(15, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(`of ${fmt(v.players)} ranked`, rx + 320, M + 108);
  } else {
    ctx.font = P.font(16, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText("Not on the", rx + 320, M + 80);
    ctx.fillText("leaderboard yet", rx + 320, M + 102);
  }
  ctx.textAlign = "left";
  const wx = rx + 20, ww = 300, wy = M + 132;
  ctx.fillStyle = v.played ? COLOR.red : COLOR.surfaceSunken;
  P.rr(ctx, wx, wy, ww, 12, 6);
  ctx.fill();
  if (v.wins) {
    ctx.fillStyle = "#3fd46c";
    P.rr(ctx, wx, wy, Math.max(12, ww * (v.wins / (v.wins + v.losses))), 12, 6);
    ctx.fill();
  }
  ctx.font = P.font(14, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(v.played ? `${v.wins}W – ${v.losses}L · ${winPct(v.wins, v.losses)}%` : "No ranked battles this season", wx, wy + 32);

  // ---- Battle team: six cards ----
  const ty = M + 190 + 16, gap = 10, sw = (W - 2 * M - 5 * gap) / 6, sh = H - M - ty;
  const ph = await loadPlaceholder();
  for (let i = 0; i < 6; i++) {
    const x = M + i * (sw + gap);
    if (v.team[i]) await card(ctx, stage, v.team[i], x, ty, sw, sh, i, ph);
    else emptySlot(ctx, x, ty, sw, sh);
  }
  if (!v.team.length) {
    ctx.textAlign = "center";
    ctx.font = P.font(22, 800);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText("Set your Ranked team on the Teams page (/dashboard)", W / 2, ty + sh / 2);
    ctx.textAlign = "left";
  }
  return stage.output(canvas);
}
