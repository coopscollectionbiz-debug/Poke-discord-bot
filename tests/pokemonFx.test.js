// ==========================================================
// tests/pokemonFx.test.js — the idle (clean-step breathing + blinks) for static Pokémon sprites
// (tools/generate-pokemon-idles.mjs) and the shiny backdrop on rendered
// cards (utils/render/shinyBackdrop.js through the card stage).
// ==========================================================

import fs from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import omggif from "omggif";
import { createCanvas } from "@napi-rs/canvas";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const SPECIES = read("../data/sprites/sprites.json").species;
const MEGAS = read("../data/sprites/megas.json").forms;
const { IDLE_LOOP, pokemonCuts, stepCount, pokemonLoop, breathTiming, LOW_CUT } = await import("../utils/spriteBreathing.js");
const { shinyBackdrop, SHINY_GOLD } = await import("../utils/render/shinyBackdrop.js");
const { loadStaticSprite } = await import("../utils/render/sprites.js");
const { loadAnimatedSprite } = await import("../utils/battle/render.js");
const { spriteStage } = await import("../utils/render/stage.js");

const decode = (buf) => {
  const g = new omggif.GifReader(new Uint8Array(buf));
  const frames = [];
  for (let i = 0; i < g.numFrames(); i++) {
    const px = new Uint8ClampedArray(g.width * g.height * 4);
    g.decodeAndBlitFrameRGBA(i, px);
    frames.push({ px, ms: g.frameInfo(i).delay * 10 });
  }
  return { W: g.width, H: g.height, frames };
};
const colours = (px) => { const s = new Set(); for (let p = 0; p < px.length; p += 4) if (px[p + 3]) s.add((px[p] << 16) | (px[p + 1] << 8) | px[p + 2]); return s; };

section("Idle: whole-body clean-step breathing + blinks on every static sprite, nothing else");
const BLINKS = read("../data/sprites/pokemon-blinks.json");
const files = [];
const animatedWithIdle = [];
for (const [id, r] of Object.entries(SPECIES)) for (const v of ["normal", "shiny"]) {
  if (r[v].kind === "static") files.push({ key: `species:${id}`, label: `#${id} ${v}`, rec: r[v], path: `../public/sprites/pokemon/${r[v].file}` });
  else if (r[v].motion) animatedWithIdle.push(`#${id} ${v}`);
}
for (const [id, r] of Object.entries(MEGAS)) for (const v of ["normal", "shiny"]) if (r[v].kind !== "static" && r[v].motion) animatedWithIdle.push(`${id} ${v}`);
assertEqual(animatedWithIdle, [], "animated art never gets the idle");
for (const [id, r] of Object.entries(MEGAS)) for (const v of ["normal", "shiny"]) if (r[v].kind === "static") files.push({ key: `mega:${id}`, label: `${id} ${v}`, rec: r[v], path: `../public/sprites/pokemon/mega/${r[v].file}` });
assertEqual(files.length, 156 + 163 + 71 + 71, "461 static sprites (species normal/shiny + Mega normal/shiny)");
const notBreathing = files.filter((f) => f.rec.motion !== "breathing").map((f) => f.label);
assertEqual(notBreathing, [], "every static sprite breathes (none excluded or awaiting review)");
const keys = new Set(files.map((f) => f.key));
const listed = [...Object.keys(BLINKS.blinks), ...Object.keys(BLINKS.noBlink)];
assertEqual([...keys].filter((k) => !listed.includes(k)), [], "every static sprite is decided in pokemon-blinks.json (blink or a reason it doesn't)");
assertEqual(listed.filter((k) => !keys.has(k)), [], "pokemon-blinks.json lists only static sprites");
assertTrue(Object.values(BLINKS.blinks).every((rs) => rs.length >= 1 && rs.length <= 2 && rs.every(([x0, y0, x1, y1]) => x1 >= x0 && y1 >= y0 && x1 - x0 < 10 && y1 - y0 < 8)), "blinks: one or two eyes, each rect at most 10×8 px (Scream Tail has the biggest)");

