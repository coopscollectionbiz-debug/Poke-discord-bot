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
import gifenc from "gifenc"; // CommonJS without named-export hints, so Node needs the default import
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { loadTrimmedTrainerSprite, loadBadgeSprite } from "../render/sprites.js";
import { drawSparkle, drawTypeChip } from "../render/primitives.js";
import { typeStyle, COLOR as TOKENS } from "../render/tokens.js";
import { isMegaId, megaSpriteRecord } from "../megas.js";

const { GIFEncoder, quantize, nearestColorIndex } = gifenc;

const FONT = "system-ui, 'DejaVu Sans', 'Noto Sans', Arial, sans-serif";
const SPRITES = new URL("../../public/sprites/pokemon/", import.meta.url);
export const FRAME_WIDTH = 900;
const W = FRAME_WIDTH;
const PAD = 12;
const ROW_H = 178;
const GAP = 18; // between the rows, where the turn badge sits
const TEXT_H = 64;
const H = PAD + ROW_H * 2 + GAP + PAD + TEXT_H + PAD;
const ROW_TOP = [PAD, PAD + ROW_H + GAP];
const SIDE_COLOR = ["#4f8cff", "#ff5a6a"];
const GOLD = "#f5c84c";
const INK = "#0e1120";
const MEGA_TAG = TOKENS.mega; // the shared Mega colour (dashboard --cc-mega)

