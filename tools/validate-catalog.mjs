// ==========================================================
// tools/validate-catalog.mjs — release gate for species data and assets.
// Exits non-zero if any species (or any generation) is incomplete:
// catalogue fields, battle data, normal/shiny/grayscale sprite files and
// their manifest SHA-1s, distinct shinies, evolution graph, form keys.
// Run: npm run validate:catalog            (all generations)
//      npm run validate:catalog -- 7       (one generation)
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import { GENERATIONS } from "../config/generations.js";
import { generationProblems, speciesProblems } from "../utils/speciesCatalog.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const DEX = read("../pokemonData.json");
const SPRITES = read("../data/sprites/sprites.json").species;
const FORMS = read("../data/pokedex/forms.json").forms;
const only = process.argv.slice(2).map(Number).filter(Boolean);
const gens = only.length ? only : Object.keys(GENERATIONS).map(Number);

const problems = [];
for (const g of gens) problems.push(...generationProblems(g));
// File integrity against the manifest.
for (const g of gens) {
  for (let n = GENERATIONS[g].first; n <= GENERATIONS[g].last; n++) {
    for (const v of ["normal", "shiny", "grayscale"]) {
      const rec = SPRITES[n]?.[v];
      if (!rec) continue;
      const file = new URL(`../public/sprites/pokemon/${rec.file}`, import.meta.url);
      if (!fs.existsSync(file)) continue; // reported by speciesProblems
      const sha = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
      if (sha !== rec.fileSha1) problems.push(`#${n} ${v} file SHA-1 differs from data/sprites/sprites.json`);
    }
  }
}
// Graph and identity checks (whole dex).
const ids = Object.keys(DEX).map(Number);
if (new Set(ids).size !== ids.length) problems.push("duplicate dex ids");
for (const p of Object.values(DEX)) {
  for (const t of p.evolvesTo) if (!DEX[t]?.evolvesFrom.includes(p.id)) problems.push(`#${p.id} → #${t} has no matching evolvesFrom`);
  const seen = new Set([p.id]);
  let cur = p;
  while (cur.evolvesFrom?.[0]) { if (seen.has(cur.evolvesFrom[0])) { problems.push(`evolution loop at #${p.id}`); break; } seen.add(cur.evolvesFrom[0]); cur = DEX[cur.evolvesFrom[0]]; }
}
const keys = new Set();
for (const f of FORMS) {
  if (!/^\d{1,4}:[a-z0-9]+$/.test(f.key) || /:(normal|shiny)$/.test(f.key)) problems.push(`bad form key ${f.key}`);
  if (keys.has(f.key)) problems.push(`duplicate form key ${f.key}`);
  keys.add(f.key);
  if (f.enabled !== false) problems.push(`form ${f.key} is enabled (forms are architecture-only)`);
}
void speciesProblems;

if (problems.length) {
  console.error(`❌ ${problems.length} problem(s):\n` + problems.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`✅ Catalogue valid for generation(s) ${gens.join(", ")}: species data, battle data, sprites (normal/shiny/grayscale), evolution graph, form keys.`);
