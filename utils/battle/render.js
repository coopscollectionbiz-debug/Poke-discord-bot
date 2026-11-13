// ==========================================================
// utils/battle/render.js
// One animated GIF per playback update: each player's trainer at the left
// of their row, both Teams beside them, the fighting pair spotlit,
// game-style HP bars, and a text box narrating the turn. Sprites play their
// own GIF animation. /challenge adds a theme: the opponent's type, the
// Badge, and the award screen.
//
// Memory: frames are encoded as they're drawn and sprite frames are decoded
// as an image reaches them, so a 6v6 battle adds about 60 MB rather than 270
// (measured on macOS). The production machine has about 220 MB free.
// ==========================================================

import { createCanvas, ImageData } from "@napi-rs/canvas";
import { GifReader } from "omggif";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { loadTrimmedTrainerSprite, loadTrimmedTrainerPoses, loadBadgeSprite } from "../render/sprites.js";
import { drawSparkle, drawTypeChip, drawSoftPlatform, drawStamp } from "../render/primitives.js";
import { regionBackdrop, backdropTint, hasBackdrop, drawTierSky } from "../render/trainerBackdrop.js";
import { trainerLight } from "../render/auraArt.js";
import { cardTrainerFx } from "../render/trainerTier.js";
import { typeStyle, COLOR as TOKENS } from "../render/tokens.js";
import { isMegaId, megaSpriteRecord } from "../megas.js";
import { encodeFrames } from "../render/gif.js";
import { unionBox, pokemonLoopFit, loopPlan, fitLoop, spriteTime, STEP_MS, MAX_GIF_BYTES } from "../render/spriteLoops.js";
import { ANIMATION, hitsTimeline, STAT_LABELS } from "./timeline.js";
import { drawEffect, tinted, tintAt, jitterAt, STATUS_COLORS, CHIP_COLORS } from "./fx.js";

const FONT = "system-ui, 'DejaVu Sans', 'Noto Sans', Arial, sans-serif";
const SPRITES = new URL("../../public/sprites/pokemon/", import.meta.url);
export const FRAME_WIDTH = 900;
const W = FRAME_WIDTH;
const PAD = 12;
const ROW_H = 178;
const GAP = 18; // between the rows, where the turn badge sits
const TEXT_H = 64;
const H = PAD + ROW_H * 2 + GAP + PAD + TEXT_H + PAD;
export const ROW_TOP = [PAD, PAD + ROW_H + GAP];
const GOLD = "#f5c84c";
const INK = "#0e1120";
const MEGA_TAG = TOKENS.mega; // the shared Mega colour (dashboard --cc-mega)

// GIF timing (ANIMATION) lives with the replay's timeline, which paces by it.
export { ANIMATION };

export function pickFrameTurns(totalTurns, frames) {
  const turns = Array.from({ length: frames }, (_, i) => Math.max(1, Math.round((totalTurns * (i + 1)) / frames)));
  return [...new Set(turns)];
}

// Each row's trainer stands in a portrait at its left, so the tiles are 124
// px (144 before portraits) and the frame stays 900 wide: GIF memory scales
// with its area. 124 still holds the 116 px HP bar, and 97% of battle
// sprites are 104 px wide or less.
const PORTRAIT_W = 116;
export const portraitBox = (s) => ({ x: PAD + 6, y: ROW_TOP[s] + 4, w: PORTRAIT_W, h: ROW_H - 8 });
export const LAYOUT = { left: PAD + 6 + PORTRAIT_W + 4, right: W - PAD, tileW: 124, pillY: ROW_TOP[1] - GAP / 2 - 17 };
// The award screen's medallion, centered on the field. 96 px is the 16 px Badge art at 6×.
export const AWARD = { cx: W / 2, cy: (ROW_TOP[0] + ROW_TOP[1] + ROW_H) / 2, r: 66, size: 96 };

// Every row is centered on the same line beside the portraits, so a short
// Team sits under the middle of a full one.
export const tileCenter = (count, i) => LAYOUT.left + (LAYOUT.right - LAYOUT.left - count * LAYOUT.tileW) / 2 + LAYOUT.tileW * (i + 0.5);

// The game-style text box for one hit.
export function turnText(event, sides) {
  const attacker = sides[event.side].members[event.slot].name;
  const target = sides[1 - event.side].members[event.targetSlot].name;
  // Showdown's wording, in the order the games show it; "Hit 3 times!" is Gen 5's.
  const notes = event.missed ? [`${attacker}'s attack missed!`]
    : event.eff === 0 ? [`It doesn't affect ${target}...`]
    : [
      event.crit && "A critical hit!",
      event.eff > 1 && "It's super effective!",
      event.eff < 1 && "It's not very effective...",
      event.hits && `Hit ${event.hits} ${event.hits === 1 ? "time" : "times"}!`,
      event.drain && `${target} had its energy drained!`,
      event.recoil && `${attacker} was damaged by the recoil!`,
    ];
  notes.push(
    event.crash && `${attacker} kept going and crashed!`,
    event.fainted && `${target} fainted!`,
    event.userFainted && `${attacker} fainted!`,
  );
  // Mega battles (effects engine): entry, ability, weather and stat messages.
  // Absent from ordinary battles, so their text is unchanged.
  const extra = [...(event.preNotes ?? []), ...notes.filter(Boolean), ...(event.notes ?? []), ...(event.endNotes ?? [])];
  const dedup = extra.filter((t, i) => t && extra.indexOf(t) === i);
  return [`${attacker} used ${event.move}!`, dedup.join(" ")];
}

// The text box's two lines. When the second line is too long (a recoil
// knockout can be), its first sentences move up beside the move name until
// the rest fits, as the games' text boxes wrap.
export function wrapLines(line1, line2, fits) {
  const sentences = line2.split(/(?<=!|\.\.\.) /); // "Mr. Mime" isn't a sentence end
  let top = line1;
  while (!fits(sentences.join(" ")) && sentences.length > 1 && fits(`${top} ${sentences[0]}`)) top += ` ${sentences.shift()}`;
  return [top, sentences.join(" ")];
}

