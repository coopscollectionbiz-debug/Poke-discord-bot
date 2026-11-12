// Builds POKEMON-TIER-REVIEW.html (worktree root) from the locked re-tier decisions.
// Usage: node docs/audits/pokemon-tiers/build-review.mjs
// Inputs: pokemonData.json + data/pokedex/tier-overrides.json, battleData.json (base stats),
//         source-catalog-2026-11-09.csv (status, stage, owners; Nov 9 snapshot seq 604).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { POKEMON_RARITY_WEIGHTS } from "../../../utils/weightedRandom.js";
import { EVOLVE_STONE_COST } from "../../../services/gameplay.js";
import { DONATION_CC_BY_TIER } from "../../../utils/economyRules.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../../..");
const L = require("./load.cjs")();
const B = require(path.join(root, "battleData.json")).species;
const T = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const D = {};
for (const p of L) { p.b = Object.values(B[p.id].baseStats).reduce((a, c) => a + c, 0); D[p.id] = p; }

// ---- Locked decisions: data/pokedex/tier-overrides.json (single source; the
// generator applies it). pokemonData.json already holds the new tiers, so
// "today" is each override's `from`.
const OVERRIDES = require(path.join(root, "data/pokedex/tier-overrides.json")).overrides;
const after = {};
const why = {};
for (const [id, o] of Object.entries(OVERRIDES)) {
  after[id] = o.tier; why[id] = { d: o.decision, w: o.reason };
  D[id].tier = o.from; // back to today's tier for the before/after view
}
const tierAfter = (p) => after[p.id] ?? p.tier;
const ti = (t) => T.indexOf(t);

// ---- Checks: evolutions never go down a tier; every evolve pair has a Stone cost ----
const problems = [];
const stoneChanges = [];
for (const p of L) {
  for (const to of p.evolvesTo) {
    const q = D[to];
    const a0 = p.tier, b0 = q.tier, a1 = tierAfter(p), b1 = tierAfter(q);
    if (ti(b1) < ti(a1)) problems.push(`${p.name} ${a1} → ${q.name} ${b1} goes down`);
    if (!EVOLVE_STONE_COST[`${a1}-${b1}`]) problems.push(`${p.name} → ${q.name}: no Stone cost for ${a1}-${b1}`);
    const c0 = EVOLVE_STONE_COST[`${a0}-${b0}`], c1 = EVOLVE_STONE_COST[`${a1}-${b1}`];
    if (c0 !== c1) stoneChanges.push({ from: p.name, to: q.name, live: q.generation <= 5, before: `${a0}→${b0}`, after: `${a1}→${b1}`, c0, c1 });
  }
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

// ---- Rows ----
const ROWS = L.map((p) => {
  const ta = tierAfter(p);
  return {
    id: p.id, n: p.name, g: p.generation, live: p.generation <= 5, s: p.status, st: p.stage,
    b: p.b, tb: p.tier, ta, d: ti(ta) - ti(p.tier), o: p.owners, c: p.copies,
    dec: why[p.id]?.d ?? "", why: why[p.id]?.w ?? "",
  };
});

// ---- Summary ----
const count = (list, key) => Object.fromEntries(T.map((t) => [t, list.filter((r) => r[key] === t).length]));
const live = ROWS.filter((r) => r.live);
const share = (list, key) => {
  const w = Object.fromEntries(T.map((t) => [t, list.filter((r) => r[key] === t).length * POKEMON_RARITY_WEIGHTS[t]]));
  const tot = Object.values(w).reduce((a, c) => a + c, 0);
  return Object.fromEntries(T.map((t) => [t, { pct: (100 * w[t]) / tot, oneIn: Math.round(tot / POKEMON_RARITY_WEIGHTS[t]) }]));
};
const q = (a, f) => a[Math.floor((a.length - 1) * f)];
const bands = (key) => Object.fromEntries(T.map((t) => {
  const a = ROWS.filter((r) => r[key] === t).map((r) => r.b).sort((x, y) => x - y);
  return [t, { n: a.length, min: a[0], p10: q(a, 0.1), med: q(a, 0.5), p90: q(a, 0.9), max: a[a.length - 1] }];
}));
const moved = ROWS.filter((r) => r.d);
const MATRIX = {};
for (const r of ROWS) { (MATRIX[r.tb] ??= {})[r.ta] = ((MATRIX[r.tb] ??= {})[r.ta] || 0) + 1; }
const SUMMARY = {
  species: ROWS.length,
  up: moved.filter((r) => r.d > 0).length,
  down: moved.filter((r) => r.d < 0).length,
  same: ROWS.length - moved.length,
  liveMoved: moved.filter((r) => r.live).length,
  ownedRecords: moved.reduce((a, r) => a + r.o, 0),
  ownedCopies: moved.reduce((a, r) => a + r.c, 0),
  donationDelta: moved.reduce((a, r) => a + r.c * (DONATION_CC_BY_TIER[r.ta] - DONATION_CC_BY_TIER[r.tb]), 0),
  mythicBefore: ROWS.filter((r) => r.tb === "mythic").length,
  mythicAfter: ROWS.filter((r) => r.ta === "mythic").length,
  before: count(ROWS, "tb"), after: count(ROWS, "ta"),
  liveBefore: count(live, "tb"), liveAfter: count(live, "ta"),
  shareBefore: share(live, "tb"), shareAfter: share(live, "ta"),
  bandsBefore: bands("tb"), bandsAfter: bands("ta"),
  stoneChanges,
  pureBstMoves: (() => { // how many would move if tiers followed BST rank alone (D1 rejected option)
    const cnt = count(ROWS, "tb"); const s = [...ROWS].sort((a, c) => a.b - c.b); let i = 0; const pt = {};
    for (const t of T) for (let k = 0; k < cnt[t]; k++) pt[s[i++].id] = t;
    return ROWS.filter((r) => pt[r.id] !== r.tb).length;
  })(),
};

const tpl = fs.readFileSync(path.join(here, "review-template.html"), "utf8");
const html = tpl
  .replace("/*ROWS*/", `const ROWS=${JSON.stringify(ROWS)};`)
  .replace("/*SUMMARY*/", `const SUMMARY=${JSON.stringify(SUMMARY)};const MATRIX=${JSON.stringify(MATRIX)};`);
const out = path.join(root, "POKEMON-TIER-REVIEW.html");
fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(JSON.stringify({ ...SUMMARY, stoneChanges: stoneChanges.length, bandsBefore: undefined, bandsAfter: undefined }, null, 1));
