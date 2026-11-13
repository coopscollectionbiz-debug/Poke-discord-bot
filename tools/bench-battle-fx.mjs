// ==========================================================
// tools/bench-battle-fx.mjs — the Battle FX open checks (spec,
// docs/superpowers/specs/2026-11-13-battle-fx-design.md, "Open checks").
//
// Usage: FULL_SIM_ENABLED=1 node tools/bench-battle-fx.mjs [fights=40] [eliteFourRuns=5]
// Seeded full-sim fights with both sides on Status & stall, then on Set up
// & sweep (6 Pokémon at Lv 50 from a fixed pool), plus Elite Four runs
// (a Lv 60 Team on Status & stall). Every shown turn image (up to
// FULL_SIM.maxUpdates per fight) is rendered on the render threads
// (RENDER_THREADS, 3 by default) with BATTLE_FX on and off. Reports, on vs
// off: beat time per image (the cap is its p95), the largest turn GIF
// against MAX_GIF_BYTES, render time per image, the images whose GIF would
// run out of regular frames before the next one lands (it would loop back),
// and replay length per fight and for the worst Elite Four fight.
// Run it on the VPS too: its CPU is shared with other services.
// ==========================================================

import { loadFullSim, simulateBattle } from "../utils/battle/sim.js";
import { turnTimeline, FX, ANIMATION } from "../utils/battle/timeline.js";
import { pickFrameTurns } from "../utils/battle/render.js";
import { threaded } from "../utils/render/renderers.js";
import { renderThreadCount } from "../utils/render/renderPool.js";
import { MAX_GIF_BYTES } from "../utils/render/spriteLoops.js";
import { createRng } from "../utils/battle/rng.js";
import { FULL_SIM, PLAYBACK } from "../utils/battle/tuning.js";
import { simulateChallenge } from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";

const N = Number(process.argv[2] ?? 40);
const RUNS = Number(process.argv[3] ?? 5);
const POOL = [
  [94, "Gengar", ["shadowball", "willowisp", "hypnosis", "confuseray"]], [3, "Venusaur", ["energyball", "leechseed", "toxic", "sleeppowder"]],
  [25, "Pikachu", ["thunderbolt", "thunderwave", "quickattack", "irontail"]], [91, "Cloyster", ["shellsmash", "iciclespear", "rockblast", "icebeam"]],
  [212, "Scizor", ["swordsdance", "uturn", "bulletpunch", "batonpass"]], [110, "Weezing", ["haze", "sludgebomb", "willowisp", "toxicspikes"]],
  [130, "Gyarados", ["dragondance", "waterfall", "earthquake", "thunderwave"]], [143, "Snorlax", ["bodyslam", "rest", "curse", "earthquake"]],
  [407, "Roserade", ["toxicspikes", "sludgebomb", "gigadrain", "sleeppowder"]], [227, "Skarmory", ["spikes", "whirlwind", "roost", "bravebird"]],
  [282, "Gardevoir", ["psychic", "moonblast", "calmmind", "thunderwave"]], [248, "Tyranitar", ["stealthrock", "crunch", "stoneedge", "dragondance"]],
];
const mon = ([speciesId, name, moves], level) => ({ speciesId, variant: "normal", name, level, moves });
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
const ON = { ...process.env, BATTLE_FX: "1" };
const OFF = { ...process.env, BATTLE_FX: "0" };

await loadFullSim();
const stats = { on: { beatMs: [], bytes: [], renderMs: [], loops: 0, pairs: 0, replayMs: [] }, off: { beatMs: [], bytes: [], renderMs: [], loops: 0, pairs: 0, replayMs: [] } };
let worstRun = { on: 0, off: 0 };

