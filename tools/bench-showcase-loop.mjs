// ==========================================================
// tools/bench-showcase-loop.mjs — does the /showcase GIF loop without a jump?
//   node tools/bench-showcase-loop.mjs [--out <dir>]
// Renders the /showcase card (renderShowteam, refined layout) for a few
// teams with POKEMON_LOOP_FIT=0 (the old 24 × 100 ms loop) and with the
// fitted loop, and reports:
//   ms, KB, frames and loop length;
//   whole cycles per Pokémon in the fitted loop (fitLoop's verdict);
//   the wrap check: pixels that change from the last frame back to frame 0,
//   against the largest change between two neighbouring frames. A wrap
//   bigger than any normal step is a visible jump.
// ==========================================================
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { renderShowteam } from "../utils/render/showteam.js";
import { buildTeamView } from "../utils/render/teamView.js";
import { loadAnimatedSprite } from "../utils/battle/render.js";
import { loopPlan, fitLoop } from "../utils/render/spriteLoops.js";
import { FIXTURES } from "../tests/fixtures/showteamFixtures.js";

const outAt = process.argv.indexOf("--out");
const OUT = outAt > 0 ? path.resolve(process.argv[outAt + 1]) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const clone = (o) => JSON.parse(JSON.stringify(o));
const withTeam = (team) => {
  const user = clone(FIXTURES.full.user);
  user.displayedPokemon = team.map(([id, variant]) => ({ id, variant }));
  user.showcaseTeam = user.displayedPokemon;
  for (const [id, variant] of team) {
    user.pokemon[id] ??= { normal: 0, shiny: 0 };
    user.pokemon[id][variant] = Math.max(1, user.pokemon[id][variant] ?? 0);
  }
  return user;
};
const TEAMS = {
  "fixture team (2 shiny)": FIXTURES.full.user,
  "no shiny": withTeam([[6, "normal"], [445, "normal"], [130, "normal"], [25, "normal"], [637, "normal"], [94, "normal"]]),
  "Kalos": withTeam([[658, "normal"], [700, "normal"], [681, "normal"], [715, "normal"], [663, "normal"], [706, "shiny"]]),
};

function frames(buf) {
  const g = new GifReader(buf);
  const px = new Uint8Array(g.width * g.height * 4);
  const out = [], delays = [];
  for (let i = 0; i < g.numFrames(); i++) { g.decodeAndBlitFrameRGBA(i, px); out.push(px.slice()); delays.push(g.frameInfo(i).delay * 10); }
  return { out, delays };
}
const changed = (a, b) => {
  let n = 0;
  for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 60) n++;
  return n;
};

const rows = [];
for (const [name, user] of Object.entries(TEAMS)) {
  const view = buildTeamView(user, { displayName: "Coop" });
  const anims = await Promise.all(view.slots.map((s) => loadAnimatedSprite(s.spriteId ?? s.id, s.variant)));
  const periods = anims.map((a) => (a && a.gif.numFrames() > 1 ? loopPlan(a).period : null));
  const shiny = view.slots.some((s) => s.variant === "shiny");
  const { L, fit } = fitLoop(periods, { trainerClock: shiny });
  console.log(`${name}: fitted L ${L} ms; ${view.slots.map((s, i) => `#${s.id}${s.variant === "shiny" ? "✨" : ""} ${periods[i] == null ? "still" : fit[i] ? `×${fit[i].k}` : "SEAMS"}`).join(", ")}`);
  for (const [label, fit0] of [["before (24 × 100 ms)", "0"], ["after (fitted)", "1"]]) {
    const t = performance.now();
    const gif = await renderShowteam(view, { layout: "refined", animate: true, env: { ...process.env, POKEMON_LOOP_FIT: fit0 } });
    const ms = Math.round(performance.now() - t);
    const { out, delays } = frames(gif);
    let step = 0;
    for (let i = 1; i < out.length; i++) step = Math.max(step, changed(out[i - 1], out[i]));
    const wrap = changed(out.at(-1), out[0]);
    rows.push({ team: name, render: label, ms, kb: Math.round(gif.length / 1024), frames: out.length, loopMs: delays.reduce((a, b) => a + b, 0), wrapPx: wrap, maxStepPx: step, jump: wrap > step ? "YES" : "no" });
    if (OUT) fs.writeFileSync(path.join(OUT, `${name.replace(/\W+/g, "-")}-${fit0 === "1" ? "after" : "before"}.gif`), gif);
  }
}
console.table(rows);
