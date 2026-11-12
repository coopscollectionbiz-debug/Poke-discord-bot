// ==========================================================
// tools/bench-result-loops.mjs
// Render time, size and loop length of /battle playback start and result
// images, this checkout against another (e.g. a master worktree), and
// against POKEMON_LOOP_FIT=0. Saves the GIFs for a visual check.
//
//   node tools/bench-result-loops.mjs [--before <checkout>] [--out <dir>] [--runs 5]
//
// --before: a checkout whose utils/battle/render.js is "before" (it needs
// node_modules). Without it, "before" is this checkout with POKEMON_LOOP_FIT=0
// (the old timing, byte for byte). Over 8 MB (MAX_GIF_BYTES) a fitted image
// falls back to the old timing; the table flags any image over it.
// ==========================================================

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { performance } from "perf_hooks";
import { GifReader } from "omggif";

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const beforeRoot = arg("before");
const outDir = arg("out");
const runs = Number(arg("runs", 5));

const load = async (root) => import(pathToFileURL(path.join(root, "utils/battle/render.js")).href);
const after = await load(here);
const before = beforeRoot ? await load(path.resolve(beforeRoot)) : null;
const { MAX_GIF_BYTES, loopPlan, fitLoop } = await import(pathToFileURL(path.join(here, "utils/render/spriteLoops.js")).href);

const pk = (speciesId, name, level = 50) => ({ speciesId, name, level, variant: "normal" });
const team = [pk(494, "Victini"), pk(245, "Suicune"), pk(445, "Garchomp"), pk(376, "Metagross"), pk(134, "Vaporeon")];
const foes = [pk(6, "Charizard"), pk(150, "Mewtwo"), pk(9, "Blastoise")];
const sides = [{ name: "Ash", members: team }, { name: "Gary", members: foes }];
const trainers = ["cynthia-anime.png", "alain.png"];
const cases = {
  // The FINAL image: 5 standing vs 3 fainted, both trainers idling, tier rows.
  result: {
    sides, hpBefore: [[1, 0.6, 1, 0.3, 1], [0, 0, 0]], badge: "FINAL", winnerSide: 0, trainers, tiers: ["mythic", "legendary"],
    screens: [["Ash defeated Gary!", ""], ["Victini grew to Lv51!", ""]], clockMs: 23000,
  },
  // The same with no trainers or tiers: fitLoop picks L freely.
  "result-plain": { sides, hpBefore: [[1, 0.6, 1, 0.3, 1], [0, 0, 0]], badge: "FINAL", winnerSide: 0, screens: [["Ash defeated Gary!", ""]] },
  // The start image, everyone standing.
  start: { sides, hpBefore: [[1, 1, 1, 1, 1], [1, 1, 1]], trainers, tiers: ["mythic", "legendary"], screens: [["The battle begins!", "Victini and Charizard lead off."]], clockMs: 3000 },
};

const info = (buf) => {
  const r = new GifReader(buf);
  let ms = 0;
  for (let i = 0; i < r.numFrames(); i++) ms += r.frameInfo(i).delay * 10;
  return { frames: r.numFrames(), ms };
};
const time = async (render, opts) => {
  const ts = [];
  let buf;
  await render(opts); // warm the sprite and trainer caches
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    buf = await render({ ...opts, sprites: new Map() });
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return { buf, ms: Math.round(ts[Math.floor(ts.length / 2)]) };
};

const rows = [];
for (const [name, opts] of Object.entries(cases)) {
  const variants = [
    ["before", before ? (o) => before.renderBattleFrame(o) : (o) => after.renderBattleFrame({ ...o, env: { ...process.env, POKEMON_LOOP_FIT: "0" } })],
    ["after", (o) => after.renderBattleFrame(o)],
  ];
  if (before) variants.push(["after, fit off", (o) => after.renderBattleFrame({ ...o, env: { ...process.env, POKEMON_LOOP_FIT: "0" } })]);
  for (const [label, render] of variants) {
    const { buf, ms } = await time(render, opts);
    const { frames, ms: loop } = info(buf);
    rows.push({ image: name, version: label, "render ms (median)": ms, KB: Math.round(buf.length / 1024), frames, "loop ms": loop, "over 8 MB": buf.length > MAX_GIF_BYTES ? "YES" : "" });
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `battle-${name}-${label.replace(/[^a-z]+/g, "-")}.gif`), buf);
    }
  }
}
console.table(rows);

// How many of the standing sprites play whole cycles in the fitted loop.
const live = await Promise.all(team.map((m) => after.loadAnimatedSprite(m.speciesId, "normal")));
const periods = live.map((a) => loopPlan(a).period);
for (const trainerClock of [true, false]) {
  const { L, fit } = fitLoop(periods, { trainerClock });
  console.log(`${trainerClock ? "with trainers/tiers" : "plain"}: L ${L} ms; whole cycles: ${fit.map((f, i) => `${team[i].name} ${f ? `×${f.k} at ${(1 / f.s).toFixed(2)}×` : "seams once per loop"}`).join(", ")}`);
}
// The seam: render again with the clock one GIF length on; frame 0 of that is
// what the GIF should show right after its last frame. Pixels that differ
// from this GIF's frame 0, per standing Pokémon's tile, jump at the wrap.
const frame0 = (b) => { const r = new GifReader(b), px = new Uint8Array(r.width * r.height * 4); r.decodeAndBlitFrameRGBA(0, px); return px; };
for (const [label, mod] of [["before", before ?? after], ["after", after]]) {
  const env = !before && label === "before" ? { ...process.env, POKEMON_LOOP_FIT: "0" } : process.env;
  for (const name of ["result", "result-plain"]) {
    const o = { ...cases[name], clockMs: cases[name].clockMs ?? 0, env };
    const a = await mod.renderBattleFrame(o);
    const b = await mod.renderBattleFrame({ ...o, clockMs: o.clockMs + info(a).ms });
    const [A, B] = [frame0(a), frame0(b)];
    const jumps = team.map((m, i) => {
      const cx = Math.round(after.tileCenter(team.length, i));
      let d = 0;
      for (let y = 30; y < 140; y++) for (let x = cx - 60; x < cx + 60; x++) {
        const k = (y * after.FRAME_WIDTH + x) * 4;
        if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 60) d++;
      }
      return `${m.name} ${d}`;
    });
    console.log(`${name} ${label}: pixels jumping at the wrap (every ${info(a).ms} ms): ${jumps.join(", ")}`);
  }
}
if (before) {
  // POKEMON_LOOP_FIT=0 must match the before checkout byte for byte.
  const off = { ...process.env, POKEMON_LOOP_FIT: "0" };
  for (const [name, opts] of Object.entries(cases)) {
    const a = await before.renderBattleFrame({ ...opts, env: off, sprites: new Map() });
    const b = await after.renderBattleFrame({ ...opts, env: off, sprites: new Map() });
    console.log(`${name}, POKEMON_LOOP_FIT=0: ${a.equals(b) ? "identical to before" : "DIFFERS from before"}`);
  }
}