// A sprite GIF, read but not decoded: spritePlayer decodes its frames as an
// image plays (12 sprites decoded up front took about 60 MB at peak).
export async function loadSprite(folder, id) {
  try {
    const gif = new GifReader(await readFile(fileURLToPath(new URL(`${folder}/${id}.gif`, SPRITES))));
    const starts = [];
    let duration = 0;
    for (let i = 0; i < gif.numFrames(); i++) {
      starts.push(duration);
      duration += (gif.frameInfo(i).delay || 10) * 10;
    }
    return { gif, width: gif.width, height: gif.height, starts, duration };
  } catch {
    return null; // missing or unreadable sprite: the tile renders without it
  }
}

/**
 * The animated sprite for a species number or a Mega form id, in `folder`
 * ("normal" | "shiny" | "grayscale"). A Mega reads
 * public/sprites/pokemon/mega/<folder>/<form>.gif, and only when the Mega
 * manifest lists it: a missing Mega sprite is null (the tile renders without
 * a sprite), never the base form's art.
 */
export function loadAnimatedSprite(id, folder) {
  if (!isMegaId(id)) return loadSprite(folder, id);
  return megaSpriteRecord(id)?.[folder]?.file ? loadSprite(`mega/${folder}`, id) : Promise.resolve(null);
}

// Plays one sprite through one image: returns a canvas showing the frame at
// `ms`, composited the way a browser plays it. Handles GIF disposal 0-2; a
// test checks no sprite uses 3 (restore), which would need a saved frame.
export function spritePlayer(sprite) {
  const { gif, starts, width, height } = sprite;
  const img = new ImageData(width, height);
  const canvas = createCanvas(width, height);
  let index = -1, drawn = -1;
  return (ms) => {
    const t = ms % sprite.duration;
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= t) k++;
    if (k < index) { img.data.fill(0); index = -1; } // looped or went back: start over
    while (index < k) {
      const f = index >= 0 ? gif.frameInfo(index) : null;
      if (f?.disposal === 2) {
        for (let y = f.y; y < f.y + f.height; y++) img.data.fill(0, (y * width + f.x) * 4, (y * width + f.x + f.width) * 4);
      }
      gif.decodeAndBlitFrameRGBA(++index, img.data);
    }
    if (drawn !== k) {
      canvas.getContext("2d").putImageData(img, 0, 0);
      drawn = k;
    }
    return canvas;
  };
}

