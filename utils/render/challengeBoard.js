// ==========================================================
// utils/render/challengeBoard.js
// The /challenge board (no opponent) as an image: a row of the 8 Gyms, each
// with its leader, type and Badge (lit once earned), then the League on a
// darker stage: the Elite Four, Blue and Red, as black silhouettes behind a
// lock until they open and with a gold CLEARED tag once beaten. Private to
// the player; read-only.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR, typeStyle } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBackground, drawTypeChip, typeChipsWidth, drawTag, drawSparkle } from "./primitives.js";
import { loadTrimmedTrainerSprite, loadBadgeSprite } from "./sprites.js";
import { CHALLENGES, displaySprite } from "../challenge/roster.js";
import { isUnlocked } from "../challenge/runChallenge.js";
import { utcDay } from "../battle/rewards.js";
import { CHALLENGE } from "../battle/tuning.js";
import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";

export const BOARD_SIZE = Object.freeze({ w: 1200, h: 780 });
const { w: W, h: H } = BOARD_SIZE;
const M = 24;
const GYM_Y = 120, GYM_H = 300, GYM_GAP = 10, GYM_W = (W - 2 * M - 7 * GYM_GAP) / 8;
const STAGE_Y = GYM_Y + GYM_H + 16, STAGE_H = H - M - STAGE_Y;
// Scene lighting for the League's three stages (not UI states: the gold
// CLEARED tag and ring keep gold's meaning).
const STAGE = {
  elite4: { x: M, w: 560, accent: "#7a4cff", eyebrow: "ELITE FOUR", title: "The Elite Four" },
  blue: { x: M + 568, w: 288, accent: "#ff9f43", eyebrow: "CHAMPION", title: "Blue" },
  red: { x: M + 864, w: 288, accent: "#e5383b", eyebrow: "POKÉMON TRAINER", title: "Red" },
};
const list = (items) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);
const badgeFile = (b) => b.image.split("/").pop();

/** Everything the board shows. `user` may be null (no record yet). */
export function boardView(user, { displayName, now = new Date() }) {
  const u = user ?? {};
  const won = u.challenge?.won ?? {};
  const earned = earnedBadgeKeys(u);
  const state = (key) => (key in won ? "cleared" : isUnlocked(u, key) ? "open" : "locked");
  const used = u.challenge?.day === utcDay(now) ? u.challenge.attempts : 0;
  return {
    name: displayName,
    badges: earned.length,
    gyms: GYM_BADGES.map((b) => ({
      key: b.key, leader: b.leader, type: b.type, badgeFile: badgeFile(b), badgeName: b.badge,
      trainerFile: displaySprite(CHALLENGES[b.key].opponents[0]), earned: earned.includes(b.key),
    })),
    elite4: {
      state: state("elite4"),
      missing: GYM_BADGES.length - earned.length,
      members: CHALLENGES.elite4.opponents.map((o) => ({ name: o.name, type: o.type, trainerFile: displaySprite(o) })),
    },
    blue: { state: state("blue"), trainerFile: displaySprite(CHALLENGES.blue.opponents[0]) },
    red: { state: state("red"), trainerFile: displaySprite(CHALLENGES.red.opponents[0]) },
    left: CHALLENGE.perDay - used,
    perDay: CHALLENGE.perDay,
  };
}

/** The image's description (Discord's alt text). */
export function boardAltText(v) {
  const earned = v.gyms.filter((g) => g.earned).map((g) => g.leader);
  const e4 = v.elite4.state === "locked" ? `locked, ${v.elite4.missing} more Badge${v.elite4.missing === 1 ? "" : "s"}` : v.elite4.state;
  const blue = v.blue.state === "locked" ? "locked, clear the Elite Four first" : v.blue.state;
  return [
    `${v.name}'s Kanto challenges: ${v.badges} of ${v.gyms.length} Badges${earned.length ? ` (${list(earned)})` : ""}.`,
    `Elite Four: ${e4}.`,
    `Blue: ${blue}.`,
    `Red: ${v.red.state}.`,
    `${v.left} of ${v.perDay} challenges left today.`,
  ].join(" ");
}

/** Where the board draws each piece (also used by tests). */
export function boardSlots() {
  const gyms = GYM_BADGES.map((_, i) => {
    const x = M + i * (GYM_W + GYM_GAP);
    return {
      x, y: GYM_Y, w: GYM_W, h: GYM_H,
      badge: { x: Math.round(x + GYM_W / 2 - 24), y: GYM_Y + 12, size: 48 }, // the 16 px Badge art at 3×
      sprite: { x: Math.round(x + 6), y: GYM_Y + 66, w: Math.round(GYM_W - 12), h: 162 }, // trainers are up to 80 px tall: 2× fits
    };
  });
  const stage = (key) => ({ x: STAGE[key].x, y: STAGE_Y, w: STAGE[key].w, h: STAGE_H });
  const e4 = stage("elite4");
  const cell = (e4.w - 40) / 4;
  return {
    gyms,
    elite4: { ...e4, members: [0, 1, 2, 3].map((i) => ({ x: Math.round(e4.x + 20 + i * cell + 6), y: STAGE_Y + 120, w: Math.round(cell - 12), h: 150 })) },
    // 196 px tall: Blue and Red (57 and 55 px trimmed) stand at 3×.
    blue: { ...stage("blue"), sprite: { x: STAGE.blue.x + 40, y: STAGE_Y + 104, w: STAGE.blue.w - 80, h: 196 } },
    red: { ...stage("red"), sprite: { x: STAGE.red.x + 40, y: STAGE_Y + 104, w: STAGE.red.w - 80, h: 196 } },
  };
}