// GIF timing: 100 ms frames; an attack takes 7 of them, then the scene holds
// with sprites still moving. Discord ignores a long last-frame delay and loops
// a GIF once its regular frames run out, replaying the turn (HP jumps back
// up), so each turn runs turnMs on regular frames: longer than the ~2.5-2.8 s
// a screen recording measured between playback updates. The final frame
// still asks for the GIF maximum (~11 min) for viewers that honor it.
// Start and result images loop.
export const ANIMATION = { delayMs: 100, eventFrames: 7, holdFrames: 10, idleFrames: 20, turnMs: 4000, freezeMs: 655_350 };

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
// half and red below a fifth.
function drawHpBar(ctx, cx, y, frac) {
  const w = 116, h = 8, tag = 22, x = cx - w / 2;
  ctx.fillStyle = INK;
  pill(ctx, x, y, w, h + 6);
  ctx.fill();
  ctx.fillStyle = "#f6b73c";
  pill(ctx, x + 3, y + 3, tag, h);
  ctx.fill();
  ctx.fillStyle = "#3b2a05";
  ctx.font = `800 8px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("HP", x + 3 + tag / 2, y + 3 + h / 2 + 0.5);
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

// A Poké Ball per Team member: red and white while it can battle, gray once fainted.
function drawBall(ctx, cx, cy, alive) {
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

// A trainer standing on a lit platform at the left of their row. Pixel art
// stays crisp at 2× (90% of trimmed trainers fit); wider ones shrink to fit.
function drawPortrait(ctx, s, sprite, color) {
  const box = portraitBox(s);
  const cx = box.x + box.w / 2, floor = box.y + box.h - 12;
  ctx.fillStyle = `${color}14`;
  pill(ctx, box.x, box.y, box.w, box.h, 12);
  ctx.fill();
  ctx.fillStyle = `${color}66`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 46, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!sprite) return;
  const k = Math.min(2, (box.w - 4) / sprite.width, (box.h - 10) / sprite.height);
  const [w, h] = [Math.round(sprite.width * k), Math.round(sprite.height * k)];
  ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(sprite.image, Math.round(cx - w / 2), Math.round(floor + 4 - h), w, h);
  ctx.imageSmoothingEnabled = true;
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

// What one GIF frame shows: everyone's HP, who is mid-attack, and the text.
function frameState(f, { hpBefore, events }) {
  const hp = hpBefore.map((row) => [...row]);
  if (!events.length) return { hp, lunge: null, hidden: null, lines: null };
  const done = Math.min(events.length, Math.floor(f / ANIMATION.eventFrames));
  for (let e = 0; e < done; e++) {
    hp[1 - events[e].side][events[e].targetSlot] = events[e].hpAfter;
    if ("userHpAfter" in events[e]) hp[events[e].side][events[e].slot] = events[e].userHpAfter;
  }
  if (done === events.length) return { hp, lunge: null, hidden: null, lines: events.at(-1) };
  const e = events[done];
  const phase = f % ANIMATION.eventFrames;
  const from = hp[1 - e.side][e.targetSlot];
  // Lunge (frames 0-1), flash on impact (2, 4), HP drains (2-5), effect text (4+),
  // then the attacker's own HP moves for drain, recoil or a crash (4-6).
  if (phase >= 2) hp[1 - e.side][e.targetSlot] = from + (e.hpAfter - from) * Math.min(1, (phase - 2) / 3);
  if ("userHpAfter" in e && phase >= 4) {
    const own = hp[e.side][e.slot];
    hp[e.side][e.slot] = own + (e.userHpAfter - own) * Math.min(1, (phase - 4) / 2);
  }
  return {
    hp,
    lunge: phase < 2 ? { side: e.side, slot: e.slot, dy: (e.side === 0 ? 1 : -1) * (phase === 0 ? 4 : 8) } : null,
    hidden: e.damage > 0 && (phase === 2 || phase === 4) ? { side: 1 - e.side, slot: e.targetSlot } : null,
    lines: phase >= 4 ? e : { ...e, partial: true },
  };
}

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
 * - theme (/challenge only): { type (the opponent's, or null), badgeFile (in
 *   the center pill, or null), award: { screen, badgeFile, title } on the
 *   text screen at index `screen`, or null }
 */
export async function renderBattleFrame({ sides, hpBefore, events = [], badge = "VS", screens = [["", ""]], surgeSide = null, winnerSide = null, sprites = new Map(), trainers = [null, null], theme = null }) {
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
  const faints = (s, i) => events.some((e) =>
    (e.fainted && 1 - e.side === s && e.targetSlot === i) || (e.userFainted && e.side === s && e.slot === i));
  const gray = await Promise.all(sides.map((side, s) => Promise.all(side.members.map((m, i) =>
    (hpBefore[s][i] > 0 && faints(s, i) ? load(s, i, "grayscale") : null)))));
  // The fighting pair: each side's first Pokémon still standing (as in the sim).
  const active = winnerSide === null ? hpBefore.map((row) => row.findIndex((f) => f > 0)) : [-1, -1];
  const cached = (key, load) => {
    if (!sprites.has(key)) sprites.set(key, load());
    return sprites.get(key);
  };
  const portraits = await Promise.all(trainers.map((f) => (f ? cached(`trainer/${f}`, () => loadTrimmedTrainerSprite(f)) : null)));
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
  const total = events.length
    ? Math.max(events.length * ANIMATION.eventFrames + ANIMATION.holdFrames, ANIMATION.turnMs / ANIMATION.delayMs)
    : ANIMATION.idleFrames * screens.length;
  const draw = (f) => {
    const state = frameState(f, { hpBefore, events });
    const ms = f * ANIMATION.delayMs;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#141a2c");
    bg.addColorStop(1, "#1d1530");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (let s = 0; s < 2; s++) {
      const top = ROW_TOP[s];
      const members = sides[s].members;
      ctx.fillStyle = s === 1 && typeFill ? `${typeFill}1f` : `${SIDE_COLOR[s]}14`;
      pill(ctx, PAD, top, W - 2 * PAD, ROW_H, 16);
      ctx.fill();
      ctx.lineWidth = winnerSide === s || surgeSide === s ? 3 : 2;
      ctx.strokeStyle = winnerSide === s ? GOLD : surgeSide === s ? "#ff9800" : `${SIDE_COLOR[s]}66`;
      ctx.stroke();

      drawPortrait(ctx, s, portraits[s], s === 1 && typeFill ? typeFill : SIDE_COLOR[s]);

      // Nameplate: trainer name, the opponent's type (challenges), and a ball per Team member.
      const nameX = LAYOUT.left + 8;
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      const name = fitText(ctx, sides[s].name, 320);
      ctx.fillText(name, nameX, top + 20);
      let ballsX = nameX + ctx.measureText(name).width + 16;
      if (s === 1 && typeFill) {
        ballsX += drawTypeChip(ctx, theme.type, ballsX - 6, top + 11, { h: 18, size: 11 }) + 8;
        ctx.textBaseline = "middle"; // drawTypeChip leaves textAlign at left, the baseline at middle
      }
      members.forEach((_, i) => drawBall(ctx, ballsX + i * 16, top + 20, state.hp[s][i] > 0));
      if (winnerSide === s) drawTag(ctx, "WINNER", W - PAD - 14, top + 11, GOLD);
      else if (surgeSide === s) drawTag(ctx, "UNDERDOG SURGE", W - PAD - 14, top + 11, "#ff9800");

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const cx = tileCenter(members.length, i);
        const floor = top + 126;
        const frac = state.hp[s][i];
        const fighting = active[s] === i;

        // Platform, lit for the fighting pair.
        if (fighting) {
          const glow = ctx.createRadialGradient(cx, floor - 30, 10, cx, floor - 30, 70);
          glow.addColorStop(0, `${SIDE_COLOR[s]}55`);
          glow.addColorStop(1, `${SIDE_COLOR[s]}00`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, floor - 30, 70, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = fighting ? `${SIDE_COLOR[s]}88` : "#ffffff12";
        ctx.beginPath();
        ctx.ellipse(cx, floor, 52, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        if (fighting) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#ffffffcc";
          ctx.stroke();
        }

        // Sprite: animated while standing, grayscale once fainted.
        const hidden = state.hidden?.side === s && state.hidden.slot === i;
        const sprite = frac <= 0 ? (gray[s][i] ?? live[s][i]) : live[s][i];
        if (sprite && !hidden) {
          const img = play(sprite, frac <= 0 ? 0 : ms);
          const dy = state.lunge?.side === s && state.lunge.slot === i ? state.lunge.dy : 0;
          ctx.globalAlpha = frac <= 0 ? 0.45 : fighting || active[s] === -1 ? 1 : 0.7;
          ctx.drawImage(img, Math.round(cx - sprite.width / 2), Math.round(floor + 6 - sprite.height + dy));
          ctx.globalAlpha = 1;
        }

        // Name, Level, and HP.
        ctx.textBaseline = "alphabetic";
        ctx.font = `700 13px ${FONT}`;
        // A Mega shows its base name (+ X/Y/Z) and a MEGA tag, so it fits the
        // tile: 80 px leaves room for the Level in a 124 px tile.
        const megaSuffix = m.megaForm ? (m.name?.match(/ ([XYZ])$/)?.[1] ?? "") : "";
        const label = fitText(ctx, m.megaForm ? `${m.baseName ?? m.name}${megaSuffix ? ` ${megaSuffix}` : ""}` : (m.name ?? `#${m.speciesId}`), 80);
        const level = `Lv${m.level}`;
        const nameW = ctx.measureText(label).width;
        ctx.font = `600 12px ${FONT}`;
        const levelW = ctx.measureText(level).width;
        const startX = cx - (nameW + 6 + levelW) / 2;
        ctx.textAlign = "left";
        ctx.font = `700 13px ${FONT}`;
        ctx.fillStyle = frac <= 0 ? "#7d8396" : "#ffffff";
        ctx.fillText(label, startX, top + 152);
        ctx.font = `600 12px ${FONT}`;
        ctx.fillStyle = m.levelUp ? "#5ee08a" : frac <= 0 ? "#7d8396" : "#c9cfe0";
        ctx.fillText(level, startX + nameW + 6, top + 152);
        drawHpBar(ctx, cx, top + 158, frac);
        if (m.megaForm) drawTag(ctx, "MEGA", Math.round(cx + LAYOUT.tileW / 2 - 8), top + 30, frac <= 0 ? "#7d8396" : MEGA_TAG);
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

    const screen = Math.floor(f / ANIMATION.idleFrames);
    if (theme?.award && !events.length && screen === theme.award.screen) drawAward(ctx, theme.award, awardIcon, f % ANIMATION.idleFrames);

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
    const [line1, line2] = state.lines?.partial ? [turnText(state.lines, sides)[0], ""]
      : state.lines ? wrapLines(...turnText(state.lines, sides), (t) => ctx.measureText(t).width <= lineW)
      : screens[Math.floor(f / ANIMATION.idleFrames)];
    ctx.fillText(fitText(ctx, line1 ?? "", lineW), PAD + 18, ty + 27);
    ctx.fillText(fitText(ctx, line2 ?? "", lineW), PAD + 18, ty + 51);

  };
  const pause = () => new Promise((resolve) => setImmediate(resolve)); // lets other commands run

  // One palette for the whole image, from its first and last frames, so a
  // color that only shows up later (a red HP bar, a fainted gray) is in it,
  // plus the award screen's first frame when there is one (its gold and the
  // dimmed field). canvas.data() is the canvas's own pixels, not a copy;
  // frames are opaque, so its premultiplied alpha changes nothing.
  const sampled = [total - 1, ...(theme?.award && !events.length ? [theme.award.screen * ANIMATION.idleFrames] : []), 0];
  const sample = new Uint8Array(W * H * 4 * sampled.length);
  sampled.forEach((f, i) => {
    draw(f);
    sample.set(canvas.data(), W * H * 4 * (sampled.length - 1 - i));
  });
  const palette = quantize(sample, 255);
  const clear = palette.length; // the transparent index: "same as the last frame"
  await pause();

  // Each frame is mapped to the palette and written as soon as it's drawn, into
  // reused buffers. Pixels that match the previous frame are written as `clear`,
  // so later frames store only what changed and the file stays small.
  const nearest = new Int16Array(1 << 16).fill(-1); // RGB565 color -> palette index
  let cur = new Uint8Array(W * H), prev = new Uint8Array(W * H);
  const changes = new Uint8Array(W * H);
  const gif = GIFEncoder();
  for (let f = 0; f < total; f++) {
    if (f > 0) draw(f);
    const px = canvas.data();
    for (let i = 0, p = 0; i < cur.length; i++, p += 4) {
      const key = ((px[p] >> 3) << 11) | ((px[p + 1] >> 2) << 5) | (px[p + 2] >> 3);
      let idx = nearest[key];
      if (idx < 0) idx = nearest[key] = nearestColorIndex(palette, [px[p], px[p + 1], px[p + 2]]);
      cur[i] = idx;
    }
    const delay = events.length && f === total - 1 ? ANIMATION.freezeMs : ANIMATION.delayMs;
    if (f === 0) gif.writeFrame(cur, W, H, { palette: [...palette, [0, 0, 0]], delay });
    else {
      for (let i = 0; i < cur.length; i++) changes[i] = cur[i] === prev[i] ? clear : cur[i];
      // dispose 1 keeps each frame under the next; gifenc's default for a
      // transparent frame clears it, which would blank the unchanged pixels.
      gif.writeFrame(changes, W, H, { delay, transparent: true, transparentIndex: clear, dispose: 1 });
    }
    [cur, prev] = [prev, cur];
    await pause();
  }
  gif.finish();
  const bytes = gif.bytesView();
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
