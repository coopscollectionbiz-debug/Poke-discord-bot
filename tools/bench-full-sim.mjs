// ==========================================================
// tools/bench-full-sim.mjs — cost of a full-sim fight with the Battle-plan
// AI, and how often Expert beats Solid (full-sim spec, "Measured").
//
// Usage: node tools/bench-full-sim.mjs [battles=300]
// Teams: 6 Pokémon at Lv 50 drawn (seeded) from a fixed pool of 12 with
// four moves each, status moves included, All-out attack on both sides.
// Run it on the VPS too: its CPU is shared with other services.
// ==========================================================

import { simulateFull } from "../utils/battle/showdown/simulate.js";
import { makeChooser } from "../utils/battle/ai/choose.js";
import { createRng } from "../utils/battle/rng.js";

const N = Number(process.argv[2] ?? 300);
const POOL = [
  [6, ["flamethrower", "airslash", "dragonpulse", "roost"]], [9, ["surf", "icebeam", "flashcannon", "rapidspin"]],
  [3, ["energyball", "sludgebomb", "sleeppowder", "synthesis"]], [25, ["thunderbolt", "grassknot", "thunderwave", "quickattack"]],
  [143, ["bodyslam", "earthquake", "crunch", "rest"]], [94, ["shadowball", "sludgebomb", "willowisp", "hypnosis"]],
  [68, ["closecombat", "knockoff", "stoneedge", "bulkup"]], [149, ["dragonclaw", "earthquake", "dragondance", "extremespeed"]],
  [130, ["waterfall", "earthquake", "dragondance", "crunch"]], [248, ["stoneedge", "crunch", "earthquake", "stealthrock"]],
  [445, ["earthquake", "dragonclaw", "swordsdance", "stealthrock"]], [282, ["psychic", "moonblast", "calmmind", "thunderbolt"]],
];
const rng = createRng(7);
const team = () => Array.from({ length: 6 }, () => POOL[rng.int(POOL.length)]).map(([speciesId, moves]) => ({ speciesId, variant: "normal", level: 50, moves }));
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

function run(label, skills) {
  const ms = [], turns = [];
  let wins0 = 0;
  for (let n = 0; n < N; n++) {
    const sides = [team(), team()].map((members) => ({ members }));
    const ai = skills.map((skill, i) => makeChooser({ plan: "allout", skill, seed: n * 2 + i }));
    const t = performance.now();
    const r = simulateFull({ sides, seed: 5000 + n, ai });
    ms.push(performance.now() - t);
    turns.push(r.turns);
    if (r.winner === 0) wins0++;
  }
  console.log(`${label}: ms p50 ${pct(ms, 0.5).toFixed(1)} p99 ${pct(ms, 0.99).toFixed(1)} max ${Math.max(...ms).toFixed(1)} · turns p50 ${pct(turns, 0.5)} p99 ${pct(turns, 0.99)} · side 0 won ${wins0}/${N}`);
}

// Win share of `a` against `b`, each pair of Teams fought twice with seats swapped.
function share(label, a, b) {
  let wins = 0;
  for (let n = 0; n < N; n++) {
    const sides = [team(), team()].map((members) => ({ members }));
    for (const seat of [0, 1]) {
      const ai = [0, 1].map((i) => makeChooser({ plan: "allout", seed: n * 4 + i + seat * 2, ...(i === seat ? a : b) }));
      if (simulateFull({ sides, seed: 9000 + n, ai }).winner === seat) wins++;
    }
  }
  console.log(`${label}: ${wins}/${2 * N} = ${((100 * wins) / (2 * N)).toFixed(1)}%`);
}

run("solid vs solid", ["solid", "solid"]);
run("expert vs solid", ["expert", "solid"]);
share("rookie vs solid", { skill: "rookie" }, { skill: "solid" });
share("solid without slip vs solid", { skill: "solid", slip: 0 }, { skill: "solid" });
share("expert vs solid", { skill: "expert" }, { skill: "solid" });
console.log(`RSS ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MB`);
