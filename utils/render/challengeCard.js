// ==========================================================
// utils/render/challengeCard.js
// The /challenge VS card: the challenger (trainer, Badges, battle Team) on
// a blue half, the opponent on a half tinted with their type, the Badge on
// the line for a Gym, and the prize. Sent as the private preview and again
// as the public intro, so it never shows the exact CC loss (10× it is the
// balance); the private preview says that amount in text. Read-only.
//
// Animated (renderChallengeCard(v, { animate: true })): both trainers idle,
// the Team plays its sprites, and a player with an Epic+ trainer gets their
// tier backdrop across their whole half (utils/render/vsField.js). The Gym
// Leader keeps the type-tinted half: computer-run opponents never get one.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, typeStyle } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBackground, drawCard, drawTypeChip, typeChipsWidth, drawBall, drawSoftPlatform, drawShinyMark, drawSparkle } from "./primitives.js";
import { loadStaticSprite, loadTrainerSprite, loadTrimmedTrainerSprite, loadBadgeSprite, loadPlaceholder, drawSprite } from "./sprites.js";
import { buildTeamView } from "./teamView.js";
import { CHALLENGES, displaySprite } from "../challenge/roster.js";
import { prizeText } from "../battle/playback.js";
import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";
import { spriteStage } from "./stage.js";
import { trainerTier, cardTrainerFx } from "./trainerTier.js";
import { backdropTint } from "./trainerBackdrop.js";
import { placeTrainer, occupancy, halfBackdrop } from "./vsField.js";

export const CHALLENGE_CARD_SIZE = Object.freeze({ w: 1200, h: 640 });
const { w: W, h: H } = CHALLENGE_CARD_SIZE;
const M = 24;
const MAIN_H = 492; // the split field; the prize bar sits under it
const SPLIT = { top: 640, bottom: 560 }; // the diagonal's x at y = 0 and y = MAIN_H
const FLOOR = 466;
const TRAINER_BOX = 320; // trainer sprites are 80 px, drawn at 4×
const EYEBROW = { gym: "GYM LEADER", elite4: "ELITE FOUR", champion: "CHAMPION", red: "POKÉMON TRAINER" };
const badgeFile = (b) => b.image.split("/").pop();

/**
 * Everything the card shows. `preview` is previewChallenge(user, key); its
 * loss is deliberately left out.
 */
export function challengeCardView(key, preview, user, { displayName }) {
  const challenge = CHALLENGES[key];
  const earned = earnedBadgeKeys(user);
  const gymType = challenge.kind === "gym" ? challenge.opponents[0].type : null;
  return {
    key,
    kind: challenge.kind,
    eyebrow: EYEBROW[challenge.kind],
    title: challenge.kind === "elite4" ? "The Elite Four" : challenge.opponents[0].name,
    type: gymType,
    // Opponents without a type (Blue, Red) keep the battle's opponent red.
    accent: gymType ? typeStyle(gymType).fill : COLOR.red,
    opponents: challenge.opponents.map((o) => ({ name: o.name, title: o.title, type: o.type, trainerFile: displaySprite(o) })),
    partySize: challenge.opponents[0].team.length,
    badge: challenge.badge ? { file: badgeFile(challenge.badge), name: challenge.badge.badge, earned: earned.includes(key) } : null,
    win: preview.prize ? prizeText(key, preview.prize) : null,
    rematch: !preview.firstWin,
    player: {
      name: displayName,
      trainerFile: user?.displayedTrainer ?? null,
      // The displayed trainer is always one the player owns.
      tier: trainerTier(user?.displayedTrainer),
      team: buildTeamView(user, { displayName }).slots.map((s) => ({ id: s.id, variant: s.variant, shiny: s.shiny })),
      badges: GYM_BADGES.map((b) => ({ file: badgeFile(b), earned: earned.includes(b.key) })),
    },
  };
}

const list = (items) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** The image's description (Discord's alt text): what the card shows, in words. */
export function cardAltText(v) {
  const who = v.kind === "elite4"
    ? `the Elite Four: ${list(v.opponents.map((o) => o.name))}`
    : `${v.opponents[0].title} ${v.opponents[0].name}${v.type ? ` (${v.type})` : ""}`;
  const stake = v.rematch ? "Rematch." : v.badge ? `The ${v.badge.name} is on the line.` : null;
  return [`${v.player.name} vs ${who}.`, stake, `Win: ${v.win ?? "EXP only"}.`, "Lose: 10% of CC."].filter(Boolean).join(" ");
}