// A trainer standing in `box`, bottom-anchored. Pixel art stays at a whole
// scale (up to `max`) when 2× or more fits; a wide one (Lance's cape)
// shrinks just enough to fit rather than dropping to 1×, so neighbors stay
// the same size. A locked opponent is a black silhouette.
function drawTrainer(ctx, sprite, box, { max = 2, silhouette = false } = {}) {
  if (!sprite) return;
  let k = Math.min(max, box.w / sprite.width, box.h / sprite.height);
  if (k >= 2) k = Math.floor(k);
  const [w, h] = [Math.round(sprite.width * k), Math.round(sprite.height * k)];
  let img = sprite.image;
  if (silhouette) {
    const c = createCanvas(sprite.width, sprite.height);
    const cx = c.getContext("2d");
    cx.drawImage(sprite.image, 0, 0);
    cx.globalCompositeOperation = "source-in";
    cx.fillStyle = "#04060d";
    cx.fillRect(0, 0, sprite.width, sprite.height);
    img = c;
  }
  ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(img, Math.round(box.x + box.w / 2 - w / 2), Math.round(box.y + box.h - h), w, h);
  ctx.imageSmoothingEnabled = true;
}

function drawFloor(ctx, cx, floor, rx, color) {
  ctx.fillStyle = `${color}55`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, rx, rx * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPadlock(ctx, cx, cy, s, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.12, s * 0.3, Math.PI, 0);
  ctx.stroke();
  rr(ctx, cx - s * 0.45, cy - s * 0.12, s * 0.9, s * 0.7, s * 0.12);
  ctx.fill();
}

function drawHeader(ctx, v) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("KANTO CHALLENGES", M + 4, M + 22);
  const t = fitFont(ctx, v.name, 560, 44, 26, 800);
  ctx.font = font(t.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(t.text, M + 4, M + 70);
  const nameW = ctx.measureText(t.text).width;
  ctx.font = font(26, 800);
  ctx.fillStyle = v.badges ? COLOR.gold : COLOR.textMuted;
  ctx.fillText(`${v.badges}/${v.gyms.length} Badges`, M + 4 + nameW + 20, M + 70);

  ctx.textAlign = "right";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("CHALLENGES LEFT TODAY", W - M - 4, M + 22);
  ctx.font = font(44, 800);
  ctx.fillStyle = v.left ? COLOR.text : COLOR.red;
  ctx.fillText(`${v.left}/${v.perDay}`, W - M - 4, M + 70);
  ctx.textAlign = "left";
}

