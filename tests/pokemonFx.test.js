// ==========================================================
// tests/pokemonFx.test.js — the rig idle (squash, lean, ear drag, blinks) for static Pokémon sprites
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
const { LOW_CUT, blinkEyes } = await import("../utils/spriteBreathing.js");
const { rigCuts, rigPose, rigPlan, headSpan, LEAN_MAX_COST, BAND_SPREAD, EAR_MIN_PX } = await import("../utils/spriteRig.js");
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

section("Idle: the rig (squash, head lean, ear drag, blink) on every static sprite, nothing else");
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
const notBreathing = files.filter((f) => f.rec.motion !== "rig").map((f) => f.label);
assertEqual(notBreathing, [], "every static sprite gets the rig idle (none excluded or awaiting review)");
const keys = new Set(files.map((f) => f.key));
const listed = [...Object.keys(BLINKS.blinks), ...Object.keys(BLINKS.noBlink)];
assertEqual([...keys].filter((k) => !listed.includes(k)), [], "every static sprite is decided in pokemon-blinks.json (blink or a reason it doesn't)");
assertEqual(listed.filter((k) => !keys.has(k)), [], "pokemon-blinks.json lists only static sprites");
assertTrue(Object.values(BLINKS.blinks).every((rs) => rs.length >= 1 && rs.length <= 2 && rs.every(([x0, y0, x1, y1]) => x1 >= x0 && y1 >= y0 && x1 - x0 < 10 && y1 - y0 < 8)), "blinks: one or two eyes, each rect at most 10×8 px (Scream Tail has the biggest)");

