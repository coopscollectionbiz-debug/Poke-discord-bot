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
//
// Animated (renderEncounterCard(v, { animate: true })): both trainers idle,
// the Team plays, and a player with an Epic+ trainer gets their tier
// backdrop across their half (utils/render/vsField.js). The Trainer, run by
// the computer, never gets one.
// ==========================================================

import { auraLook } from "../../services/auras.js";
import { createCanvas } from "@napi-rs/canvas";
import { COLOR } from "./tokens.js";
import { rr, font, fitText, fitFont, drawBackground, drawCard, drawBall, drawAlertBubble } from "./primitives.js";
import { loadTrimmedTrainerSprite } from "./sprites.js";
import { drawHalves, drawVs, drawTeamGrid } from "./challengeCard.js";
import { spriteStage } from "./stage.js";
import { trainerTier, cardTrainerFx } from "./trainerTier.js";
import { backdropTint } from "./trainerBackdrop.js";
import { placeTrainer, occupancy, halfBackdrop } from "./vsField.js";

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
      tier: auraLook(user), // the player's equipped Aura (Auto: the displayed trainer's tier)
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

function noTrainer(ctx, cx, floor) {
  ctx.globalAlpha = 0.35;
  drawBall(ctx, cx, floor - 90, 44, false);
  ctx.globalAlpha = 1;
}

async function drawEncounterTrainer(ctx, v, slots, stage, fx) {
  const { cx, floor } = slots.trainer;
  const placed = await placeTrainer(ctx, stage, { file: v.trainer.trainerFile, cx, floor, box: BOX, idle: fx });
  if (!placed) {
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
  return placed;
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

/** The card as a PNG, or with `animate` a GIF when something moves (see the header). */
export async function renderEncounterCard(v, { animate = false, env = process.env } = {}) {
  const fx = cardTrainerFx(env);
  const stage = spriteStage({ animate, env });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  drawHalves(ctx, COLOR.red, FIELD);
  // Content on its own layer, so a backdrop can sit between it and the halves.
  const fg = createCanvas(W, H);
  const f = fg.getContext("2d");
  const slots = await encounterSlots(v);
  const tint = fx ? backdropTint(v.player.tier) : null;
  const player = await placeTrainer(f, stage, { file: v.player.trainerFile, cx: slots.player.cx, floor: slots.player.floor, box: BOX, tint, idle: fx });
  if (!player) noTrainer(f, slots.player.cx, slots.player.floor);
  await drawTeamGrid(f, v.player.team, 348, 96, stage);
  const trainer = await drawEncounterTrainer(f, v, slots, stage, fx);
  drawVs(f, FIELD);
  drawTextBox(f, v, slots.textBox);
  drawStakes(f, v, slots.stakes);
  const backdrop = tint
    ? halfBackdrop(ctx, { side: "left", tier: v.player.tier, field: FIELD, W, H, floor: FLOOR + 12, occupied: occupancy(W, H, fg, [player, trainer]) })
    : null;
  if (backdrop) stage.layer(ctx, (c, frame) => { backdrop.draw(c, frame); c.drawImage(fg, 0, 0); });
  else ctx.drawImage(fg, 0, 0);
  return stage.output(canvas, { overlay: backdrop ? fg : null });
}
