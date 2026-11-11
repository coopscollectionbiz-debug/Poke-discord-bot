// ==========================================================
// tests/pokemonFx.test.js — the breathing idle for static Pokémon sprites
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
const { IDLE_LOOP } = await import("../utils/spriteBreathing.js");
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

section("Breathing idle: every static sprite, nothing else");
const files = [];
const animatedWithIdle = [];
for (const [id, r] of Object.entries(SPECIES)) for (const v of ["normal", "shiny"]) {
  if (r[v].kind === "static") files.push({ label: `#${id} ${v}`, rec: r[v], path: `../public/sprites/pokemon/${r[v].file}` });
  else if (r[v].motion) animatedWithIdle.push(`#${id} ${v}`);
}
for (const [id, r] of Object.entries(MEGAS)) for (const v of ["normal", "shiny"]) if (r[v].kind !== "static" && r[v].motion) animatedWithIdle.push(`${id} ${v}`);
assertEqual(animatedWithIdle, [], "animated art never gets the breathing idle");
for (const [id, r] of Object.entries(MEGAS)) for (const v of ["normal", "shiny"]) if (r[v].kind === "static") files.push({ label: `${id} ${v}`, rec: r[v], path: `../public/sprites/pokemon/mega/${r[v].file}` });
assertEqual(files.length, 156 + 163 + 71 + 71, "461 static sprites (species normal/shiny + Mega normal/shiny)");
const notBreathing = files.filter((f) => f.rec.motion !== "breathing").map((f) => f.label);
assertEqual(notBreathing, [], "every static sprite breathes (none excluded or awaiting review)");
let shape = true, palette = true, timing = true, moves = true;
for (const f of files) {
  const g = decode(fs.readFileSync(new URL(f.path, import.meta.url)));
  if (g.frames.length !== 4) { shape = false; continue; }
  const base = colours(g.frames[0].px);
  for (const fr of g.frames) for (const c of colours(fr.px)) if (!base.has(c)) palette = false;
  if (g.frames.map((x) => x.ms).join() !== IDLE_LOOP.map(([, ms]) => ms).join()) timing = false;
  if (Buffer.compare(Buffer.from(g.frames[0].px), Buffer.from(g.frames[2].px)) === 0) moves = false;
}
assertTrue(shape, "4 frames each (rest, head lag, exhale, head lag)");
assertTrue(palette, "only the sprite's own colours, in every frame");
assertTrue(timing, "the trainer idle's timing (900 / 110 / 700 / 110 ms)");
assertTrue(moves, "the exhale differs from the rest pose");
const grays = Object.values(SPECIES).filter((r) => r.normal.motion === "breathing").map((r) => r.grayscale);
assertTrue(grays.every((gr) => gr.motion === "breathing" && decode(fs.readFileSync(new URL(`../public/sprites/pokemon/${gr.file}`, import.meta.url))).frames.length === 4), "grayscale (not-owned) copies breathe with their normal sprite");
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
