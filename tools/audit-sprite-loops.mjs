// ==========================================================
// tools/audit-sprite-loops.mjs — how often card sprites still jump at the loop.
//   node tools/audit-sprite-loops.mjs [--teams 400] [--gens 1-6]
// Uses the same rules the cards use (utils/render/spriteLoops.js loopPlan +
// fitLoop): a sprite that fitLoop can't fit (null) plays a partial cycle and
// jumps back once per GIF loop. Reports the share of sprites that jump for
// each kind of card:
//   1 sprite              catch / Pokédex / inspect, normal Pokémon
//   1 sprite + 2.4 s clock the same cards for a shiny (sparkle backdrop)
//   6 sprites             a team card with no trainer clock
//   6 sprites + clock      trainer card, ranked card, /showcase with a shiny
//   12 sprites + clock     VS card, battle start/result images with trainers
// Also prices the "idle hold" alternative: a sprite fitLoop can't fit plays
// as many whole cycles as fit in L at its own speed, then holds its first
// frame until the loop restarts (no jump; a pause). Reports that pause.
// over every animated sprite in the live generations (single cases) and
// random teams drawn from them (team cases).
// ==========================================================
import { loadAnimatedSprite } from "../utils/battle/render.js";
import { loopPlan, fitLoop, SINGLE_CLOCK_CAP_MS } from "../utils/render/spriteLoops.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TEAMS = Number(arg("teams", "400"));
const [g0, g1] = arg("gens", "1-6").split("-").map(Number);
const RANGES = { 1: [1, 151], 2: [152, 251], 3: [252, 386], 4: [387, 493], 5: [494, 649], 6: [650, 721], 7: [722, 809], 8: [810, 905], 9: [906, 1025] };

const periods = [];
for (let g = g0; g <= (g1 ?? g0); g++) {
  const [a, b] = RANGES[g];
  for (let id = a; id <= b; id++) {
    const anim = await loadAnimatedSprite(id, "normal");
    if (anim && anim.gif.numFrames() > 1) periods.push({ id, p: loopPlan(anim).period, plan: loopPlan(anim).how });
  }
}
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (n) => Array.from({ length: n }, () => periods[Math.floor(rand() * periods.length)]);

const pctl = (a, q) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))] : 0);
const rate = (groups, trainerClock, singleCapMs) => {
  let seams = 0, total = 0, teamsWithSeam = 0;
  const pauses = [], pauseShare = [];
  let noWholeCycle = 0;
  for (const g of groups) {
    const { L, fit } = fitLoop(g.map((x) => x.p), { trainerClock, singleCapMs });
    fit.forEach((f, i) => {
      if (f) return;
      const k = Math.floor(L / g[i].p);
      if (k < 1) { noWholeCycle++; return; }
      const pause = L - k * g[i].p;
      pauses.push(pause); pauseShare.push(pause / L);
    });
    const s = fit.filter((f) => !f).length;
    seams += s; total += g.length; if (s) teamsWithSeam++;
  }
  return { seams, total, pct: +((100 * seams) / total).toFixed(1), groupsWithSeam: +((100 * teamsWithSeam) / groups.length).toFixed(1),
    pauseMedian: Math.round(pctl(pauses, 0.5)), pauseP90: Math.round(pctl(pauses, 0.9)), pauseShareMedian: Math.round(100 * pctl(pauseShare, 0.5)), noWholeCycle };
};

// What-ifs with fitLoop's own rule (whole cycles within ±NUDGE, fewest
// seams), varying the longest loop allowed. `cap`: longest L; with the 2.4 s
// clock, L is a multiple of 2.4 s up to `cap`. Also the pause left if an
// unfit sprite plays whole cycles slowed by up to 15%, then holds frame 0.
function whatIf(groups, trainerClock, cap) {
  let seams = 0, total = 0, frames = 0;
  const pauses = [];
  for (const g of groups) {
    const ps = g.map((x) => x.p);
    const cands = [];
    if (trainerClock) for (let L = 2400; L <= cap; L += 2400) cands.push(L);
    else if (ps.length === 1) cands.push(Math.max(50, Math.round(ps[0] / 50) * 50));
    else for (let L = 2000; L <= cap; L += 100) cands.push(L);
    let best = null;
    for (const L of cands) {
      const fit = ps.map((p) => { const k = Math.max(1, Math.round(L / p)), sc = L / (k * p); return Math.abs(sc - 1) <= 0.15 + 1e-9; });
      const n = fit.filter((f) => !f).length;
      if (!best || n < best.n) best = { L, fit, n };
    }
    seams += best.n; total += ps.length; frames += best.L / 50;
    best.fit.forEach((f, i) => { if (!f) { const k = Math.floor(best.L / (ps[i] * 0.85)); pauses.push(k >= 1 ? Math.max(0, best.L - k * ps[i] * 1.15) : best.L); } });
  }
  return { jump: `${((100 * seams) / total).toFixed(1)}%`, "avg frames": Math.round(frames / groups.length), "hold+stretch median pause": `${Math.round(pctl(pauses, 0.5))} ms`, "p90 pause": `${Math.round(pctl(pauses, 0.9))} ms` };
}

const singles = periods.map((x) => [x]);
const rows = {
  "1 sprite (normal catch/Pokédex/inspect)": rate(singles, false),
  "1 sprite + 2.4 s clock (shiny), battle cap 7.2 s": rate(singles, true),
  "1 sprite + 2.4 s clock (shiny), card cap 12 s": rate(singles, true, SINGLE_CLOCK_CAP_MS),
  "6 sprites, no clock": rate(Array.from({ length: TEAMS }, () => pick(6)), false),
  "6 sprites + clock (trainer/ranked card, /showcase w/ shiny)": rate(Array.from({ length: TEAMS }, () => pick(6)), true),
  "12 sprites + clock (VS card, battle start/result)": rate(Array.from({ length: TEAMS }, () => pick(12)), true),
};
console.log(`${periods.length} animated sprites, Gens ${g0}–${g1 ?? g0}; ${TEAMS} random teams per team case`);
console.table(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { "sprites that jump": `${v.pct}%`, "cards with any jump": `${v.groupsWithSeam}%`, "hold: median pause": `${v.pauseMedian} ms`, "hold: p90 pause": `${v.pauseP90} ms`, "pause % of loop": `${v.pauseShareMedian}%`, "can't fit 1 cycle": v.noWholeCycle }])));
const six = Array.from({ length: TEAMS }, () => pick(6)), twelve = Array.from({ length: TEAMS }, () => pick(12));
for (const cap of [8000, 12000, 16000]) {
  console.log(`What if the longest loop were ${cap / 1000} s (${cap === 8000 ? "today" : "what-if"}):`);
  console.table({
    "1 shiny sprite + clock": whatIf(singles, true, cap),
    "6 sprites, no clock": whatIf(six, false, cap),
    "6 sprites + clock": whatIf(six, true, cap),
    "12 sprites + clock": whatIf(twelve, true, cap),
  });
}
const hows = {};
for (const x of periods) hows[x.plan.replace(/[\d.]+/g, "N")] = (hows[x.plan.replace(/[\d.]+/g, "N")] ?? 0) + 1;
console.log("loop plans:", JSON.stringify(hows));