function pill(ctx, x, y, w, h, r = h / 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// Game-style HP bar: an "HP" tag and a rounded bar that turns yellow below
// half and red below a fifth. A status condition (Battle FX) takes the HP
// tag's place, in its color: BRN, PSN, TOX, PAR, SLP, FRZ. Drawn once per
// HP value and tag and copied (drawStamp).
function drawHpBar(ctx, cx, y, frac, status = "") {
  if (!drawStamp(ctx, status ? `hp:${frac}:${status}` : `hp:${frac}`, cx, y, 61, 3, 122, 20, (c, x, yy) => paintHpBar(c, x, yy, frac, status))) return paintHpBar(ctx, cx, y, frac, status);
  ctx.font = `800 8px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = frac <= 0 ? "#3a4256" : frac > 0.5 ? "#9af5b4" : frac > 0.2 ? "#fde48b" : "#f9a3a3";
}

// Dark text on a light tag (paralysis, sleep, freeze), white on a dark one.
const tagInk = (color) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? INK : "#ffffff";
};

function paintHpBar(ctx, cx, y, frac, status = "") {
  const w = 116, h = 8, tag = 22, x = cx - w / 2;
  ctx.fillStyle = INK;
  pill(ctx, x, y, w, h + 6);
  ctx.fill();
  ctx.fillStyle = status ? STATUS_COLORS[status] : "#f6b73c";
  pill(ctx, x + 3, y + 3, tag, h);
  ctx.fill();
  ctx.fillStyle = status ? tagInk(STATUS_COLORS[status]) : "#3b2a05";
  ctx.font = status ? `800 7px ${FONT}` : `800 8px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(status ? status.toUpperCase() : "HP", x + 3 + tag / 2, y + 3 + h / 2 + 0.5);
  const tx = x + tag + 6, tw = w - tag - 9;
  ctx.fillStyle = "#3a4256";
  pill(ctx, tx, y + 3, tw, h);
  ctx.fill();
  if (frac <= 0) return;
  const [fill, shine] = frac > 0.5 ? ["#3fd46c", "#9af5b4"] : frac > 0.2 ? ["#f5c431", "#fde48b"] : ["#ef4b4b", "#f9a3a3"];
  const fw = Math.max(h, tw * frac);
  ctx.fillStyle = fill;
  pill(ctx, tx, y + 3, fw, h);
  ctx.fill();
  ctx.fillStyle = shine;
  pill(ctx, tx + 3, y + 4, Math.max(0, fw - 6), 2, 1);
  ctx.fill();
}

// A Poké Ball per Team member: red and white while it can battle, gray once
// fainted. Drawn once per state and copied (see drawStamp).
function drawBall(ctx, cx, cy, alive) {
  if (!drawStamp(ctx, `ball:${alive}`, cx, cy, 9, 9, 18, 18, (c, x, y) => paintBall(c, x, y, alive))) return paintBall(ctx, cx, cy, alive);
  // The state paintBall leaves behind, for anything drawn after it.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.fillStyle = alive ? "#f4f4f4" : "#555b6e";
}

function paintBall(ctx, cx, cy, alive) {
  const r = 6;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.fillStyle = alive ? "#f4f4f4" : "#555b6e";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  if (alive) {
    ctx.fillStyle = "#e5483d";
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = alive ? "#f4f4f4" : "#555b6e";
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// Stat chips (Battle FX): the fighting Pokémon's stat changes at its tile's
// top-left, red for a raise and blue for a drop ("ATK+2"), in stat order, at
// most two lines. On a Mega slot they stop short of the MEGA tag at the top-right.
const CHIP_ORDER = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
function drawChips(ctx, cx, top, chips, mega) {
  ctx.font = `800 9px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const x0 = cx - LAYOUT.tileW / 2 + 6, limit = mega ? cx - 6 : cx + LAYOUT.tileW / 2 - 6;
  let x = x0, line = 0;
  for (const stat of CHIP_ORDER) {
    const n = chips[stat];
    if (!n) continue;
    const text = `${STAT_LABELS[stat]}${n > 0 ? "+" : ""}${n}`;
    const w = Math.ceil(ctx.measureText(text).width) + 8;
    if (x + w > limit) {
      if (++line > 1 || x0 + w > limit) return; // the text box names whatever doesn't fit
      x = x0;
    }
    const y = top + 30 + line * 15;
    ctx.fillStyle = n > 0 ? CHIP_COLORS.up : CHIP_COLORS.down;
    pill(ctx, x, y, w, 13);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x + 4, y + 7);
    x += w + 2;
  }
}

function drawTag(ctx, text, right, y, color) {
  ctx.font = `800 11px ${FONT}`;
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = color;
  pill(ctx, right - w, y, w, 18);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - w / 2, y + 9.5);
}

// The neutral colour of a row with no tier backdrop (a player below Epic, a
// computer-run opponent other than a Gym Leader, or CARD_TRAINER_FX=0).
const GRAY = "#9aa3b5";

// A trainer at the left of their row, on a soft floor (`tint`: their tier
// colour, else neutral); the pill behind them only on a row without a
// backdrop. Pixel art stays crisp at 2× (90% of trimmed trainers fit); wider
// ones shrink to fit. `sprite` is the still or the current idle pose.
function portraitPlace(s, sprite) {
  const box = portraitBox(s);
  const cx = box.x + box.w / 2, floor = box.y + box.h - 12;
  if (!sprite) return { box, cx, floor };
  const k = Math.min(2, (box.w - 4) / sprite.width, (box.h - 10) / sprite.height);
  const [w, h] = [Math.round(sprite.width * k), Math.round(sprite.height * k)];
  return { box, cx, floor, k, x: Math.round(cx - w / 2), y: Math.round(floor + 4 - h), w, h };
}
function drawPortraitBack(ctx, s, color, tint, lit) {
  const { box, cx, floor } = portraitPlace(s, null);
  if (!lit) {
    ctx.fillStyle = `${color}14`;
    pill(ctx, box.x, box.y, box.w, box.h, 12);
    ctx.fill();
  }
  drawSoftPlatform(ctx, cx, floor, 46, 9, tint, { u: 2 });
}
function drawPortraitSprite(ctx, s, sprite) {
  if (!sprite) return;
  const p = portraitPlace(s, sprite);
  ctx.imageSmoothingEnabled = p.k < 1;
  ctx.drawImage(sprite.image, p.x, p.y, p.w, p.h);
  ctx.imageSmoothingEnabled = true;
}

/**
 * The fighting Pokémon's ring: a fixed pixel ring on the ground whose glow
 * breathes in and out once every PULSE_MS (`phase`: 0–1 through a breath).
 * A fitted start image stretches the breath so a whole number fit its loop. A solid
 * core line plus a fainter band either side that widens as it brightens, in
 * the trainer's tier colour lightened 35% toward white (light gray without
 * a backdrop), so it reads on its own row.
 */
const PULSE_MS = 1000;
function drawRing(ctx, cx, cy, phase, color) {
  const glow = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); // 0 → 1 → 0
  // Its pulse repeats every PULSE_MS, so each brightness is drawn once and
  // copied (keyed by the exact opacities painted; the last ring draws below).
  const alphas = [0.45 + 0.5 * glow, 0.35 * glow, 0.35 * glow, 0.15 * glow * glow].map((a) => (a <= 0.02 ? "-" : a.toFixed(3))).join("|");
  // The ring snaps to an absolute 2-px grid, and its dots are placed from the
  // real centre (shifting the centre first can flip a rounding tie), so the
  // stamp is keyed by the centre and paints at an offset.
  const ox = Math.floor(cx) - 66, oy = Math.floor(cy) - 20;
  if (drawStamp(ctx, `ring:${color}:${alphas}:${cx},${cy}`, cx, cy, 66, 20, 134, 42, (c) => paintRing(c, cx, cy, glow, color, ox, oy))) return;
  paintRing(ctx, cx, cy, glow, color);
}

function paintRing(ctx, cx, cy, glow, color, ox = 0, oy = 0) {
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(color.slice(i, i + 2), 16) * 0.65 + 255 * 0.35));
  const ring = (rx, alpha) => {
    if (alpha <= 0.02) return;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    const ry = rx / 4, n = Math.round(rx * 1.6), seen = new Set();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = Math.round((cx + Math.cos(a) * rx) / 2) * 2, y = Math.round((cy + Math.sin(a) * ry) / 2) * 2;
      if (seen.has(x * 4096 + y)) continue; // no double-plotted (brighter) pixels
      seen.add(x * 4096 + y);
      ctx.fillRect(x - 1 - ox, y - 1 - oy, 2, 2);
    }
  };
  ring(56, 0.45 + 0.5 * glow);
  ring(59, 0.35 * glow);
  ring(53, 0.35 * glow);
  ring(62, 0.15 * glow * glow);
}

// The award screen: the field dims and the Badge (or, with no Badge, a
// title) is presented in gold, with sparkles that twinkle over `k` frames.
function drawAward(ctx, award, icon, k) {
  ctx.fillStyle = "#0e1120c4";
  ctx.fillRect(0, 0, W, ROW_TOP[1] + ROW_H + PAD / 2);
  const { cx, cy, r, size } = AWARD;
  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, r * 2.4);
  glow.addColorStop(0, `${GOLD}55`);
  glow.addColorStop(1, `${GOLD}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
  let spots;
  if (icon) {
    ctx.fillStyle = "#121729";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(icon.image, cx - size / 2, cy - size / 2, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.font = `800 18px ${FONT}`;
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(award.title, cx, cy + r + 30);
    spots = [[0.78, -0.78], [-0.92, -0.35], [0.95, 0.42], [-0.6, 0.85]].map(([x, y]) => [cx + x * (r + 16), cy + y * (r + 16)]);
  } else {
    ctx.font = `900 52px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 10;
    ctx.strokeStyle = INK;
    ctx.strokeText(award.title, cx, cy);
    ctx.fillStyle = GOLD;
    ctx.fillText(award.title, cx, cy);
    const half = ctx.measureText(award.title).width / 2;
    spots = [[-half - 26, -18], [half + 26, 14], [-half * 0.45, -46], [half * 0.55, 44]].map(([x, y]) => [cx + x, cy + y]);
  }
  // Each sparkle grows and shrinks on its own beat (a 1.2 s cycle).
  spots.forEach(([x, y], j) => drawSparkle(ctx, x, y, 4 + 10 * Math.abs(Math.sin(((k + 3 * j) * Math.PI) / 12)), GOLD));
}

// What one GIF frame shows: everyone's HP, who is mid-attack, the text, the
// status tags and stat chips, who is in front, and a beat's effect. The
// timeline (utils/battle/timeline.js) gives each segment's frames and its
// state at its start; past the last one, its end state holds.
function frameState(f, tl) {
  const seg = tl.segments.find((s) => f >= s.start && f < s.start + s.frames);
  if (!seg) {
    const last = tl.segments.at(-1);
    const lines = !last ? null : last.kind === "hit" ? last.event : { text: last.text };
    return { hp: tl.end.hp.map((row) => [...row]), lunge: null, hidden: null, lines, marks: tl.end.marks, active: tl.end.active, fx: null };
  }
  const hp = seg.hp.map((row) => [...row]);
  const phase = f - seg.start;
  if (seg.kind === "beat") {
    // HP moves over the beat's frames 2-5 (fewer when the image's beats are capped); the tag or chip pops in at frame 2.
    const k = Math.min(1, Math.max(0, (phase - 2) / Math.max(1, seg.frames - 5)));
    for (const [s, i, from, to] of seg.hpChanges) hp[s][i] = from + (to - from) * k;
    return { hp, lunge: null, hidden: null, lines: { text: seg.text }, marks: phase >= 2 ? seg.marksAfter : seg.marks, active: seg.active, fx: { seg, phase: phase / seg.frames } };
  }
  if (seg.kind === "line") return { hp, lunge: null, hidden: null, lines: { text: seg.text }, marks: seg.marks, active: seg.active, fx: null };
  const e = seg.event;
  const from = hp[1 - e.side][e.targetSlot];
  // Lunge (frames 0-1), flash on impact (2, 4), HP drains (2-5), effect text (4+),
  // then the attacker's own HP moves for drain, recoil or a crash (4-6). A
  // status move has no hpAfter: the target's HP stays as it was.
  if ("hpAfter" in e && phase >= 2) hp[1 - e.side][e.targetSlot] = from + (e.hpAfter - from) * Math.min(1, (phase - 2) / 3);
  if ("userHpAfter" in e && phase >= 4) {
    const own = hp[e.side][e.slot];
    hp[e.side][e.slot] = own + (e.userHpAfter - own) * Math.min(1, (phase - 4) / 2);
  }
  return {
    hp,
    lunge: phase < 2 ? { side: e.side, slot: e.slot, dy: (e.side === 0 ? 1 : -1) * (phase === 0 ? 4 : 8) } : null,
    hidden: e.damage > 0 && (phase === 2 || phase === 4) ? { side: 1 - e.side, slot: e.targetSlot } : null,
    lines: phase >= 4 ? e : { ...e, partial: true },
    marks: seg.marks,
    active: seg.active,
    fx: null,
  };
}

// A beat's line in the text box: its first sentence on top, as the games wrap.
const beatLines = (text) => {
  const [first, ...rest] = text.split(/(?<=!|\.\.\.) /);
  return [first, rest.join(" ")];
};

/**
 * Renders one playback update as an animated GIF.
 * - hpBefore: each side's HP fractions at the start of the shown turn
 * - events: that turn's hits from the sim log (none for the start and result)
 * - badge: text between the rows ("VS", "TURN 3", "FINAL")
 * - screens: text-box screens ([line1, line2] each) shown in turn when there
 *   are no events, like the games' end-of-battle messages
 * - a member with levelUp: true shows its Level in green (the result image)
 * - sprites: a Map of loaded sprite GIFs to share between one battle's images
 * - trainers: each side's displayed trainer file (null: an empty portrait)
 * - tiers: each side's trainer tier, for players only (a computer-run
 *   opponent is null): an Epic+ tier fills that row with its backdrop and
 *   colours its border, floors and ring; anything else is a neutral row
 * - clockMs: how far into the replay this image starts (playback passes the
 *   time already shown), so sprites, trainers, backdrops and the ring carry
 *   on where the last image left them instead of every update restarting
 *   them. 0 with POKEMON_LOOP_FIT=0.
 * - theme (/challenge only): { type (the opponent's, or null), badgeFile (in
 *   the center pill, or null), award: { screen, badgeFile, title } on the
 *   text screen at index `screen`, or null }
 * - timeline (Battle FX, full sim): the turn's segments from turnTimeline,
 *   in place of `events`; without it, `events` play as today
 * - marks: status tags and stat chips for a start or result image
 *   (marksAt); a turn image takes them from its timeline
 * - chipRoom: keep a tier backdrop's effects off the stat chips' corner.
 *   Playback sets it on every image of a full-sim replay with Battle FX on,
 *   so the backdrop doesn't move between that replay's images
 */
export async function renderBattleFrame({ sides, hpBefore, events = [], badge = "VS", screens = [["", ""]], surgeSide = null, winnerSide = null, sprites = new Map(), trainers = [null, null], tiers = [null, null], theme = null, clockMs = 0, env = process.env, active: inFront = null, timeline = null, marks: still = null, chipRoom = false }) {
  const fx = cardTrainerFx(env);
  const fitted = pokemonLoopFit(env);
  const clock = fitted ? clockMs : 0;
  const load = (s, i, folder) => {
    const m = sides[s].members[i];
    // A Mega battles with its own sprite (loadAnimatedSprite: mega/<variant|grayscale>/<form>.gif).
    const id = m.megaForm ?? m.speciesId;
    const key = m.megaForm ? `mega/${folder}/${id}` : `${folder}/${id}`; // the file's path under sprites/pokemon
    if (!sprites.has(key)) sprites.set(key, loadAnimatedSprite(id, folder));
    return sprites.get(key);
  };
  const live = await Promise.all(sides.map((side, s) => Promise.all(side.members.map((m, i) =>
    load(s, i, hpBefore[s][i] > 0 ? m.variant : "grayscale")))));
  const tl = timeline ?? hitsTimeline(events, hpBefore, inFront);
  const isTurn = tl.segments.length > 0; // a turn whose only moments are beats is still a turn image
  // Who faints in this image: a hit's knockout, or a beat's (a burn KO).
  const faints = (s, i) => tl.segments.some((seg) => (seg.kind === "hit"
    ? (seg.event.fainted && 1 - seg.event.side === s && seg.event.targetSlot === i) || (seg.event.userFainted && seg.event.side === s && seg.event.slot === i)
    : seg.kind === "beat" && seg.hpChanges.some(([ss, ii, , to]) => ss === s && ii === i && to === 0))
    || tl.end.hp[s]?.[i] === 0); // a knockout that's neither (sandstorm, hazards, a self-KO by an item)
  const gray = await Promise.all(sides.map((side, s) => Promise.all(side.members.map((m, i) =>
    (hpBefore[s][i] > 0 && faints(s, i) ? load(s, i, "grayscale") : null)))));
  // The fighting pair: each side's first Pokémon still standing (as in the sim).
  // inFront: who's in front (full sim, after a U-turn or a drag); otherwise the first with HP left.
  const inFrontAtStart = inFront ?? hpBefore.map((row) => row.findIndex((f) => f > 0));
  const activeOf = (state) => (winnerSide === null ? state.active ?? inFrontAtStart : [-1, -1]);
  const cached = (key, load) => {
    if (!sprites.has(key)) sprites.set(key, load());
    return sprites.get(key);
  };
  const portraits = await Promise.all(trainers.map((f) => (f ? cached(`trainer/${f}`, () => loadTrimmedTrainerSprite(f)) : null)));
  // The trainers idle (trimmed to the box all their poses fit, like the still).
  const idles = await Promise.all(trainers.map((f) => (f && fx ? cached(`trainer-idle/${f}`, () => loadTrimmedTrainerPoses(f, { env })) : null)));
  const tints = tiers.map((t) => (fx ? backdropTint(t) : null));
  // Whether each row has a backdrop (a tint is optional: an art Aura without one still draws),
  // and its trainer lighting. Rows are never mirrored: both trainers stand at the left.
  const looks = tiers.map((t) => (fx && hasBackdrop(t) ? t : null));
  const lights = looks.map((t) => (t ? trainerLight(t, { env }) : null));
  const badgeIcon = (f) => (f ? cached(`badge/${f}`, () => loadBadgeSprite(f)) : null);
  const pillIcon = await badgeIcon(theme?.badgeFile);
  const awardIcon = await badgeIcon(theme?.award?.badgeFile);
  // The opponent's color stays red (the design system's opponent color); a
  // type only tints their row and platform.
  const typeFill = theme?.type ? typeStyle(theme.type).fill : null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const players = new Map();
  const play = (sprite, ms) => {
    if (!players.has(sprite)) players.set(sprite, spritePlayer(sprite));
    return players.get(sprite)(ms);
  };
  // What stays the same in every frame is drawn once on `base` and copied
  // in first: the background, each row's panel and portrait, and its trainer
  // name and type chip. Everything else in a row is drawn after its panel, so
  // the order on screen is the same as drawing it all per frame (row 0's
  // sprites, labels and HP bars end above row 1's panel).
  const base = createCanvas(W, H);
  const ballsAt = [0, 0];
  const rowColor = (s) => (s === 1 && typeFill ? typeFill : GRAY);
  {
    const ctx = base.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#141a2c");
    bg.addColorStop(1, "#1d1530");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (let s = 0; s < 2; s++) {
      const top = ROW_TOP[s];
      // The row: the trainer's tier wash (its backdrop animates per frame), or
      // neutral gray; a /challenge Gym Leader's row keeps its type colour.
      if (looks[s]) drawTierSky(ctx, tiers[s], { x: PAD, y: top, w: W - 2 * PAD, h: ROW_H }, { u: 2, clip: (c) => pill(c, PAD, top, W - 2 * PAD, ROW_H, 16) });
      else {
        ctx.fillStyle = s === 1 && typeFill ? `${typeFill}1f` : `${GRAY}1c`;
        pill(ctx, PAD, top, W - 2 * PAD, ROW_H, 16);
        ctx.fill();
      }
      pill(ctx, PAD, top, W - 2 * PAD, ROW_H, 16); // the row's outline is stroked on this path below
      ctx.lineWidth = winnerSide === s || surgeSide === s ? 3 : 2;
      ctx.strokeStyle = winnerSide === s ? GOLD : surgeSide === s ? "#ff9800" : tints[s] ? `${tints[s]}99` : `${rowColor(s)}66`;
      ctx.stroke();

      drawPortraitBack(ctx, s, rowColor(s), tints[s], Boolean(looks[s]));
      if (!(idles[s]?.poses?.length > 1) && !lights[s]) drawPortraitSprite(ctx, s, portraits[s]);

      // Nameplate: trainer name and the opponent's type (challenges); the
      // balls after them change, so they are drawn per frame.
      const nameX = LAYOUT.left + 8;
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      const name = fitText(ctx, sides[s].name, 320);
      ctx.fillText(name, nameX, top + 20);
      let ballsX = nameX + ctx.measureText(name).width + 16;
      if (s === 1 && typeFill) ballsX += drawTypeChip(ctx, theme.type, ballsX - 6, top + 11, { h: 18, size: 11 }) + 8;
      ballsAt[s] = ballsX;
    }
  }

  // Each Epic+ player's backdrop fills their row. Its effects stay clear of
  // everything drawn on the row (the trainer in every pose, each Pokémon's
  // sprite box with room for a lunge, its floor and ring, its name and HP,
  // the nameplate, tags and the turn badge).
  const rowBackdrops = [0, 1].map((s) => {
    if (!looks[s]) return null;
    const top = ROW_TOP[s], rect = { x: PAD, y: top, w: W - 2 * PAD, h: ROW_H };
    const occ = new Uint8Array(rect.w * rect.h);
    const fill = (x, y, w, h) => {
      for (let yy = Math.max(top, Math.floor(y)); yy < Math.min(top + ROW_H, y + h); yy++) {
        occ.fill(1, (yy - top) * rect.w + Math.max(0, Math.floor(x) - PAD), (yy - top) * rect.w + Math.min(rect.w, Math.ceil(x + w) - PAD));
      }
    };
    for (const pose of idles[s]?.poses ?? (portraits[s] ? [portraits[s]] : [])) {
      const p = portraitPlace(s, pose);
      const c = createCanvas(p.w, p.h), cc = c.getContext("2d");
      cc.drawImage(pose.image, 0, 0, p.w, p.h);
      const d = cc.getImageData(0, 0, p.w, p.h).data;
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (d[(y * p.w + x) * 4 + 3] > 8) fill(p.x + x, p.y + y, 1, 1);
    }
    const pf = portraitPlace(s, null);
    fill(pf.cx - 48, pf.floor - 10, 96, 20); // the trainer's floor
    fill(LAYOUT.left, top + 6, 8 + 330 + 16 + 6 * 16 + 90, 28); // name, type chip, balls
    fill(W - PAD - 190, top + 8, 180, 24); // WINNER / UNDERDOG SURGE
    const n = sides[s].members.length;
    sides[s].members.forEach((_, i) => {
      const cx = tileCenter(n, i), floor = top + 126;
      fill(cx - 66, floor - 20, 132, 40); // floor + ring
      fill(cx - 62, top + 136, 124, 40); // name, Level, HP
      fill(cx + LAYOUT.tileW / 2 - 70, top + 28, 64, 22); // MEGA tag
      if (chipRoom) fill(cx - LAYOUT.tileW / 2 + 4, top + 28, LAYOUT.tileW / 2 + 2, 34); // stat chips (Battle FX)
      for (const sp of [live[s][i], gray[s][i]]) if (sp) fill(cx - sp.width / 2, floor + 6 - sp.height - 8, sp.width, sp.height + 16);
    });
    fill(W / 2 - 110, LAYOUT.pillY - 4, 220, 44); // the turn badge
    const pc = portraitPlace(s, null);
    return regionBackdrop({
      tier: tiers[s], rect, u: 2, occupied: (x, y) => occ[(y - top) * rect.w + (x - PAD)] === 1,
      from: [PAD, top + ROW_H], to: [PAD + rect.w * 0.85, top - ROW_H * 0.6],
      floor: pc.floor + 8, frames: 24, dil: 2, variant: "row", // an art Aura's row.png, if it has one
      clip: (c) => pill(c, rect.x, rect.y, rect.w, rect.h, 16),
    });
  });

  // Each frame's time: the old 100 ms steps (turn images, and everything
  // with POKEMON_LOOP_FIT=0), or a start or result image's fitted loop.
  const stepped = steppedTiming({ turnFrames: isTurn ? tl.minFrames : 0, screens, clock });
  let timing = stepped;
  if (fitted && !isTurn) {
    // The sprites that animate: every standing Pokémon's (a fainted one shows its first frame).
    const anims = [...new Set(sides.flatMap((side, s) => side.members.map((_, i) => (hpBefore[s][i] > 0 ? live[s][i] : null))))]
      .filter((a) => a && a.gif.numFrames() > 1);
    const trainerClock = rowBackdrops.some(Boolean) || idles.some((idle) => idle?.poses?.length > 1);
    timing = fittedTiming({ anims, trainerClock, screens: screens.length, clock });
  }

  // Each Pokémon's label and its widths, measured on first use (the same every frame).
  const labels = new Map();
  const labelOf = (s, i) => {
    const key = s * 16 + i;
    let v = labels.get(key);
    if (v) return v;
    const m = sides[s].members[i];
    ctx.font = `700 13px ${FONT}`;
    // A Mega shows its base name (+ X/Y/Z) and a MEGA tag, so it fits the
    // tile: 80 px leaves room for the Level in a 124 px tile.
    const megaSuffix = m.megaForm ? (m.name?.match(/ ([XYZ])$/)?.[1] ?? "") : "";
    const label = fitText(ctx, m.megaForm ? `${m.baseName ?? m.name}${megaSuffix ? ` ${megaSuffix}` : ""}` : (m.name ?? `#${m.speciesId}`), 80);
    const level = `Lv${m.level}`;
    const nameW = ctx.measureText(label).width;
    ctx.font = `600 12px ${FONT}`;
    v = { label, level, nameW, levelW: ctx.measureText(level).width };
    labels.set(key, v);
    return v;
  };

  let T = timing;
  const draw = (f) => {
    const state = frameState(f, tl);
    const active = activeOf(state);
    const marks = isTurn ? state.marks : still;
    const ms = T.ms(f);
    ctx.drawImage(base, 0, 0);
    for (let s = 0; s < 2; s++) {
      // On the replay's clock, like the sprites, so they don't restart each update.
      const f100 = Math.floor(ms / ANIMATION.delayMs);
      rowBackdrops[s]?.draw(ctx, f100);
      const idle = idles[s], light = lights[s];
      const pose = idle?.poses?.length > 1 ? idle.poses[idle.poseAt(f100 % 24, 24)] ?? idle.poses[0] : light ? portraits[s] : null;
      if (pose) drawPortraitSprite(ctx, s, light ? light(pose, f100 % 24) : pose);
    }

    for (let s = 0; s < 2; s++) {
      const top = ROW_TOP[s];
      const members = sides[s].members;
      const ballsX = ballsAt[s];
      members.forEach((_, i) => drawBall(ctx, ballsX + i * 16, top + 20, state.hp[s][i] > 0));
      if (winnerSide === s) drawTag(ctx, "WINNER", W - PAD - 14, top + 11, GOLD);
      else if (surgeSide === s) drawTag(ctx, "UNDERDOG SURGE", W - PAD - 14, top + 11, "#ff9800");

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const cx = tileCenter(members.length, i);
        const floor = top + 126;
        const frac = state.hp[s][i];
        const fighting = active[s] === i;

        // A soft floor in the trainer's tier colour (neutral without one),
        // stronger under the fighting Pokémon, which also stands in the ring.
        drawSoftPlatform(ctx, cx, floor, fighting ? 56 : 52, fighting ? 14 : 12, tints[s], { u: 2, peak: fighting ? 0.9 : 0.4 });
        if (fighting && frac > 0) drawRing(ctx, cx, floor, T.ringPhase(f), tints[s] ?? "#c9cfe0");

        // Sprite: animated while standing, grayscale once fainted. During a
        // beat on this Pokémon it may be tinted (freeze, a burn's flash) or shake (paralysis).
        const hidden = state.hidden?.side === s && state.hidden.slot === i;
        const sprite = frac <= 0 ? (gray[s][i] ?? live[s][i]) : live[s][i];
        const beat = state.fx?.seg.side === s && state.fx.seg.slot === i ? state.fx : null;
        let spriteBox = { cx, top: floor - 60, floor, w: 64, h: 60 };
        if (sprite && !hidden) {
          let img = play(sprite, frac <= 0 ? 0 : T.spriteMs(sprite, f));
          const tint = beat && frac > 0 ? tintAt(beat.seg, beat.phase) : null;
          if (tint?.alpha > 0) img = tinted(img, tint.color, tint.alpha);
          const dy = state.lunge?.side === s && state.lunge.slot === i ? state.lunge.dy : 0;
          const dx = beat ? jitterAt(beat.seg, beat.phase) : 0;
          ctx.globalAlpha = frac <= 0 ? 0.45 : fighting || active[s] === -1 ? 1 : 0.7;
          // Anchored on the box every frame fits in, so a flyer rests above
          // the floor and never sinks through it (POKEMON_LOOP_FIT=0: the GIF's own frame).
          if (fitted) {
            const ub = unionBox(sprite);
            ctx.drawImage(img, Math.round(cx - (ub.x + ub.w / 2)) + dx, Math.round(floor + 4 - (ub.y + ub.h) + dy));
            spriteBox = { cx, top: floor + 4 - ub.h + dy, floor, w: ub.w, h: ub.h };
          } else {
            ctx.drawImage(img, Math.round(cx - sprite.width / 2) + dx, Math.round(floor + 6 - sprite.height + dy));
            spriteBox = { cx, top: floor + 6 - sprite.height + dy, floor, w: sprite.width, h: sprite.height };
          }
          ctx.globalAlpha = 1;
        }
        if (beat) drawEffect(ctx, beat.seg, spriteBox, beat.phase);

        // Name, Level, and HP. The label and its widths are the same every
        // frame, so they're measured once; the text is drawn once per colour
        // and copied (drawStamp).
        const { label, level, nameW, levelW } = labelOf(s, i);
        const startX = cx - (nameW + 6 + levelW) / 2;
        const nameColor = frac <= 0 ? "#7d8396" : "#ffffff";
        const levelColor = m.levelUp ? "#5ee08a" : frac <= 0 ? "#7d8396" : "#c9cfe0";
        const paintLabel = (c, x, y) => {
          c.textBaseline = "alphabetic";
          c.textAlign = "left";
          c.font = `700 13px ${FONT}`;
          c.fillStyle = nameColor;
          c.fillText(label, x, y);
          c.font = `600 12px ${FONT}`;
          c.fillStyle = levelColor;
          c.fillText(level, x + nameW + 6, y);
        };
        if (drawStamp(ctx, `label:${label}|${level}|${nameColor}|${levelColor}`, startX, top + 152, 4, 18, Math.ceil(nameW + 6 + levelW) + 10, 26, paintLabel)) {
          ctx.textBaseline = "alphabetic";
          ctx.textAlign = "left";
          ctx.font = `600 12px ${FONT}`;
          ctx.fillStyle = levelColor;
        } else paintLabel(ctx, startX, top + 152);
        drawHpBar(ctx, cx, top + 158, frac, frac > 0 ? marks?.status?.[s]?.[i] ?? "" : "");
        if (m.megaForm) drawTag(ctx, "MEGA", Math.round(cx + LAYOUT.tileW / 2 - 8), top + 30, frac <= 0 ? "#7d8396" : MEGA_TAG);
        if (fighting && frac > 0 && marks?.chips?.[s]) drawChips(ctx, cx, top, marks.chips[s], Boolean(m.megaForm));
      }
    }

    // Turn badge between the rows; a Gym's Badge sits at its left (2×, 32 px).
    ctx.font = `800 13px ${FONT}`;
    const textW = ctx.measureText(badge).width;
    const [bh, icon] = pillIcon ? [34, 38] : [26, 0];
    const bw = textW + 28 + icon;
    const bx = W / 2 - bw / 2, by = pillIcon ? LAYOUT.pillY : ROW_TOP[1] - GAP / 2 - 13;
    ctx.fillStyle = INK;
    pill(ctx, bx, by, bw, bh);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    if (pillIcon) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pillIcon.image, bx + 8, by + 1, 32, 32);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, bx + icon + (bw - icon) / 2, by + bh / 2 + 0.5);

    const screen = T.screen(f);
    if (theme?.award && !isTurn && screen === theme.award.screen) drawAward(ctx, theme.award, awardIcon, T.awardTick(f));

    // Text box, like the games'.
    const ty = ROW_TOP[1] + ROW_H + PAD;
    ctx.fillStyle = "#f8f8f0";
    pill(ctx, PAD, ty, W - 2 * PAD, TEXT_H, 12);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3a4256";
    ctx.stroke();
    ctx.fillStyle = "#1d2233";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 17px ${FONT}`;
    const lineW = W - 2 * PAD - 36;
    const fits = (t) => ctx.measureText(t).width <= lineW;
    const [line1, line2] = state.lines?.text != null ? wrapLines(...beatLines(state.lines.text), fits)
      : state.lines?.partial ? [turnText(state.lines, sides)[0], ""]
      : state.lines ? wrapLines(...turnText(state.lines, sides), fits)
      : screens[screen];
    ctx.fillText(fitText(ctx, line1 ?? "", lineW), PAD + 18, ty + 27);
    ctx.fillText(fitText(ctx, line2 ?? "", lineW), PAD + 18, ty + 51);

  };
  // One palette for the whole image, from its first and last frames, so a
  // color that only shows up later (a red HP bar, a fainted gray) is in it,
  // plus the award screen's first frame when there is one (its gold and the
  // dimmed field), and the middle of each kind of beat (flame orange, ice blue). Frames are opaque, so the canvas's premultiplied alpha
  // changes nothing. utils/render/gif.js writes only what changed per frame.
  const background = base.getContext("2d").getImageData(0, 0, W, H).data;
  const encode = (timing) => {
    T = timing;
    const award = theme?.award && !isTurn ? [timing.screenStart(theme.award.screen)] : [];
    const beats = isTurn ? tl.sample : [];
    return encodeFrames(canvas, draw, timing.total, { background, sample: [0, ...award, ...beats, timing.total - 1], delay: timing.delay });
  };
  const gif = await encode(timing);
  // Too big (8 MB, as for cards): the old 2 s per screen.
  return timing === stepped || gif.length <= MAX_GIF_BYTES ? gif : encode(stepped);
}

/**
 * The old timing: ANIMATION.delayMs frames; a turn image runs its timeline's
 * minFrames (its hits and beats, then the hold to past the next update) and
 * freezes; a start or result image shows each text screen for idleFrames.
 * Sprites, the ring and backdrops follow `clock`.
 */
function steppedTiming({ turnFrames, screens, clock }) {
  const { delayMs, idleFrames } = ANIMATION;
  const total = turnFrames || idleFrames * screens.length;
  const ms = (f) => clock + f * delayMs;
  return {
    total,
    delay: (f) => (turnFrames && f === total - 1 ? ANIMATION.freezeMs : delayMs),
    ms,
    spriteMs: (sprite, f) => ms(f),
    ringPhase: (f) => (ms(f) % PULSE_MS) / PULSE_MS,
    screen: (f) => Math.floor(f / idleFrames),
    screenStart: (i) => i * idleFrames,
    awardTick: (f) => f % idleFrames,
  };
}

// A text screen's time in a fitted image: about what the old timing gave
// (idleFrames × delayMs, 2 s), never under MIN_SCREEN_MS.
const SCREEN_MS = ANIMATION.idleFrames * ANIMATION.delayMs;
const MIN_SCREEN_MS = 1500;

/**
 * How many times a start or result image plays its sprites' loop L so its
 * `screens` text screens each get about 2 s, split evenly across the image.
 * → { loops, total (frames of STEP_MS) }
 */
export function idleLoops(L, screens) {
  let loops = Math.max(1, Math.round((screens * SCREEN_MS) / L));
  while ((loops * L) / screens < MIN_SCREEN_MS) loops++;
  return { loops, total: Math.max(1, Math.round((loops * L) / STEP_MS)) };
}

/**
 * A start or result image's fitted timing (POKEMON_LOOP_FIT on): one loop
 * length L for its animated sprites (fitLoop; whole 2.4 s multiples when a
 * trainer idles or a tier backdrop plays), played `loops` times at STEP_MS,
 * so the GIF loops with no seam. The text screens split it evenly; the ring
 * breathes a whole number of times over it, starting where `clock` has it.
 */
function fittedTiming({ anims, trainerClock, screens, clock }) {
  const plans = anims.map((a) => loopPlan(a));
  const { L, fit } = fitLoop(plans.map((p) => p.period), { trainerClock });
  const { total } = idleLoops(L, screens);
  const length = total * STEP_MS;
  const breaths = Math.max(1, Math.round(length / PULSE_MS));
  const index = new Map(anims.map((a, i) => [a, i]));
  const ms = (f) => clock + f * STEP_MS;
  const screen = (f) => Math.min(screens - 1, Math.floor((f * screens) / total));
  const screenStart = (i) => Math.ceil((i * total) / screens);
  return {
    total,
    L,
    delay: STEP_MS,
    ms,
    spriteMs: (sprite, f) => (index.has(sprite) ? spriteTime(plans[index.get(sprite)], fit[index.get(sprite)], ms(f)) : ms(f)),
    ringPhase: (f) => ((clock % PULSE_MS) / PULSE_MS + (f * STEP_MS * breaths) / length) % 1,
    screen,
    screenStart,
    awardTick: (f) => Math.floor(((f - screenStart(screen(f))) * STEP_MS) / ANIMATION.delayMs),
  };
}
