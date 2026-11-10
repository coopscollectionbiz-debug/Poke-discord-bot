// ==========================================================
// utils/render/leaderboardCard.js
// /leaderboard as one image: a podium for the top three (their trainer
// sprites on gold / silver / bronze platforms), rows for 4–10 with each
// player's lead Pokémon, and the viewer's own position. Ranking is
// commands/leaderboard.js rankBattleRatings (unchanged); this only adds
// what each player shows (trainer sprite, lead) for drawing. Read-only.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBall } from "./primitives.js";
import { loadStaticSprite, loadTrainerSprite, loadTrainerPoses, drawSprite } from "./sprites.js";
import { poseAtFrame } from "../trainerIdle.js";
import { spriteStage } from "./stage.js";
import { buildTeam } from "../battle/runBattle.js";

const W = 1000, M = 20, HEADER = 84, PODIUM = 330, ROW = 66, YOU = 82;
const MEDAL = ["#f5c84c", "#c9d2e3", "#d48a52"];
const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
const winPct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) : 0);

/** Ranked players plus what to draw for each. */
export function leaderboardView(board, trainerData, viewerId) {
  const decorate = (p, position) => {
    const u = trainerData[p.userId] ?? {};
    const lead = buildTeam(u)[0] ?? null;
    return { ...p, position, trainerFile: u.displayedTrainer ?? null, lead: lead && { id: lead.megaForm ?? lead.speciesId, variant: lead.variant } /* a Mega lead (validated by buildTeam) shows as the Mega */, isYou: p.userId === viewerId };
  };
  const top = board.top.map((p, i) => decorate(p, i + 1));
  let you = null;
  if (board.you) you = board.you.position <= 10 ? top[board.you.position - 1] : decorate({ ...board.you, userId: viewerId, name: trainerData[viewerId]?.name ?? "You" }, board.you.position);
  return { top, you };
}

export const leaderboardSize = (v) => ({ w: W, h: M + HEADER + (v.top.length ? PODIUM : 120) + Math.max(0, v.top.length - 3) * ROW + YOU + M });

async function podium(ctx, p, cx, floor, height, place, stage) {
  const medal = MEDAL[place];
  // Pedestal.
  ctx.fillStyle = `${medal}26`;
  rr(ctx, cx - 120, floor, 240, height, 12);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.isYou ? COLOR.blue : `${medal}aa`;
  ctx.stroke();
  ctx.font = font(Math.min(44, height - 8), 800);
  ctx.fillStyle = medal;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(place + 1), cx, floor + height / 2 + 2);
  ctx.textBaseline = "alphabetic";
  // Platform + trainer sprite (or a ghost ball).
  ctx.fillStyle = `${medal}40`;
  ctx.beginPath();
  ctx.ellipse(cx, floor - 6, 92, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  const t = await loadTrainerSprite(p.trainerFile);
  if (t) {
    const idle = await loadTrainerPoses(p.trainerFile); // breathing idle, or null → static
    stage.placePosed(ctx, idle?.poses ?? [t], poseAtFrame, cx, floor, 200, 150, { scale: 2 });
  }
  else { ctx.globalAlpha = 0.35; drawBall(ctx, cx, floor - 40, 26, false); ctx.globalAlpha = 1; }
  // Name, rating, record above the sprite area's baseline.
  const top = floor - 196;
  const nm = fitFont(ctx, p.name ?? "Trainer", 230, 26, 17, 800);
  ctx.font = font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, cx, top);
  ctx.font = font(30, 800);
  ctx.fillStyle = medal;
  ctx.fillText(fmt(p.rating), cx, top + 34);
  ctx.textAlign = "left";
}

function row(ctx, p, y, lead, stage) {
  ctx.fillStyle = p.isYou ? "#4f8cff1f" : "#1a2135";
  rr(ctx, M, y, W - 2 * M, ROW - 8, 12);
  ctx.fill();
  ctx.lineWidth = p.isYou ? 2.5 : 1.5;
  ctx.strokeStyle = p.isYou ? COLOR.blue : "#323c5c";
  ctx.stroke();
  const cy = y + (ROW - 8) / 2;
  ctx.textBaseline = "middle";
  ctx.font = font(26, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.textAlign = "center";
  ctx.fillText(`#${p.position}`, M + 44, cy + 1);
  ctx.textAlign = "left";
  if (lead) stage.place(ctx, lead, M + 118, y + ROW - 12, 70, ROW - 14, { scale: 1 }, p.lead);
  ctx.font = font(24, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(fitText(ctx, p.name ?? "Trainer", 330), M + 168, cy + 1);
  ctx.font = font(20, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(`${p.wins}W–${p.losses}L  ·  ${winPct(p.wins, p.losses)}%`, M + 520, cy + 1);
  ctx.textAlign = "right";
  ctx.font = font(28, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(fmt(p.rating), W - M - 20, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** PNG of the leaderboard. */
export async function renderLeaderboard(v, { animate = false } = {}) {
  const { w, h } = leaderboardSize(v);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const stage = spriteStage({ animate });
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#131a2d");
  bg.addColorStop(1, "#1c1530");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(W / 2, HEADER + 120, 10, W / 2, HEADER + 120, 420);
  glow.addColorStop(0, "#f5c84c1a");
  glow.addColorStop(1, "#f5c84c00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.font = font(15, 800);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("BATTLE RATING", M + 4, M + 22);
  ctx.font = font(38, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText("Leaderboard", M + 4, M + 62);

  let y = M + HEADER;
  if (!v.top.length) {
    ctx.font = font(26, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText("No battles yet. Use /battle to start the ladder!", M + 4, y + 60);
    y += 120;
  } else {
    // Podium: 2nd · 1st · 3rd, with 1st tallest.
    const floorBase = y + PODIUM - 10;
    const spots = [[1, W / 2 - 260, 70], [0, W / 2, 104], [2, W / 2 + 260, 50]];
    for (const [i, cx, ht] of spots) if (v.top[i]) await podium(ctx, v.top[i], cx, floorBase - ht, ht, i, stage);
    y += PODIUM;
    for (const p of v.top.slice(3)) {
      const lead = p.lead ? await loadStaticSprite(p.lead.id, p.lead.variant) : null;
      row(ctx, p, y, lead, stage);
      y += ROW;
    }
  }

  // The viewer's own standing.
  y += 8;
  ctx.fillStyle = COLOR.line;
  ctx.fillRect(M, y, W - 2 * M, 1.5);
  if (v.you && v.you.position > 10) {
    const lead = v.you.lead ? await loadStaticSprite(v.you.lead.id, v.you.lead.variant) : null;
    row(ctx, { ...v.you, isYou: true }, y + 12, lead, stage);
  } else {
    ctx.font = font(24, 700);
    ctx.fillStyle = v.you ? COLOR.blue : COLOR.textMuted;
    ctx.textBaseline = "middle";
    ctx.fillText(v.you ? `You're #${v.you.position} with ${fmt(v.you.rating)}.` : "Battle someone to join the leaderboard.", M + 4, y + 40);
    ctx.textBaseline = "alphabetic";
  }
  return stage.output(canvas);
}
