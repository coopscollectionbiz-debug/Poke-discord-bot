// ==========================================================
// tools/dev/battle-bench.mjs — battle throughput and memory (Mega M2).
//
//   node tools/dev/battle-bench.mjs <engineRoot> <plain|mega> [count]
//
// plain: the deterministic no-Mega corpus (tools/dev/battle-corpus.mjs)
// mega:  battles where both sides field a battle-eligible Mega (only for
//        engines that support it), Mega flags enabled for this process only
// Prints one JSON line: battles, total ms, ms/battle, battles/s, peak RSS
// and heap (MB, sampled every 25 battles), and the heap after a full GC
// pass (when run with --expose-gc).
// ==========================================================

import path from "path";
import { pathToFileURL } from "url";
import { corpusCases } from "./battle-corpus.mjs";

const [rootArg, kind = "plain", countArg = "3000"] = process.argv.slice(2);
const root = path.resolve(rootArg);
const count = Number(countArg);
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const env = kind === "mega" ? { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" } : {};
Object.assign(process.env, env);
console.warn = () => {};

const { runBattle } = await imp("utils/battle/runBattle.js");
const { createNewUser } = await imp("utils/userSchema.js");
const now = new Date(Date.UTC(2026, 10, 10, 12));
const MEGAS = kind === "mega" ? (await imp("data/pokedex/megas.json").catch(() => null)) : null;
let eligible = [];
if (kind === "mega") {
  const { megaBattleEligibility, allMegas } = await imp("utils/megas.js");
  eligible = allMegas().filter((f) => megaBattleEligibility(f.id, { env }).battleReady);
}
void MEGAS;

function user(id, team, mega) {
  const u = createNewUser(id, id);
  u.training = {};
  for (const m of team) { u.pokemon[m.id] ??= { normal: 0, shiny: 0 }; u.pokemon[m.id][m.variant] += 1; u.training[`${m.id}:${m.variant}`] ??= { exp: m.level ** 3 }; }
  u.displayedPokemon = team.map((m) => ({ id: m.id, variant: m.variant }));
  if (mega) {
    team.unshift({ id: mega.species, variant: "normal", level: 60 });
    u.pokemon[mega.species] ??= { normal: 0, shiny: 0 };
    u.pokemon[mega.species].normal += 1;
    u.training[`${mega.species}:normal`] = { exp: 60 ** 3 };
    u.displayedPokemon = [{ id: mega.species, variant: "normal", mega: mega.id }, ...u.displayedPokemon.filter((s) => !(s.id === mega.species && s.variant === "normal"))].slice(0, 6);
    u.megaUnlocks = { [`${mega.species}:normal`]: { forms: { [mega.id]: { at: 1, stone: null } }, preferred: null } };
  }
  return u;
}

const cases = corpusCases(count, kind === "mega" ? 777 : 20261110);
let peakRss = 0, peakHeap = 0;
const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); };
global.gc?.();
sample();
const t0 = performance.now();
for (const [i, c] of cases.entries()) {
  const ma = kind === "mega" ? eligible[i % eligible.length] : null;
  const mb = kind === "mega" ? eligible[(i * 7 + 3) % eligible.length] : null;
  const td = { A: user("A", c.a, ma), B: user("B", c.b, mb) };
  runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: c.seed, now, env });
  if (i % 25 === 0) sample();
}
const ms = performance.now() - t0;
sample();
global.gc?.();
const after = process.memoryUsage().heapUsed;
console.log(JSON.stringify({
  engine: path.basename(root), kind, battles: count, totalMs: Math.round(ms), msPerBattle: +(ms / count).toFixed(3), battlesPerSec: Math.round(count / (ms / 1000)),
  peakRssMB: +(peakRss / 2 ** 20).toFixed(1), peakHeapMB: +(peakHeap / 2 ** 20).toFixed(1), heapAfterGcMB: +(after / 2 ** 20).toFixed(1),
}));
