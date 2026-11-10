// ==========================================================
// utils/battle/render.js
// One animated GIF per playback update: both Teams in centered rows, the
// fighting pair spotlit, game-style HP bars, and a text box narrating the
// turn. Sprites play their own GIF animation.
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
const TILE_W = 144;
const SIDE_COLOR = ["#4f8cff", "#ff5a6a"];
const GOLD = "#f5c84c";
const INK = "#0e1120";
const MEGA_TAG = "#c084fc"; // the dashboard's Mega colour

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

// Every row is centered on the same line, so a short Team sits under the
// middle of a full one.
export const tileCenter = (count, i) => (W - count * TILE_W) / 2 + TILE_W * (i + 0.5);

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
 */
export async function renderBattleFrame({ sides, hpBefore, events = [], badge = "VS", screens = [["", ""]], surgeSide = null, winnerSide = null, sprites = new Map() }) {
  const load = (s, i, folder) => {
    const m = sides[s].members[i];
    // A Mega battles with its own sprite: public/sprites/pokemon/mega/<variant|grayscale>/<form>.gif
    const [dir, id] = m.megaForm ? [`mega/${folder}`, m.megaForm] : [folder, m.speciesId];
    folder = dir;
    const key = `${folder}/${id}`;
    if (!sprites.has(key)) sprites.set(key, loadSprite(folder, id));
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
      ctx.fillStyle = `${SIDE_COLOR[s]}14`;
      pill(ctx, PAD, top, W - 2 * PAD, ROW_H, 16);
      ctx.fill();
      ctx.lineWidth = winnerSide === s || surgeSide === s ? 3 : 2;
      ctx.strokeStyle = winnerSide === s ? GOLD : surgeSide === s ? "#ff9800" : `${SIDE_COLOR[s]}66`;
      ctx.stroke();

      // Nameplate: trainer name and a ball per Team member.
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      const name = fitText(ctx, sides[s].name, 320);
      ctx.fillText(name, PAD + 16, top + 20);
      const ballsX = PAD + 16 + ctx.measureText(name).width + 16;
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
        // A Mega shows its base name (+ X/Y/Z) and a MEGA tag, so it fits the tile.
        const megaSuffix = m.megaForm ? (m.name?.match(/ ([XYZ])$/)?.[1] ?? "") : "";
        const label = fitText(ctx, m.megaForm ? `${m.baseName ?? m.name}${megaSuffix ? ` ${megaSuffix}` : ""}` : (m.name ?? `#${m.speciesId}`), m.megaForm ? 92 : 80);
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
        if (m.megaForm) drawTag(ctx, "MEGA", Math.round(cx + TILE_W / 2 - 8), top + 30, frac <= 0 ? "#7d8396" : MEGA_TAG);
      }
    }

    // Turn badge between the rows.
    ctx.font = `800 13px ${FONT}`;
    const bw = ctx.measureText(badge).width + 28;
    const by = ROW_TOP[1] - GAP / 2 - 13;
    ctx.fillStyle = INK;
    pill(ctx, W / 2 - bw / 2, by, bw, 26);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, W / 2, by + 13.5);

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
  // color that only shows up later (a red HP bar, a fainted gray) is in it.
  // canvas.data() is the canvas's own pixels, not a copy; frames are opaque,
  // so its premultiplied alpha changes nothing.
  draw(total - 1);
  const sample = new Uint8Array(W * H * 8);
  sample.set(canvas.data(), W * H * 4);
  draw(0);
  sample.set(canvas.data(), 0);
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
