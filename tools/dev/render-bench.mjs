// ==========================================================
// tools/dev/render-bench.mjs — Discord image render time and memory (M3).
//
//   node --expose-gc tools/dev/render-bench.mjs <engineRoot> <plain|mega> [rounds]
//
// plain: a six-Pokémon Team without Megas (any engine, flags off)
// mega:  the same Team with Mega Charizard X in slot 1 (Mega engines only,
//        Mega flags on for this process only)
// Times /showteam (PNG and GIF), the trainer card, the inspect card, the
// EXP card and one battle frame (GIF), after one warm-up round. Prints one
// JSON line: median ms per surface, peak RSS/heap, heap after GC.
// ==========================================================

import path from "path";
import { pathToFileURL } from "url";

const [rootArg, kind = "plain", roundsArg = "8"] = process.argv.slice(2);
const root = path.resolve(rootArg);
const rounds = Number(roundsArg);
for (const k of Object.keys(process.env)) if (k.startsWith("MEGA_")) delete process.env[k];
if (kind === "mega") Object.assign(process.env, { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" });
console.warn = () => {};
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { createNewUser } = await imp("utils/userSchema.js");
const { buildTeamView } = await imp("utils/render/teamView.js");
const { renderShowteam } = await imp("utils/render/showteam.js");
const { renderInspectCard } = await imp("utils/render/inspectCard.js");
const { trainerCardView, renderTrainerCard } = await imp("utils/render/trainerCard.js");
const { expView, renderExpCard } = await imp("utils/render/expCard.js");
const { renderBattleFrame } = await imp("utils/battle/render.js");
const { runBattle } = await imp("utils/battle/runBattle.js");

function player(id, team, mega) {
  const u = createNewUser(id, id);
  u.training = {};
  u.megaUnlocks = {};
  for (const [s, v, level] of team) {
    u.pokemon[s] ??= { normal: 0, shiny: 0 };
    u.pokemon[s][v] += 1;
    u.training[`${s}:${v}`] = { exp: level ** 3 };
  }
  u.displayedPokemon = team.map(([s, v]) => ({ id: s, variant: v }));
  if (mega) {
    u.megaUnlocks["6:normal"] = { forms: { [mega]: { at: 1, stone: null } }, preferred: null };
    u.displayedPokemon[0].mega = mega;
  }
  return u;
}
const A = player("A", [[6, "normal", 60], [25, "normal", 40], [150, "normal", 70], [9, "normal", 52], [143, "normal", 48], [94, "normal", 50]], kind === "mega" ? "mega-charizard-x" : null);
const B = player("B", [[18, "normal", 50], [65, "normal", 53], [112, "normal", 49], [130, "shiny", 51]]);
const out = runBattle({ trainerData: { A, B }, challengerId: "A", defenderId: "B", mode: "open", seed: 5, now: new Date(Date.UTC(2026, 10, 10)) });
const sides = out.sides.map((s) => ({ name: s.userId, members: s.members }));

const surfaces = {
  showteamPng: () => renderShowteam(buildTeamView(A, { displayName: "A" }), { layout: "refined" }),
  showteamGif: () => renderShowteam(buildTeamView(A, { displayName: "A" }), { layout: "refined", animate: true }),
  trainerCard: () => renderTrainerCard(trainerCardView(A, { displayName: "A", trainer: null })),
  inspectCard: () => renderInspectCard(buildTeamView(A, { displayName: "A" }).slots[0], { owner: "A" }),
  expCard: () => renderExpCard(expView(out, "A", { A: "A", B: "B" }, A)),
  battleFrame: () => renderBattleFrame({ sides, hpBefore: out.result.snapshots[0], screens: [["The battle begins!", ""]] }),
};
let peakRss = 0, peakHeap = 0;
const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); };
for (const f of Object.values(surfaces)) await f(); // warm-up: fonts, sprite caches
global.gc?.();
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = {};
for (const [name, f] of Object.entries(surfaces)) {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    await f();
    times.push(performance.now() - t0);
    sample();
  }
  ms[name] = +median(times).toFixed(1);
}
global.gc?.();
console.log(JSON.stringify({ engine: path.basename(root), kind, rounds, medianMs: ms, peakRssMB: +(peakRss / 2 ** 20).toFixed(0), peakHeapMB: +(peakHeap / 2 ** 20).toFixed(0), heapAfterGcMB: +(process.memoryUsage().heapUsed / 2 ** 20).toFixed(1), slot1: sides[0].members[0].name }));
