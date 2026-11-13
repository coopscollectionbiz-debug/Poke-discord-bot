// ==========================================================
// utils/render/battleVsCard.js
// The /battle VS card: the opening image of a battle's playback (and the
// image on a Wager offer). The Challenger on the left, the Defender on the
// right, each with their trainer and the Team that will fight; both are
// players, so each Epic+ trainer brings their tier backdrop across their
// half. The bottom bar names the mode (plus the pot on a Wager) and shows
// each player's record for it: Casual shows the lifetime casual W–L and win
// rate; Ranked and Wager (both rated) show the Ranked rating and this
// season's W–L. A streak of 3 or more wins shows in gold. Records are taken
// before the battle, so the card never gives the result away.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR } from "./tokens.js";
import { font, fitFont, drawBackground, drawCard, drawBall } from "./primitives.js";
import { drawHalves, drawVs, drawTeamGrid } from "./challengeCard.js";
import { spriteStage } from "./stage.js";
import { cardTrainerFx } from "./trainerTier.js";
import { backdropTint, hasBackdrop } from "./trainerBackdrop.js";
import { placeTrainer, occupancy, halfBackdrop } from "./vsField.js";

export const BATTLE_VS_SIZE = Object.freeze({ w: 1200, h: 640 });
const { w: W, h: H } = BATTLE_VS_SIZE;
const M = 24;
const FIELD = { h: 492, top: 640, bottom: 560 }; // the /challenge card's split field
const FLOOR = 466;
const BOX = 320;
const SLOTS = [{ cx: 190, grid: [348, 176] }, { cx: 1010, grid: [696, 176] }];

const MODES = {
  open: { label: "CASUAL BATTLE", team: "Display team · real Levels", rated: false },
  ranked: { label: "RANKED BATTLE", team: "Battle team · Lv 50", rated: true },
  wager: { label: "WAGER BATTLE", team: "Battle team · Lv 50", rated: true },
};

/**
 * One side of the card. `record` is the player's record for this mode before
 * the battle: { wins, losses, streak } plus `rating` for a rated mode.
 * `members` are the battle members ({ speciesId, variant }).
 */
export const vsSide = ({ name, trainerFile, tier, members, record }) => ({
  name,
  trainerFile: trainerFile ?? null,
  tier: tier ?? null,
  team: members.slice(0, 6).map((m) => ({ id: m.speciesId, variant: m.variant, shiny: m.variant === "shiny" })),
  record,
});

/** The image's description (Discord's alt text). */
export function battleVsAltText(v) {
  const m = MODES[v.mode] ?? MODES.open;
  const rec = (s) => (m.rated ? `rating ${s.record.rating}, ${s.record.wins}–${s.record.losses} this season` : `${s.record.wins}–${s.record.losses}`);
  const [a, b] = v.sides;
  return `${m.label[0]}${m.label.slice(1).toLowerCase()}: ${a.name} (${rec(a)}) vs ${b.name} (${rec(b)}).${v.pot ? ` ${v.pot} CC pot.` : ""}`;
}

function noTrainer(ctx, cx) {
  ctx.globalAlpha = 0.35;
  drawBall(ctx, cx, FLOOR - 90, 44, false);
  ctx.globalAlpha = 1;
}