/** Where the card draws its trainers and the Badge medallion (also used by tests). */
export function cardSlots(v) {
  const trainerBox = (cx) => ({ x: cx - TRAINER_BOX / 2, y: FLOOR + 6 - TRAINER_BOX, w: TRAINER_BOX, h: TRAINER_BOX });
  const player = { cx: 190, floor: FLOOR, box: trainerBox(190) };
  // The challenger's Badges: 16 px art at 2×.
  const badges = GYM_BADGES.map((_, i) => ({ x: M + 16 + i * 38, y: M + 94, size: 32 }));
  if (v.kind === "elite4") {
    const cellW = 124, x0 = W - M - 16 - 4 * cellW;
    const opponents = v.opponents.map((_, i) => {
      const x = x0 + i * cellW;
      return { cx: x + cellW / 2, floor: 400, box: { x, y: 190, w: cellW, h: 216 } };
    });
    return { player, opponents, medallion: null, badges };
  }
  const cx = v.badge ? 1000 : 920;
  return {
    player,
    opponents: [{ cx, floor: FLOOR, box: trainerBox(cx) }],
    medallion: v.badge ? { cx: 760, cy: 322, r: 66, size: 96 } : null, // 96 px = the 16 px Badge art at 6×
    badges,
  };
}

// The split field: its height and the diagonal seam's x at its top and bottom.
// The encounter card (utils/render/encounterCard.js) draws a shorter one.
const FIELD = { h: MAIN_H, top: SPLIT.top, bottom: SPLIT.bottom };
const splitX = (y, field) => field.top + ((field.bottom - field.top) * y) / field.h;

export function drawHalves(ctx, accent, field = FIELD) {
  const half = (points, color, fromX, toX, alphas) => {
    const g = ctx.createLinearGradient(fromX, 0, toX, 0);
    g.addColorStop(0, `${color}${alphas[0]}`);
    g.addColorStop(1, `${color}${alphas[1]}`);
    ctx.fillStyle = g;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  half([[0, 0], [field.top, 0], [field.bottom, field.h], [0, field.h]], COLOR.blue, 0, field.top, ["38", "0c"]);
  half([[field.top, 0], [W, 0], [W, field.h], [field.bottom, field.h]], accent, field.bottom, W, ["10", "40"]);
  // The seam: an ink band with a light edge on each side.
  ctx.lineCap = "butt";
  for (const [width, color] of [[18, "#ffffff22"], [12, COLOR.ink]]) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(field.top, 0);
    ctx.lineTo(field.bottom, field.h);
    ctx.stroke();
  }
}

export function drawVs(ctx, field = FIELD) {
  const cx = splitX(field.h / 2, field) - 6, cy = field.h / 2 + 34;
  ctx.save();
  ctx.font = font(104, 900);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = 14;
  ctx.strokeStyle = COLOR.ink;
  ctx.strokeText("VS", cx, cy);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText("VS", cx, cy);
  ctx.restore();
}