// The expected loop for each sprite: one rig (cuts + seeded plan, from the normal sprite when it is static) drives every variant.
const REVIEW = read("../data/sprites/pokemon-idle-review.json");
const FACES = { ...Object.fromEntries(Object.entries(BLINKS.blinks).map(([k, e]) => [k, [Math.min(...e.map((q) => q[1])) - 2, Math.max(...e.map((q) => q[3])) + 6]])), ...REVIEW.faces };
const rigFor = {}, spanFor = {};
for (const f of files) if (!rigFor[f.key] || f.label.endsWith("normal")) {
  const g = decode(fs.readFileSync(new URL(f.path, import.meta.url)));
  spanFor[f.key] = headSpan(g.frames[0].px, g.W, g.H, FACES[f.key] ?? null, BLINKS.blinks[f.key] ?? null);
  const rc = rigCuts(g.frames[0].px, g.W, g.H, { face: FACES[f.key] ?? null, eyes: BLINKS.blinks[f.key] ?? null, minHeight: 20, off: REVIEW.rigOff?.[f.key] });
  rigFor[f.key] = { rc, plan: rigPlan(f.key, rc, { blink: !!BLINKS.blinks[f.key] }) };
}
/** The frames the generator should have written for these pixels (identical neighbours merged). */
function expected(key, px, W, H) {
  const { rc, plan } = rigFor[key], eyes = BLINKS.blinks[key];
  const shut = eyes ? blinkEyes(px, W, H, eyes) : null, out = [];
  for (const f of plan.frames) {
    const img = rigPose(f.blink ? shut : px, W, H, rc, f), last = out.at(-1);
    if (last && Buffer.compare(Buffer.from(last.px), Buffer.from(img)) === 0) { last.ms += plan.ms; last.blink ||= f.blink; } else out.push({ px: img, ms: plan.ms, blink: f.blink });
  }
  return out;
}
let shape = true, exact = true, palette = true, moves = true, blinkOk = true, firstOpen = true;
const bad = [];
for (const f of files) {
  const g = decode(fs.readFileSync(new URL(f.path, import.meta.url)));
  const eyes = BLINKS.blinks[f.key];
  const want = expected(f.key, g.frames[0].px, g.W, g.H);
  if (g.frames.length !== want.length || g.frames.map((x) => x.ms).join() !== want.map((x) => x.ms).join()) { shape = false; bad.push(f.label); continue; }
  if (g.frames.some((fr, i) => Buffer.compare(Buffer.from(fr.px), Buffer.from(want[i].px)) !== 0)) { exact = false; bad.push(`${f.label} pixels`); }
  const base = colours(g.frames[0].px);
  for (const fr of g.frames) for (const c of colours(fr.px)) if (!base.has(c)) palette = false;
  if (!g.frames.some((fr) => Buffer.compare(Buffer.from(fr.px), Buffer.from(g.frames[0].px)) !== 0)) moves = false;
  const p0 = rigFor[f.key].plan.frames[0];
  if (p0.sq || p0.head || p0.ears || p0.blink) firstOpen = false;
  // A blink frame (rest pose, eyes shut) differs from frame 0 only inside the eye rects.
  const bi = rigFor[f.key].plan.frames.findIndex((x) => x.blink);
  if (eyes) {
    const shut = blinkEyes(g.frames[0].px, g.W, g.H, eyes);
    const inEye = (x, y) => eyes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    let inside = 0, outside = 0;
    for (let q = 0; q < g.W * g.H; q++) for (let k = 0; k < 4; k++) if (shut[q * 4 + k] !== g.frames[0].px[q * 4 + k]) { if (inEye(q % g.W, (q / g.W) | 0)) inside++; else outside++; break; }
    const shown = g.frames.some((fr) => Buffer.compare(Buffer.from(fr.px), Buffer.from(shut)) === 0);
    if (bi < 1 || inside === 0 || outside !== 0 || !shown) { blinkOk = false; bad.push(`${f.label} blink`); }
  } else if (bi !== -1) blinkOk = false;
}
assertTrue(shape, `each GIF has its rig's frames and timing${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
assertTrue(exact, "every frame is exactly the rig pose (normal, shiny, from the shared cuts and plan)");
assertTrue(palette, "only the sprite's own colours, in every frame (lids and lashes too)");
assertTrue(moves, "every sprite moves");
assertTrue(firstOpen, "frame 0 is the rest pose with open eyes (the untouched sprite)");
assertTrue(blinkOk, `the blink closes the listed eyes, changes nothing else and is shown; unlisted sprites never blink${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
const rigs = Object.entries(rigFor);
const crossing = rigs.filter(([k, { rc }]) => FACES[k] && [...rc.drops, rc.head, rc.ears].some((y) => y >= FACES[k][0] && y <= FACES[k][1])).map(([k]) => k);
assertEqual(crossing, [], "no squash, lean or ear row crosses a face (blink eyes, or a hand-marked face)");
assertTrue(rigs.every(([, { rc }]) => (rc.head < 0 || rc.headCost <= LEAN_MAX_COST) && (rc.ears < 0 || rc.earCost <= LEAN_MAX_COST)), `lean breaks are near-invisible (≤ ${LEAN_MAX_COST} px), or that lean is left out`);
assertTrue(rigs.every(([, { rc }]) => rc.drops.includes(rc.low.waist) && rc.drops.length <= 3), "squash: the reviewed low cut plus at most 2 more rows");
const guarded = rigs.filter(([k]) => !(REVIEW.faces ?? {})[k] && !FACES[k]).map(([, { rc }]) => rc.low);
assertTrue(guarded.every((c) => c.waist >= c.bounds.y0 + c.bounds.h * LOW_CUT[0] - 1 && c.waist <= c.bounds.y0 + c.bounds.h * LOW_CUT[1] + 1), "the low cut sits near the feet (74–90 % of the height)");
// Variety: every Pokémon gets its own performance.
const sig = (pl) => `${pl.ms}|${pl.frames.map((x) => `${x.sq}${x.head}${x.ears}${x.blink ? "b" : ""}`).join(",")}`;
const sigs = new Set(rigs.map(([, { plan }]) => sig(plan)));
assertTrue(sigs.size >= rigs.length * 0.95, `no two Pokémon move alike (${sigs.size} different performances for ${rigs.length} sprites)`);
assertEqual(new Set(rigs.map(([, { plan }]) => plan.ms)).size, 5, "five frame tempos in use (80–120 ms)");
assertTrue(rigs.every(([k]) => sig(rigPlan(k, rigFor[k].rc, { blink: !!BLINKS.blinks[k] })) === sig(rigFor[k].plan)), "each Pokémon's performance is fixed (seeded by its sprite key)");
// Only the head's own piece moves sideways: the band sits above its row, stays about head-wide, and only where the head is known.
const known = (k) => !!BLINKS.blinks[k] || (REVIEW.faces?.[k]?.length ?? 0) >= 4;
const bandOk = (k, rc, row, mask) => {
  if (row < 0) return mask === null;
  const span = spanFor[k], w = span[1] - span[0] + 1;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    n++;
    const x = i % 96, y = (i / 96) | 0;
    if (y >= row || x < span[0] - w * BAND_SPREAD - 0.5 || x > span[1] + w * BAND_SPREAD + 0.5) return false;
  }
  return n >= 12;
};
assertTrue(rigs.every(([k, { rc }]) => (rc.head < 0 && rc.ears < 0) || known(k)), "a head leans or drags its ears only where the head is known (blink eyes, or a marked face with columns)");
assertTrue(rigs.every(([k, { rc }]) => bandOk(k, rc, rc.head, rc.headMask) && bandOk(k, rc, rc.ears, rc.earMask)), "lean and ear bands are the head's own piece above their line, within the head's width (no wing tips or arms)");
assertTrue(Object.entries(REVIEW.rigOff ?? {}).every(([k, off]) => (!off.head || rigFor[k].rc.head < 0) && (!off.ears || rigFor[k].rc.ears < 0)), "moves switched off after review stay off (Pecharunt's ear band)");
assertTrue(rigs.filter(([, { rc }]) => rc.head > 0 || rc.ears > 0).length >= 140, "140+ heads lean or drag their ears; the rest squash");
assertTrue(rigs.every(([k]) => known(k) || (REVIEW.noHead ?? {})[k]), "every static sprite has a known head (eyes or a marked face) or a reason it has none");
assertTrue(rigs.every(([, { rc }]) => rc.ears < 0 || rc.earMask.reduce((n, v) => n + v, 0) >= EAR_MIN_PX), `ear bands move at least ${EAR_MIN_PX} px (no loose tips)`);
const grays = Object.entries(SPECIES).filter(([, r]) => r.normal.motion === "rig").map(([id, r]) => ({ id, gr: r.grayscale, n: r.normal }));
assertTrue(grays.every(({ gr, n }) => gr.motion === "rig" && decode(fs.readFileSync(new URL(`../public/sprites/pokemon/${gr.file}`, import.meta.url))).frames.length === decode(fs.readFileSync(new URL(`../public/sprites/pokemon/${n.file}`, import.meta.url))).frames.length), "grayscale (not-owned) copies move and blink with their normal sprite");
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