async function drawGyms(ctx, v, slots) {
  for (const [i, g] of v.gyms.entries()) {
    const s = slots[i];
    const accent = typeStyle(g.type).fill;
    ctx.fillStyle = COLOR.surface;
    rr(ctx, s.x, s.y, s.w, s.h, 14);
    ctx.fill();
    // A soft light in the Gym's type behind the leader.
    const glow = ctx.createRadialGradient(s.x + s.w / 2, s.y + 170, 6, s.x + s.w / 2, s.y + 170, 90);
    glow.addColorStop(0, `${accent}40`);
    glow.addColorStop(1, `${accent}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(s.x, s.y + 64, s.w, 180);
    ctx.lineWidth = g.earned ? 3 : 1.5;
    ctx.strokeStyle = g.earned ? COLOR.gold : COLOR.line;
    rr(ctx, s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, 14);
    ctx.stroke();

    const badge = await loadBadgeSprite(g.badgeFile);
    if (badge) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = g.earned ? 1 : 0.22;
      ctx.drawImage(badge.image, s.badge.x, s.badge.y, s.badge.size, s.badge.size);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      if (g.earned) drawSparkle(ctx, s.badge.x + s.badge.size + 4, s.badge.y + 6, 7);
    }
    drawFloor(ctx, s.x + s.w / 2, s.sprite.y + s.sprite.h, 46, accent);
    drawTrainer(ctx, await loadTrimmedTrainerSprite(g.trainerFile), s.sprite);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const n = fitFont(ctx, g.leader, s.w - 12, 22, 18, 800);
    ctx.font = font(n.size, 800);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(n.text, s.x + s.w / 2, s.y + 256);
    const cw = typeChipsWidth(ctx, [g.type], { h: 26, size: 16 });
    drawTypeChip(ctx, g.type, s.x + s.w / 2 - cw / 2, s.y + 264, { h: 26, size: 16 });
    ctx.textBaseline = "alphabetic";
  }
}

// One League stage: dark, lit from below in its color, more so once open.
function drawStage(ctx, key, state, box) {
  const { accent } = STAGE[key];
  const locked = state === "locked";
  ctx.save();
  rr(ctx, box.x, box.y, box.w, box.h, 18);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  bg.addColorStop(0, "#07090f");
  bg.addColorStop(1, locked ? "#10131f" : `${accent}40`);
  ctx.fillStyle = bg;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const spot = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h, 10, box.x + box.w / 2, box.y + box.h, box.h * 1.05);
  spot.addColorStop(0, `${accent}${locked ? "30" : "70"}`);
  spot.addColorStop(1, `${accent}00`);
  ctx.fillStyle = spot;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  // Light beams fanning up from the floor.
  ctx.globalAlpha = locked ? 0.05 : 0.1;
  ctx.fillStyle = accent;
  for (const dx of [-0.32, 0, 0.32]) {
    ctx.beginPath();
    ctx.moveTo(box.x + box.w * (0.5 + dx * 0.25), box.y + box.h);
    ctx.lineTo(box.x + box.w * (0.5 + dx) - 26, box.y);
    ctx.lineTo(box.x + box.w * (0.5 + dx) + 26, box.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (key === "red") {
    // Snow on the mountain, the same flakes every time.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.25 + rand() * 0.45;
      ctx.beginPath();
      ctx.arc(box.x + rand() * box.w, box.y + rand() * box.h, 0.8 + rand() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.lineWidth = state === "cleared" ? 3 : 2;
  ctx.strokeStyle = state === "cleared" ? COLOR.gold : `${accent}${locked ? "44" : "99"}`;
  rr(ctx, box.x + 1, box.y + 1, box.w - 2, box.h - 2, 18);
  ctx.stroke();

  const { eyebrow, title } = STAGE[key];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = locked ? COLOR.textFaint : COLOR.textMuted;
  ctx.fillText(eyebrow, box.x + 20, box.y + 34);
  ctx.font = font(34, 900);
  ctx.fillStyle = locked ? COLOR.textMuted : COLOR.text;
  ctx.fillText(title, box.x + 20, box.y + 74);
  if (state === "cleared") {
    // On the title's line, which is short on every stage (the eyebrow isn't).
    ctx.font = font(18, 800);
    const w = ctx.measureText("CLEARED").width + 30;
    drawTag(ctx, "CLEARED", box.x + box.w - 20 - w, box.y + 50, { h: 30, size: 18 });
    drawSparkle(ctx, box.x + box.w - 22, box.y + 94, 8);
  } else if (locked) {
    drawPadlock(ctx, box.x + box.w - 36, box.y + 36, 30, COLOR.textMuted);
  }
}

function caption(ctx, text, box, y) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(22, 600);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(fitText(ctx, text, box.w - 40), box.x + 20, y);
}

async function drawLeague(ctx, v, slots) {
  const e4 = slots.elite4;
  drawStage(ctx, "elite4", v.elite4.state, e4);
  const locked = v.elite4.state === "locked";
  if (locked) caption(ctx, `Earn all 8 Badges · ${v.elite4.missing} to go`, e4, e4.y + 106);
  else if (v.elite4.state === "open") caption(ctx, "Four battles in a row", e4, e4.y + 106);
  for (const [i, m] of v.elite4.members.entries()) {
    const box = e4.members[i];
    if (!locked) drawFloor(ctx, box.x + box.w / 2, box.y + box.h, 50, typeStyle(m.type).fill);
    drawTrainer(ctx, await loadTrimmedTrainerSprite(m.trainerFile), box, { silhouette: locked });
    ctx.textAlign = "center";
    ctx.font = font(20, 800);
    ctx.fillStyle = locked ? COLOR.textFaint : COLOR.text;
    ctx.fillText(locked ? "???" : m.name, box.x + box.w / 2, box.y + box.h + 28);
  }

  for (const key of ["blue", "red"]) {
    const box = slots[key];
    const { state, trainerFile } = v[key];
    drawStage(ctx, key, state, box);
    if (key === "blue" && state === "locked") caption(ctx, "Clear the Elite Four", box, box.y + 106);
    if (state !== "locked") drawFloor(ctx, box.sprite.x + box.sprite.w / 2, box.sprite.y + box.sprite.h, 70, STAGE[key].accent);
    drawTrainer(ctx, await loadTrimmedTrainerSprite(trainerFile), box.sprite, { max: 3, silhouette: state === "locked" });
  }
}

export async function renderBoard(v) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  const slots = boardSlots();
  drawHeader(ctx, v);
  await drawGyms(ctx, v, slots.gyms);
  await drawLeague(ctx, v, slots);
  return canvas.toBuffer("image/png");
}