function eyebrowAndTitle(ctx, eyebrow, title, x, align, maxW) {
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(eyebrow, x, M + 28);
  const t = fitFont(ctx, title, maxW, 44, 26, 800);
  ctx.font = font(t.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(t.text, x, M + 76);
}

/** A still trainer on a soft platform (`tint`: an owned Epic+ trainer's tier colour, or null). */
export async function drawTrainer(ctx, file, cx, floor, tint = null, { scale = 4, box = TRAINER_BOX, trimmed = false } = {}) {
  drawSoftPlatform(ctx, cx, floor, scale === 4 ? 118 : 52, scale === 4 ? 20 : 10, tint, { u: scale === 4 ? 4 : 2 });
  const t = trimmed ? await loadTrimmedTrainerSprite(file) : await loadTrainerSprite(file);
  if (t) {
    drawSprite(ctx, t, cx, floor + 6, typeof box === "number" ? box : box.w, typeof box === "number" ? box : box.h, { scale });
  } else {
    ctx.globalAlpha = 0.35;
    drawBall(ctx, cx, floor - (scale === 4 ? 90 : 50), scale === 4 ? 44 : 24, false);
    ctx.globalAlpha = 1;
  }
}

/** The empty-slot ball where a trainer would stand (no sprite file, or it failed to load). */
function noTrainer(ctx, cx, floor, scale = 4) {
  ctx.globalAlpha = 0.35;
  drawBall(ctx, cx, floor - (scale === 4 ? 90 : 50), scale === 4 ? 44 : 24, false);
  ctx.globalAlpha = 1;
}

async function drawPlayer(ctx, v, { player: slot, badges }, stage, fx) {
  eyebrowAndTitle(ctx, "CHALLENGER", v.player.name, M + 16, "left", 520);
  ctx.imageSmoothingEnabled = false;
  for (const [i, b] of v.player.badges.entries()) {
    const sprite = await loadBadgeSprite(b.file);
    if (!sprite) continue;
    ctx.globalAlpha = b.earned ? 1 : 0.2;
    ctx.drawImage(sprite.image, badges[i].x, badges[i].y, badges[i].size, badges[i].size);
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  const tint = fx ? backdropTint(v.player.tier) : null;
  const placed = await placeTrainer(ctx, stage, { file: v.player.trainerFile, cx: slot.cx, floor: slot.floor, box: TRAINER_BOX, tint, idle: fx });
  if (!placed) noTrainer(ctx, slot.cx, slot.floor);
  await drawTeamGrid(ctx, v.player.team, 348, 176, stage); // clear of the VS on the seam
  return placed;
}

// The battle Team ({ id, variant, shiny } per slot), 2 × 3, at 1×, under a
// TEAM label; (gx, gy) is the first cell's top left. With a `stage`, the
// sprites go through it (animated on an animated card).
export async function drawTeamGrid(ctx, team, gx, gy, stage = null) {
  const cell = 74, gap = 8;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("TEAM", gx, gy - 8);
  const ph = await loadPlaceholder();
  for (let i = 0; i < 6; i++) {
    const x = gx + (i % 2) * (cell + gap), y = gy + Math.floor(i / 2) * (cell + gap);
    const s = team[i];
    ctx.fillStyle = s ? "#1a2135cc" : "#ffffff08";
    rr(ctx, x, y, cell, cell, 12);
    ctx.fill();
    ctx.lineWidth = s?.shiny || (s && i === 0) ? 2.5 : 1.5;
    ctx.strokeStyle = !s ? "#2a3350" : s.shiny ? COLOR.gold : i === 0 ? COLOR.blue : "#323c5c";
    ctx.stroke();
    if (!s) continue;
    const sprite = (await loadStaticSprite(s.id, s.variant)) ?? ph;
    if (stage) stage.place(ctx, sprite, x + cell / 2, y + cell - 6, cell - 8, cell - 10, { scale: 1 }, { id: s.id, variant: s.variant });
    else drawSprite(ctx, sprite, x + cell / 2, y + cell - 6, cell - 8, cell - 10, { scale: 1 });
    if (s.shiny) drawShinyMark(ctx, x + cell - 13, y + 13, 7);
  }
}

// The opponent's name line: type chip, then a Poké Ball per party member.
function drawPartyLine(ctx, v, right, y) {
  const r = 9, step = 24;
  let x = right - r;
  for (let i = 0; i < v.partySize; i++, x -= step) drawBall(ctx, x, y + 15, r, true);
  if (v.type) {
    const w = typeChipsWidth(ctx, [v.type], { h: 30, size: 17 });
    drawTypeChip(ctx, v.type, x + r - 6 - w, y, { h: 30, size: 17 });
  }
}

async function drawMedallion(ctx, v, m) {
  const glow = ctx.createRadialGradient(m.cx, m.cy, 10, m.cx, m.cy, m.r * 1.8);
  glow.addColorStop(0, `${COLOR.gold}40`);
  glow.addColorStop(1, `${COLOR.gold}00`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(m.cx, m.cy, m.r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOR.surfaceSunken;
  ctx.beginPath();
  ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLOR.gold;
  ctx.stroke();
  const sprite = await loadBadgeSprite(v.badge.file);
  if (sprite) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.image, m.cx - m.size / 2, m.cy - m.size / 2, m.size, m.size);
    ctx.imageSmoothingEnabled = true;
  }
  drawSparkle(ctx, m.cx + m.r * 0.78, m.cy - m.r * 0.72, 9);
  drawSparkle(ctx, m.cx - m.r * 0.86, m.cy + m.r * 0.5, 6);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(v.rematch ? "REMATCH" : "ON THE LINE", m.cx, m.cy - m.r - 14);
  ctx.font = font(22, 800);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText(fitText(ctx, v.badge.name.toUpperCase(), 230), m.cx, m.cy + m.r + 32);
}

async function drawOpponents(ctx, v, slots, stage, fx) {
  const placed = [];
  const right = W - M - 16;
  eyebrowAndTitle(ctx, v.eyebrow, v.title, right, "right", 480);
  if (v.kind !== "elite4") {
    drawPartyLine(ctx, v, right, M + 92);
    const o = slots.opponents[0];
    const t = await placeTrainer(ctx, stage, { file: v.opponents[0].trainerFile, cx: o.cx, floor: o.floor, box: TRAINER_BOX, idle: fx });
    if (!t) noTrainer(ctx, o.cx, o.floor);
    placed.push(t);
    if (slots.medallion) await drawMedallion(ctx, v, slots.medallion);
    return placed;
  }
  // A rule the player can't see anywhere else before Fight!: 22 px, the
  // design system's floor for text a player must read, on two lines to stay
  // clear of the seam.
  ctx.textAlign = "right";
  ctx.font = font(22, 600);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("Four battles in a row.", right, M + 112);
  ctx.fillText("Revive one Pokémon between them.", right, M + 140);
  for (const [i, o] of v.opponents.entries()) {
    const s = slots.opponents[i];
    const t = await placeTrainer(ctx, stage, { file: o.trainerFile, cx: s.cx, floor: s.floor, scale: 2, box: { w: s.box.w - 4, h: 190 }, idle: fx });
    if (!t) noTrainer(ctx, s.cx, s.floor, 2);
    placed.push(t);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic"; // drawTypeChip leaves it at middle
    ctx.font = font(22, 800);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(fitText(ctx, o.name, s.box.w - 6), s.cx, s.floor + 40);
    const w = typeChipsWidth(ctx, [o.type], { h: 30, size: 17 });
    drawTypeChip(ctx, o.type, s.cx - w / 2, s.floor + 52, { h: 30, size: 17 });
  }
  return placed;
}

// The prize on one line at up to 26 px, or (the Elite Four's four sprites)
// split after a comma onto two lines at 22 px, the smallest readable size.
export function prizeLines(ctx, text, maxW) {
  for (let size = 26; size >= 22; size--) {
    ctx.font = font(size, 800);
    if (ctx.measureText(text).width <= maxW) return { size, lines: [text] };
  }
  ctx.font = font(22, 800);
  const parts = text.split(", ");
  for (let i = parts.length - 1; i > 0; i--) {
    const first = `${parts.slice(0, i).join(", ")},`;
    if (ctx.measureText(first).width <= maxW) return { size: 22, lines: [first, fitText(ctx, parts.slice(i).join(", "), maxW)] };
  }
  return { size: 22, lines: [fitText(ctx, text, maxW)] };
}

function drawPrizeBar(ctx, v) {
  const y = MAIN_H + 16, h = H - M - y, split = 900;
  drawCard(ctx, M, y, W - 2 * M, h, { radius: 16 });
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(split, y + 16);
  ctx.lineTo(split, y + h - 16);
  ctx.stroke();
  const block = (label, color, text, x, maxW) => {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(18, 800);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y + 32);
    const { size, lines } = prizeLines(ctx, text, maxW);
    ctx.font = font(size, 800);
    ctx.fillStyle = COLOR.text;
    if (lines.length === 1) ctx.fillText(lines[0], x, y + 72);
    else lines.forEach((line, i) => ctx.fillText(line, x, y + 62 + i * 28));
  };
  block(v.rematch ? "WIN · REMATCH" : "WIN", COLOR.hp.high, v.win ?? "EXP only", M + 24, split - M - 48);
  block("LOSE", COLOR.red, "10% of CC", split + 24, W - M - split - 48);
}

/**
 * The card as a PNG, or with `animate` a GIF (idle trainers, playing Team,
 * the player's tier backdrop); a GIF only when something moves.
 */
export async function renderChallengeCard(v, { animate = false, env = process.env } = {}) {
  const fx = cardTrainerFx(env);
  const stage = spriteStage({ animate, env });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  drawHalves(ctx, v.accent);
  // Content goes on its own layer, so a backdrop can sit between it and the halves.
  const fg = createCanvas(W, H);
  const f = fg.getContext("2d");
  const slots = cardSlots(v);
  const player = await drawPlayer(f, v, slots, stage, fx);
  const opponents = await drawOpponents(f, v, slots, stage, fx);
  drawVs(f);
  drawPrizeBar(f, v);
  const backdrop = fx && backdropTint(v.player.tier)
    ? halfBackdrop(ctx, {
      side: "left", tier: v.player.tier, field: FIELD, W, H, floor: FLOOR + 12,
      occupied: occupancy(W, H, fg, [player, ...opponents]),
    })
    : null;
  if (backdrop) stage.layer(ctx, (c, frame) => { backdrop.draw(c, frame); c.drawImage(fg, 0, 0); });
  else ctx.drawImage(fg, 0, 0);
  return stage.output(canvas, { overlay: backdrop ? fg : null });
}
