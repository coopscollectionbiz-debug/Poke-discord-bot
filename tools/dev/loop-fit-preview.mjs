// Renders sample cards with fitted sprite loops (and with POKEMON_LOOP_FIT=0
// for comparison), printing each card's loop, size and render time:
//   node tools/dev/loop-fit-preview.mjs [outDir]   (default: .cache/loop-fit)
import { mkdirSync, writeFileSync } from "fs";
import { performance } from "perf_hooks";
import { createCanvas } from "@napi-rs/canvas";
import { spriteStage } from "../../utils/render/stage.js";
import { loadStaticSprite } from "../../utils/render/sprites.js";
import { drawBackground } from "../../utils/render/primitives.js";
import { loadAnimatedSprite, renderBattleFrame } from "../../utils/battle/render.js";
import { loopPlan, fitLoop } from "../../utils/render/spriteLoops.js";

const out = process.argv[2] ?? ".cache/loop-fit";
mkdirSync(out, { recursive: true });
const rows = [];
const kind = (b) => (b.subarray(0, 3).toString() === "GIF" ? "gif" : "png");
async function save(name, render, note = "") {
  const t0 = performance.now();
  const buf = await render();
  rows.push({ name: `${name}.${kind(buf)}`, kb: Math.round(buf.length / 1024), ms: Math.round(performance.now() - t0), note });
  writeFileSync(`${out}/${name}.${kind(buf)}`, buf);
}

async function strip(ids, env) {
  const W = 150 * ids.length, H = 190, floor = 170;
  const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");
  drawBackground(ctx, W, H);
  const stage = spriteStage({ animate: true, env });
  for (const [i, id] of ids.entries()) stage.place(ctx, await loadStaticSprite(id, "normal"), i * 150 + 75, floor, 140, 160, { scale: 2 }, { id, variant: "normal" });
  return stage.output(canvas);
}

const TEAM = [193, 22, 25, 6, 469, 12];
const anims = await Promise.all(TEAM.map((id) => loadAnimatedSprite(id, "normal")));
const plans = anims.map((a) => loopPlan(a));
const { L, fit } = fitLoop(plans.map((p) => p.period));
const note = `L ${L} ms; ${fit.map((f, i) => `${TEAM[i]}:${f ? `${f.k}×${((f.s - 1) * 100).toFixed(0)}%` : "seam"}`).join(" ")}`;
await save("team-fitted", () => strip(TEAM, process.env), note);
await save("team-old", () => strip(TEAM, { ...process.env, POKEMON_LOOP_FIT: "0" }), "2.4 s, frame-0 anchor");
await save("yanma-fitted", () => strip([193], process.env), `${plans[0].how}, ${Math.round(plans[0].period)} ms`);
await save("yanma-old", () => strip([193], { ...process.env, POKEMON_LOOP_FIT: "0" }));

const pk = (speciesId, name) => ({ speciesId, name, level: 50, variant: "normal" });
const sides = [
  { name: "Coop", members: TEAM.map((id) => pk(id, `#${id}`)) },
  { name: "Ash", members: [445, 248, 9, 94, 130, 3].map((id) => pk(id, `#${id}`)) },
];
const full = [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]];
await save("battle-t1-fitted", () => renderBattleFrame({ sides, hpBefore: full, screens: [["", ""]], clockMs: 2000 }), "clock starts at 2,000 ms");
await save("battle-t1-old", () => renderBattleFrame({ sides, hpBefore: full, screens: [["", ""]], clockMs: 2000, env: { POKEMON_LOOP_FIT: "0" } }));
console.table(rows);
