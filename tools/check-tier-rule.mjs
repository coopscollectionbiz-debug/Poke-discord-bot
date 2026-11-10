// ==========================================================
// tools/check-tier-rule.mjs — measures how closely the Gen 6+ tier rule
// (tools/lib/tierRules.mjs) reproduces the hand-assigned Gen 1–5 tiers.
// Build-time only. Run: node tools/check-tier-rule.mjs
// ==========================================================

import fs from "fs";
import { classifyTier, TIER_ORDER } from "./lib/tierRules.mjs";
import { readCsv } from "./lib/csv.mjs";
import { POKEAPI_CACHE } from "./lib/paths.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../data/pokedex/gen1-5-baseline.json", import.meta.url), "utf8"));
const battle = JSON.parse(fs.readFileSync(new URL("../battleData.json", import.meta.url), "utf8")).species;
const sp = new Map(readCsv(new URL("pokemon_species.csv", POKEAPI_CACHE)).map((r) => [Number(r.id), r]));
const STARTERS = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501];
const FOSSILS = [138, 140, 345, 347, 408, 410, 564, 566];
const root = (n) => { let r = n; while (base[r].evolvesFrom?.[0]) r = base[r].evolvesFrom[0]; return r; };
const bst = (n) => Object.values(battle[n].baseStats).reduce((a, c) => a + c, 0);
const pseudo = (n) => {
  const finals = [];
  const walk = (x, d) => { if (!base[x].evolvesTo?.length) finals.push([x, d]); for (const t of base[x].evolvesTo || []) walk(t, d + 1); };
  walk(root(n), 1);
  return finals.some(([x, d]) => d === 3 && bst(x) === 600 && sp.get(x).is_legendary !== "1");
};

let exact = 0, near = 0;
const confusion = {}, dist = {};
for (let n = 1; n <= 649; n++) {
  const s = sp.get(n);
  const tags = [];
  if (s.is_legendary === "1") tags.push("legendary");
  if (s.is_mythical === "1") tags.push("mythical");
  if (s.is_baby === "1") tags.push("baby");
  const t = classifyTier({ bst: bst(n), capture: Number(s.capture_rate), tags, hasPre: (base[n].evolvesFrom || []).length > 0,
    hasEvo: (base[n].evolvesTo || []).length > 0, starter: STARTERS.includes(root(n)), pseudo: pseudo(n), fossil: FOSSILS.includes(n) });
  dist[t] = (dist[t] || 0) + 1;
  if (t === base[n].tier) exact++;
  else {
    if (Math.abs(TIER_ORDER.indexOf(t) - TIER_ORDER.indexOf(base[n].tier)) === 1) near++;
    const k = `${base[n].tier}→${t}`;
    confusion[k] = (confusion[k] || 0) + 1;
  }
}
const pct = (x) => `${((100 * x) / 649).toFixed(1)}%`;
console.log(JSON.stringify({ exact, exactPct: pct(exact), withinOneTier: exact + near, withinOnePct: pct(exact + near), ruleDistribution: dist, mismatches: confusion }, null, 1));