// One fight's replay, both ways: every shown turn image rendered, and the
// replay's length from the first post to the result image.
async function replay(result, sides) {
  const names = sides.map((s) => s.members.map((m) => m.name));
  const turns = result.turns ? pickFrameTurns(result.turns, FULL_SIM.maxUpdates) : [];
  const length = {};
  for (const [mode, env] of [["on", ON], ["off", OFF]]) {
    const s = stats[mode];
    const shown = [];
    for (const turn of turns) {
      const tl = turnTimeline(result, turn, names, { env });
      const started = performance.now();
      const gif = await threaded.battleFrame({ sides, hpBefore: result.snapshots[turn - 1], timeline: tl, badge: `TURN ${turn}`, env });
      const ms = performance.now() - started;
      s.renderMs.push(ms);
      s.bytes.push(gif.length);
      s.beatMs.push(tl.segments.filter((x) => x.kind === "beat").reduce((t, x) => t + x.frames, 0) * ANIMATION.delayMs);
      shown.push({ tl, ms });
    }
    // Image k stays up until image k+1 lands: its wait, or k+1's render if that's longer.
    let total = PLAYBACK.delayMs; // the start image's hold
    shown.forEach((img, k) => {
      const next = k + 1 < shown.length ? shown[k + 1].ms : 0; // the result image's render isn't measured
      const up = Math.max(img.tl.waitMs, next);
      total += up;
      s.pairs++;
      if (up > img.tl.minFrames * ANIMATION.delayMs) s.loops++;
    });
    s.replayMs.push(total);
    length[mode] = total;
  }
  return length;
}

for (const plan of ["status", "setup"]) {
  for (let n = 0; n < N; n++) {
    const rng = createRng(7000 + (plan === "status" ? 0 : 500) + n);
    const team = () => Array.from({ length: 6 }, () => mon(POOL[rng.int(POOL.length)], 50));
    const sides = [{ name: "Ash", members: team(), plan }, { name: "Gary", members: team(), plan }];
    const result = simulateBattle({ sides: sides.map((s) => ({ members: s.members, plan })), seed: 9000 + n, surge: null, engine: "full" });
    await replay(result, sides);
  }
  process.stdout.write(`${plan}: ${N} fights\n`);
}
for (let n = 0; n < RUNS; n++) {
  const rng = createRng(8100 + n);
  const team = Array.from({ length: 6 }, () => mon(POOL[rng.int(POOL.length)], 60));
  const run = simulateChallenge({ team, opponents: CHALLENGES.elite4.opponents, seed: 8200 + n, plan: "status", engine: "full" });
  for (const f of run.fights) {
    const len = await replay(f.result, [{ name: "Ash", members: f.members }, { name: "Elite Four", members: f.foes }]);
    worstRun = { on: Math.max(worstRun.on, len.on), off: Math.max(worstRun.off, len.off) };
  }
}
process.stdout.write(`Elite Four: ${RUNS} runs\n\n`);

const row = (label, f) => console.log(`${label.padEnd(44)} ${f("on").padStart(28)} ${f("off").padStart(28)}`);
const three = (xs, unit = "ms", k = 1) => `${Math.round(pct(xs, 0.5) / k)} / ${Math.round(pct(xs, 0.95) / k)} / ${Math.round(Math.max(0, ...xs) / k)} ${unit}`;
console.log(`machine: ${process.platform} ${process.arch}, node ${process.version}, render threads ${renderThreadCount()}, cap now ${FX.capFrames}`);
row("", (m) => (m === "on" ? "BATTLE_FX on" : "BATTLE_FX=0"));
row("beat time per image (p50 / p95 / max)", (m) => three(stats[m].beatMs));
row("beat frames per image, p95 (the cap)", (m) => `${Math.ceil(pct(stats[m].beatMs, 0.95) / ANIMATION.delayMs)} frames`);
row("largest turn GIF", (m) => `${(Math.max(...stats[m].bytes) / 1024).toFixed(0)} KB of ${(MAX_GIF_BYTES / 1024 / 1024).toFixed(0)} MB`);
row("render per turn image (p50 / p95 / max)", (m) => three(stats[m].renderMs));
row("images that would loop back (of all)", (m) => `${stats[m].loops} of ${stats[m].pairs}`);
row("replay per fight (p50 / p95 / max)", (m) => three(stats[m].replayMs, "s", 1000));
row("worst Elite Four fight", (m) => `${(worstRun[m] / 1000).toFixed(1)} s`);
process.exit(0);