function drawSideHeader(ctx, eyebrow, name, sub, x, align) {
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(eyebrow, x, M + 28);
  const t = fitFont(ctx, name, 420, 44, 26, 800);
  ctx.font = font(t.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(t.text, x, M + 76);
  ctx.font = font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(sub, x, M + 108);
}

function drawBar(ctx, v, m, tints) {
  const y = FIELD.h + 16, h = H - M - y;
  drawCard(ctx, M, y, W - 2 * M, h, { radius: 16 });
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(m.label, W / 2, v.pot ? y + 36 : y + 62);
  if (v.pot) {
    ctx.font = font(30, 900);
    ctx.fillStyle = COLOR.gold;
    ctx.fillText(`${v.pot.toLocaleString("en-US")} CC pot`, W / 2, y + 74);
    ctx.font = font(16, 700);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText("winner takes all", W / 2, y + 96);
  }
  const record = (s, x, align, color) => {
    const r = s.record ?? { wins: 0, losses: 0, streak: 0 };
    ctx.textAlign = align;
    ctx.font = font(16, 800);
    ctx.fillStyle = COLOR.textMuted;
    ctx.fillText(m.rated ? "RANKED RATING · THIS SEASON" : "CASUAL RECORD", x, y + 30);
    ctx.font = font(32, 900);
    ctx.fillStyle = color;
    ctx.fillText(m.rated ? `${r.rating}` : `${r.wins}W – ${r.losses}L`, x, y + 66);
    // Under it: W–L (rated) or the win rate (casual), then a gold streak of 3+
    // (words, not an emoji: the card font has none).
    ctx.font = font(18, 700);
    const played = r.wins + r.losses;
    const main = m.rated ? `${r.wins}W – ${r.losses}L` : played ? `${Math.round((100 * r.wins) / played)}% wins` : "No battles yet";
    const streak = r.streak >= 3 ? `${r.streak}-win streak` : null;
    const sep = streak ? "  ·  " : "";
    const total = ctx.measureText(main + sep + (streak ?? "")).width;
    let sx = align === "left" ? x : x - total;
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR.text;
    ctx.fillText(main + sep, sx, y + 94);
    if (streak) {
      sx += ctx.measureText(main + sep).width;
      ctx.fillStyle = COLOR.gold;
      ctx.fillText(streak, sx, y + 94);
    }
  };
  // Each record in its trainer's tier colour, like their half (white without a backdrop).
  record(v.sides[0], M + 24, "left", tints[0] ?? COLOR.text);
  record(v.sides[1], W - M - 24, "right", tints[1] ?? COLOR.text);
}

/**
 * v: { mode: "open" | "ranked" | "wager", pot (Wager: the CC pot, else
 * null), sides: [Challenger, Defender] from vsSide }. A PNG, or with
 * `animate` a GIF when something moves.
 */
export async function renderBattleVsCard(v, { animate = false, env = process.env } = {}) {
  const fx = cardTrainerFx(env);
  const m = MODES[v.mode] ?? MODES.open;
  const stage = spriteStage({ animate, env });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  drawHalves(ctx, COLOR.red, FIELD);
  const fg = createCanvas(W, H);
  const f = fg.getContext("2d");
  const tints = v.sides.map((s) => (fx ? backdropTint(s.tier) : null));
  // Whether each half has a backdrop (a tint is optional: an art Aura without one still draws).
  const looks = v.sides.map((s) => (fx && hasBackdrop(s.tier) ? s.tier : null));
  drawSideHeader(f, "CHALLENGER", v.sides[0].name, m.team, M + 16, "left");
  drawSideHeader(f, "DEFENDER", v.sides[1].name, m.team, W - M - 16, "right");
  const placed = [];
  for (const [i, s] of v.sides.entries()) {
    const slot = SLOTS[i];
    const t = await placeTrainer(f, stage, { file: s.trainerFile, cx: slot.cx, floor: FLOOR, box: BOX, tint: tints[i], idle: fx, env });
    if (!t) noTrainer(f, slot.cx);
    placed.push(t);
    await drawTeamGrid(f, s.team, ...slot.grid, stage);
  }
  drawVs(f, FIELD);
  drawBar(f, v, m, tints);
  const occupied = looks.some(Boolean) ? occupancy(W, H, fg, placed) : null;
  const backdrops = ["left", "right"].map((side, i) => (looks[i]
    ? halfBackdrop(ctx, { side, tier: v.sides[i].tier, field: FIELD, W, H, floor: FLOOR + 12, occupied })
    : null)).filter(Boolean);
  if (backdrops.length) stage.layer(ctx, (c, frame) => { backdrops.forEach((b) => b.draw(c, frame)); c.drawImage(fg, 0, 0); });
  else ctx.drawImage(fg, 0, 0);
  return stage.output(canvas, { overlay: backdrops.length ? fg : null });
}
