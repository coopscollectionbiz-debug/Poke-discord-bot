// ==========================================================
// utils/render/encounterCard.js
// The Trainer encounter card (docs/superpowers/specs/2026-11-10-trainer-
// encounters-design.md, Discord UX): the challenge VS card's split field,
// toned down, with the player's trainer and the Team that will fight on the
// blue half and the Trainer on the red half under the games' "!", their
// party as Poké Balls. Below, a games-style text box says who challenged
// whom and the Trainer's line, beside the Prize money at stake. It never
// shows a Level, though the Prize money (class base × the last Pokémon's
// Level) hints at a strong Trainer to players who know the bases. Read-only.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { COLOR } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBackground, drawCard, drawBall, drawPlatform, drawAlertBubble } from "./primitives.js";
import { loadTrimmedTrainerSprite, drawSprite } from "./sprites.js";
import { drawHalves, drawVs, drawTrainer, drawTeamGrid } from "./challengeCard.js";

export const ENCOUNTER_CARD_SIZE = Object.freeze({ w: 1200, h: 600 });
const { w: W, h: H } = ENCOUNTER_CARD_SIZE;
const M = 24;
const FIELD = { h: 430, top: 640, bottom: 570 }; // the challenge card's seam, on a shorter field
const FLOOR = 404;
const BOX = 320; // trainer sprites are 80 px, drawn at 4×
const BUBBLE = 64; // the 16 px "!" at 4×
const n = (x) => x.toLocaleString("en-US");

/** Everything the card shows. `team` is the card's Team ({ speciesId, variant }), the one that will fight. */
export function encounterCardView({ trainer, team, user, displayName }) {
  return {
    player: {
      name: displayName,
      trainerFile: user?.displayedTrainer ?? null,
      team: team.map((m) => ({ id: m.speciesId, variant: m.variant, shiny: m.variant === "shiny" })),
    },
    trainer: { title: trainer.title, name: trainer.name, trainerFile: trainer.spriteFile, partySize: trainer.party.length },
    heading: `${trainer.title} ${trainer.name} challenged ${displayName}!`,
    line: trainer.lines.intro,
    prize: trainer.prize,
  };
}

/** The image's description (Discord's alt text). */
export const encounterAltText = (v) => `${v.heading} "${v.line}" Win or lose: ${n(v.prize)} CC.`;

const trainerBox = (cx) => ({ x: cx - BOX / 2, y: FLOOR + 6 - BOX, w: BOX, h: BOX });

/**
 * Where the card draws its pieces (also used by tests). Async: the "!" sits
 * just above the Trainer sprite's opaque top, so the sprite is loaded.
 */
export async function encounterSlots(v) {
  const trainer = { cx: 930, floor: FLOOR, box: trainerBox(930) };
  const sprite = await loadTrimmedTrainerSprite(v.trainer.trainerFile);
  const s = sprite ? Math.min(4, BOX / sprite.width, BOX / sprite.height) : 4;
  trainer.top = FLOOR + 6 - (sprite ? Math.round(sprite.height * s) : 260);
  return {
    player: { cx: 190, floor: FLOOR, box: trainerBox(190) },
    trainer,
    bubble: { x: Math.round(trainer.cx - BUBBLE / 2), y: Math.max(0, trainer.top - BUBBLE - 6), size: BUBBLE },
    textBox: { x: M, y: FIELD.h + 16, w: 856, h: H - M - FIELD.h - 16 },
    stakes: { x: M + 856 + 16, y: FIELD.h + 16, w: W - 2 * M - 856 - 16, h: H - M - FIELD.h - 16 },
  };
}

async function drawEncounterTrainer(ctx, v, slots) {
  const { cx, floor } = slots.trainer;
  drawPlatform(ctx, cx, floor, 118, 20, COLOR.red);
  const sprite = await loadTrimmedTrainerSprite(v.trainer.trainerFile);
  if (sprite) drawSprite(ctx, sprite, cx, floor + 6, BOX, BOX, { scale: 4 });
  else {
    ctx.globalAlpha = 0.35;
    drawBall(ctx, cx, floor - 90, 44, false);
    ctx.globalAlpha = 1;
  }
  ctx.imageSmoothingEnabled = false;
  drawAlertBubble(ctx, slots.bubble.x, slots.bubble.y, slots.bubble.size / 16);
  ctx.imageSmoothingEnabled = true;
  // The party: a Poké Ball per Pokémon, top right, as on the battle nameplates.
  const r = 11, step = 30;
  for (let i = 0; i < v.trainer.partySize; i++) drawBall(ctx, W - M - 16 - r - i * step, M + 24, r, true);
}

function drawTextBox(ctx, v, { x, y, w, h }) {
  ctx.fillStyle = COLOR.textbox;
  rr(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLOR.textboxBorder;
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const heading = fitFont(ctx, v.heading, w - 48, 26, 22, 800);
  ctx.font = font(heading.size, 800);
  ctx.fillStyle = COLOR.ink;
  ctx.fillText(heading.text, x + 24, y + 50);
  ctx.font = font(22, 600);
  ctx.fillStyle = COLOR.textboxBorder;
  ctx.fillText(fitText(ctx, `"${v.line}"`, w - 48), x + 24, y + 92);
}

function drawStakes(ctx, v, { x, y, w, h }) {
  drawCard(ctx, x, y, w, h, { radius: 16 });
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(18, 800);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText("WIN OR LOSE", x + w / 2, y + 44);
  const amount = fitFont(ctx, `${n(v.prize)} CC`, w - 32, 36, 26, 900);
  ctx.font = font(amount.size, 900);
  ctx.fillStyle = COLOR.gold;
  ctx.fillText(amount.text, x + w / 2, y + 94);
}

export async function renderEncounterCard(v) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  drawHalves(ctx, COLOR.red, FIELD);
  const slots = await encounterSlots(v);
  await drawTrainer(ctx, v.player.trainerFile, slots.player.cx, slots.player.floor, COLOR.blue);
  await drawTeamGrid(ctx, v.player.team, 348, 96);
  await drawEncounterTrainer(ctx, v, slots);
  drawVs(ctx, FIELD);
  drawTextBox(ctx, v, slots.textBox);
  drawStakes(ctx, v, slots.stakes);
  return canvas.toBuffer("image/png");
}
