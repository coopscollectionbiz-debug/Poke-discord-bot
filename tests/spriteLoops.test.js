// Pokémon sprite loops on cards: loop plans (whole cycle, idle-return cut,
// speed-up), fitting one loop to several sprites, the union-box anchor, the
// stage's fitted GIFs and size fallback, and playback's continuing clock.
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { loopPlan, fitLoop, spriteTime, unionBox, LOOP_CAP_MS, STEP_MS, NUDGE } from "../utils/render/spriteLoops.js";
import { loadAnimatedSprite, renderBattleFrame } from "../utils/battle/render.js";
import { loadStaticSprite, spritePlacement } from "../utils/render/sprites.js";
import { spriteStage, MAX_GIF_BYTES } from "../utils/render/stage.js";
import { createCanvas } from "@napi-rs/canvas";
import { GifReader } from "omggif";

const gifInfo = (buf) => {
  const g = new GifReader(buf);
  let ms = 0;
  for (let i = 0; i < g.numFrames(); i++) ms += g.frameInfo(i).delay * 10;
  return { frames: g.numFrames(), ms, delay: g.frameInfo(0).delay * 10 };
};

section("Loop plans");
{
  const yanma = await loadAnimatedSprite(193, "normal");
  const p = loopPlan(yanma);
  assertEqual([p.loopEnd, p.speed, p.how], [yanma.duration, 1, "whole cycle"], `a cycle of 8 s or less plays whole (Yanma ${yanma.duration} ms)`);
  assertTrue(loopPlan(yanma) === p, "plans are cached per sprite");
  // A long sprite either cuts at an idle return between 2 and 8 s, or is sped up to 8 s.
  let checked = 0;
  for (const id of [130, 6, 445, 248, 94, 3, 9, 150, 384, 487]) {
    const a = await loadAnimatedSprite(id, "normal");
    if (!a || a.duration <= LOOP_CAP_MS) continue;
    const q = loopPlan(a);
    assertTrue(q.period <= LOOP_CAP_MS + 1 && (q.speed === 1 ? q.loopEnd >= 2000 : q.loopEnd === a.duration),
      `#${id} (${a.duration} ms): ${q.how}, a ${Math.round(q.period)} ms loop`);
    checked++;
  }
  assertTrue(checked > 0, `long sprites checked (${checked})`);
}

section("Fitting one loop to several sprites");
{
  const one = fitLoop([2210]);
  assertEqual(one.L, 2200, "one sprite: its own cycle, on the 50 ms grid");
  const pair = fitLoop([1000, 1500]);
  assertTrue(pair.fit.every(Boolean) && pair.fit.every((f) => Math.abs(f.s - 1) <= NUDGE), `two sprites both fit (L ${pair.L})`);
  assertTrue([2400, 4800, 7200].includes(fitLoop([1300, 900], { trainerClock: true }).L), "with a trainer on the card: a multiple of 2.4 s");
  assertEqual(fitLoop([null, null]).L, 2400, "no animated sprites: the trainers' 2.4 s");
  const odd = fitLoop([2000, 2000 * 1.5 * 1.29]);
  assertTrue(odd.fit.filter(Boolean).length >= 1, "a sprite that can't fit plays unnudged (seams once a loop)");
  const p = { loopEnd: 3000, speed: 1 };
  assertEqual([spriteTime(p, null, 3500), spriteTime(p, { k: 1, s: 1.25 }, 3750)], [500, 0], "sprite time wraps at the loop end, slowed by the nudge");
}

section("Union-box anchor");
{
  const s = await loadStaticSprite(193, "normal");
  const a = await loadAnimatedSprite(193, "normal");
  assertEqual(s.ubox, unionBox(a), "the static sprite carries the box every frame fits in");
  assertTrue(s.ubox.w >= s.box.w && s.ubox.h >= s.box.h, "at least as big as the first frame's");
  const at = spritePlacement(s, 100, 200, 180, 180, 2);
  assertTrue(Math.abs(at.gy + (s.ubox.y + s.ubox.h) * at.s - 200) < 1, "the union's bottom sits on the floor");
  assertEqual(spritePlacement(s, 100, 200, 180, 180, 2, { POKEMON_LOOP_FIT: "0" }), null, "POKEMON_LOOP_FIT=0: the old anchor");
}

section("Fitted cards");
{
  const strip = async (ids, env = process.env) => {
    const canvas = createCanvas(150 * ids.length, 190), ctx = canvas.getContext("2d");
    const stage = spriteStage({ animate: true, env });
    for (const [i, id] of ids.entries()) stage.place(ctx, await loadStaticSprite(id, "normal"), i * 150 + 75, 170, 140, 160, { scale: 2 }, { id, variant: "normal" });
    return stage.output(canvas);
  };
  const yanma = await loadAnimatedSprite(193, "normal");
  const one = gifInfo(await strip([193]));
  assertEqual(one.delay, STEP_MS, "50 ms steps");
  assertEqual(one.ms, Math.round(yanma.duration / STEP_MS) * STEP_MS, "a lone sprite: its whole cycle");
  const team = gifInfo(await strip([193, 22, 25, 6]));
  assertTrue(team.ms >= 2000 && team.ms <= LOOP_CAP_MS, `a Team: one loop of 2–8 s (${team.ms} ms)`);
  const old = gifInfo(await strip([193, 22], { POKEMON_LOOP_FIT: "0" }));
  assertEqual([old.frames, old.delay], [24, 100], "POKEMON_LOOP_FIT=0: 24 frames of 100 ms");
  assertEqual(MAX_GIF_BYTES, 8 * 1024 * 1024, "over 8 MB a card falls back to the 2.4 s loop, then a still");
}

section("Playback: the clock carries across updates");
{
  const pk = (speciesId) => ({ speciesId, name: `#${speciesId}`, level: 50, variant: "normal" });
  const sides = [{ name: "A", members: [pk(193)] }, { name: "B", members: [pk(9)] }];
  const frame0 = async (clockMs, env) => {
    const buf = await renderBattleFrame({ sides, hpBefore: [[1], [1]], clockMs, env });
    const g = new GifReader(buf), px = new Uint8ClampedArray(g.width * g.height * 4);
    g.decodeAndBlitFrameRGBA(0, px);
    return px;
  };
  const differs = (a, b) => a.some((v, i) => v !== b[i]);
  assertTrue(differs(await frame0(0), await frame0(700)), "an image starting 700 ms in shows the sprites 700 ms on");
  assertTrue(!differs(await frame0(0, { POKEMON_LOOP_FIT: "0" }), await frame0(700, { POKEMON_LOOP_FIT: "0" })), "POKEMON_LOOP_FIT=0: every image starts its sprites over");
}

finish();