// The expected loop for each sprite: the normal sprite's whole-body cut lines (shared by shiny and grayscale) and its blink.
const REVIEW = read("../data/sprites/pokemon-idle-review.json");
const FACES = { ...Object.fromEntries(Object.entries(BLINKS.blinks).map(([k, e]) => [k, [Math.min(...e.map((q) => q[1])) - 2, Math.max(...e.map((q) => q[3])) + 6]])), ...REVIEW.faces };
const cutsFor = {};
for (const f of files) if (!cutsFor[f.key] || f.label.endsWith("normal")) {
  const g = decode(fs.readFileSync(new URL(f.path, import.meta.url)));
  cutsFor[f.key] = pokemonCuts(g.frames[0].px, g.W, g.H, { minHeight: 20, face: FACES[f.key] ?? null });
}
let shape = true, palette = true, timing = true, moves = true, stepsOk = true, blinkOk = true, firstOpen = true;
const bad = [];
for (const f of files) {
  const g = decode(fs.readFileSync(new URL(f.path, import.meta.url)));
  const eyes = BLINKS.blinks[f.key];
  const loop = pokemonLoop(f.key, stepCount(cutsFor[f.key]), { blink: !!eyes });
  if (g.frames.length !== loop.length) { shape = false; bad.push(f.label); continue; }
  const base = colours(g.frames[0].px);
  for (const fr of g.frames) for (const c of colours(fr.px)) if (!base.has(c)) palette = false;
  if (g.frames.map((x) => x.ms).join() !== loop.map((x) => x.ms).join()) timing = false;
  if (!g.frames.some((fr) => Buffer.compare(Buffer.from(fr.px), Buffer.from(g.frames[0].px)) !== 0)) moves = false;
  if (loop[0].pose !== 0 || loop[0].blink) firstOpen = false;
  if (cutsFor[f.key].steps.some((y) => y <= cutsFor[f.key].neck || y > cutsFor[f.key].waist)) stepsOk = false;
  // The blink frame differs from the rest frame only inside the eye rects.
  const b = loop.findIndex((x) => x.blink);
  if (eyes) {
    const inEye = (x, y) => eyes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    let inside = 0, outside = 0;
    for (let p = 0; p < g.W * g.H; p++) {
      const a = g.frames[0].px, c = g.frames[b].px;
      if (a[p * 4] !== c[p * 4] || a[p * 4 + 1] !== c[p * 4 + 1] || a[p * 4 + 2] !== c[p * 4 + 2] || a[p * 4 + 3] !== c[p * 4 + 3]) { if (inEye(p % g.W, (p / g.W) | 0)) inside++; else outside++; }
    }
    if (b < 1 || loop[b].pose !== 0 || inside === 0 || outside !== 0) { blinkOk = false; bad.push(`${f.label} blink`); }
  } else if (b !== -1) blinkOk = false;
}
assertTrue(shape, `each GIF has its loop's frames (4–10, by step count and blink)${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
assertTrue(palette, "only the sprite's own colours, in every frame (lids and lashes too)");
assertTrue(timing, "the trainer idle's timing: clean 360 ms steps, holds at the sprite's own tempo");
assertTrue(moves, "every sprite moves");
assertTrue(firstOpen, "frame 0 is the rest pose with open eyes (the untouched sprite)");
assertTrue(stepsOk, "in-between step rows sit above the low cut");
const cuts = Object.entries(cutsFor);
const crossing = cuts.filter(([k, c]) => FACES[k] && [c.waist, ...c.steps].some((y) => y >= FACES[k][0] && y <= FACES[k][1])).map(([k]) => k);
assertEqual(crossing, [], "whole-body breath: no cut row crosses a face (blink eyes, or a hand-marked low face)");
const guarded = cuts.filter(([k]) => !FACES[k] || !(REVIEW.faces ?? {})[k]);
assertTrue(guarded.every(([, c]) => c.waist >= c.bounds.y0 + c.bounds.h * LOW_CUT[0] - 1 && c.waist <= c.bounds.y0 + c.bounds.h * LOW_CUT[1] + 1), "the low cut sits near the feet (74–90 % of the height), below the head");
assertTrue(blinkOk, `the blink frame closes the listed eyes and changes nothing else; unlisted sprites never blink${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
const tempos = new Set(Object.keys(cutsFor).map((k) => breathTiming(k).rest));
assertTrue(tempos.size > 20, `sprites breathe at their own tempo (${tempos.size} different rest holds), so a team never breathes in step`);
assertTrue(IDLE_LOOP.every(([, ms]) => ms >= 60), "no step shorter than 60 ms");
const grays = Object.entries(SPECIES).filter(([, r]) => r.normal.motion === "breathing").map(([id, r]) => ({ id, gr: r.grayscale, n: r.normal }));
assertTrue(grays.every(({ gr, n }) => gr.motion === "breathing" && decode(fs.readFileSync(new URL(`../public/sprites/pokemon/${gr.file}`, import.meta.url))).frames.length === decode(fs.readFileSync(new URL(`../public/sprites/pokemon/${n.file}`, import.meta.url))).frames.length), "grayscale (not-owned) copies breathe and blink with their normal sprite");
const check = spawnSync(process.execPath, [fileURLToPath(new URL("../tools/generate-pokemon-idles.mjs", import.meta.url)), "--check"], { encoding: "utf8" });
assertEqual(check.status, 0, `generator --check: files and manifests up to date (${(check.stdout || check.stderr).trim()})`);

section("Shiny backdrop: Legendary motes + stars, never behind the Pokémon");
const goldPixels = (ctx, W, H) => {
  const d = ctx.getImageData(0, 0, W, H).data; const out = [];
  for (let p = 0; p < d.length; p += 4) if (d[p + 3] && d[p] > 40 && d[p] >= d[p + 2] + 20) out.push(p / 4);
  return out;
};
for (const [id, variant] of [[6, "shiny"], [906, "shiny"], ["mega-charizard-x", "shiny"]]) {
  const sprite = await loadStaticSprite(id, variant);
  const anim = await loadAnimatedSprite(id, variant);
  const W = 300, H = 260, place = { cx: 150, floorY: 240, boxW: 280, boxH: 230, scale: 2 };
  const bd = shinyBackdrop({ sprite, anim, ...place, seed: 11 });
  assertTrue(bd && bd.stars >= 3 && bd.motes >= 1, `${id}: backdrop has stars (${bd?.stars}) and motes (${bd?.motes})`);
  // The union of the sprite's frames, drawn where the stage would draw them.
  const spriteCanvas = createCanvas(W, H), sctx = spriteCanvas.getContext("2d");
  const { drawSprite } = await import("../utils/render/sprites.js");
  const { spritePlayer } = await import("../utils/battle/render.js");
  const play = anim && anim.gif.numFrames() > 1 ? spritePlayer(anim) : null;
  const covered = new Uint8Array(W * H);
  for (let ms = 0; ms < (anim?.duration ?? 1); ms += 50) {
    sctx.clearRect(0, 0, W, H);
    drawSprite(sctx, sprite, place.cx, place.floorY, place.boxW, place.boxH, { scale: 2, frame: play ? play(ms) : null });
    const d = sctx.getImageData(0, 0, W, H).data;
    for (let p = 0; p < covered.length; p++) if (d[p * 4 + 3] > 8) covered[p] = 1;
    if (!play) break;
  }
  let behind = 0, drawn = 0;
  for (let f = 0; f < 24; f++) {
    const c = createCanvas(W, H), ctx = c.getContext("2d");
    bd.draw(ctx, f, 24);
    for (const p of goldPixels(ctx, W, H)) { drawn++; if (covered[p]) behind++; }
  }
  assertTrue(drawn > 0 && behind === 0, `${id}: ${drawn} backdrop pixels over 24 frames, none where the Pokémon is in any frame`);
  const a = createCanvas(W, H), b = createCanvas(W, H);
  bd.draw(a.getContext("2d"), 0, 24); bd.draw(b.getContext("2d"), 24, 24);
  assertTrue(Buffer.compare(a.toBuffer("image/png"), b.toBuffer("image/png")) === 0, `${id}: the loop is seamless (frame 24 = frame 0)`);
}
assertEqual(SHINY_GOLD, [250, 204, 21], "the Legendary tier gold (#facc15)");

section("Cards: only shinies get it; SHINY_FX=0 turns it off");
async function stillCard(variant, env = {}) {
  const c = createCanvas(300, 260), ctx = c.getContext("2d");
  ctx.fillStyle = "#1c2438"; ctx.fillRect(0, 0, 300, 260);
  const stage = spriteStage({ animate: false, env });
  stage.place(ctx, await loadStaticSprite(25, variant), 150, 240, 280, 230, { scale: 2 }, { id: 25, variant });
  return goldPixels(ctx, 300, 260).length;
}
const shinyGold = await stillCard("shiny"), normalGold = await stillCard("normal"), offGold = await stillCard("shiny", { SHINY_FX: "0" });
assertTrue(shinyGold > normalGold + 4, `a shiny card adds backdrop pixels (${shinyGold} vs ${normalGold} gold-ish px from the sprite alone)`);
assertTrue(offGold <= normalGold + 4 && offGold < shinyGold, "SHINY_FX=0: no backdrop");

finish();
