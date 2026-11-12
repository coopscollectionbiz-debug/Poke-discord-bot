// ==========================================================
// tests/gen69Balance.test.js — the exact encounter model behind
// docs/gen6-9/GEN7-ENCOUNTER-COMPARISON.md (tools/lib/encounterModel.mjs)
// matches the live selector (utils/weightedRandom.js), checked by
// sampling with the real code, before and after releasing Gen 7.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

delete process.env.POKEMON_GENERATIONS;
const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const { selectRandomPokemonForUser } = await import("../utils/weightedRandom.js");
const { getAllPokemon } = await import("../utils/dataLoader.js");
const { TIERS, weightedOdds } = await import("../tools/lib/encounterModel.mjs");
const enable = (list) => { G.setGenerationsForTesting(list); C.resetCatalogCachesForTesting(); };
const all = await getAllPokemon();

// Deterministic PRNG so the test is reproducible.
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function sample(user, ball, n, seed) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0]));
  let alola = 0;
  try {
    for (let i = 0; i < n; i++) { const p = selectRandomPokemonForUser(all, user, ball); counts[p.tier]++; if (p.generation === 7) alola++; }
  } finally { Math.random = real; }
  return { counts, alola };
}

function check(label, gens, user, ball, rank, n = 120_000) {
  enable(gens);
  const pool = all.filter((p) => C.isAcquirable(p.id));
  const model = weightedOdds(pool, { rank, ball });
  const { counts, alola } = sample(user, ball, n, 12345);
  let ok = true;
  for (const t of TIERS) {
    const pexp = model.tierShare[t];
    const sd = Math.sqrt(n * pexp * (1 - pexp)) || 1;
    if (Math.abs(counts[t] - n * pexp) > 4.5 * sd) ok = false;
  }
  assertTrue(ok, `${label}: sampled tier shares match the exact model within 4.5σ (${n.toLocaleString("en-US")} real draws)`);
  return { model, alola, n };
}

section("Model = live selector");
check("Gens 1–5, Poké Ball, no rank", [], { tp: 0 }, "pokeball", null);
const g7 = check("Gen 7 live, Poké Ball, no rank", [7], { tp: 0 }, "pokeball", null);
check("Gen 7 live, Ultra Ball, Legend", [7], { tp: 250_000 }, "ultraball", "Legend");
check("Gen 7 live, Great Ball, Master Trainer", [7], { tp: 25_000 }, "greatball", "Master Trainer");
const alolaModel = TIERS.reduce((s, t) => s + g7.model.perSpecies[t] * all.filter((p) => p.generation === 7 && p.tier === t).length, 0);
assertTrue(Math.abs(g7.alola / g7.n - alolaModel) < 0.005, `Alola share of draws: sampled ${(100 * g7.alola / g7.n).toFixed(2)}% vs model ${(100 * alolaModel).toFixed(2)}%`);

section("Headline Gen 7 numbers (Poké Ball, no rank)");
enable([]);
const before = weightedOdds(all.filter((p) => C.isAcquirable(p.id)), { rank: null });
enable([7]);
const after = weightedOdds(all.filter((p) => C.isAcquirable(p.id)), { rank: null });
const ratio = after.perSpecies.common / before.perSpecies.common;
assertTrue(TIERS.every((t) => Math.abs(after.perSpecies[t] / before.perSpecies[t] - ratio) < 1e-12), "every existing species keeps the same relative odds (one common ratio for all tiers)");
// 91.7% in docs/gen6-9/BALANCE.md; 91.6% since the 2026-11-11 re-tier changed the live pool's tier mix.
assertEqual(ratio.toFixed(3), "0.916", "each existing species: 91.6% of today's odds");
assertTrue(after.tierShare.legendary > before.tierShare.legendary && after.tierShare.mythic > before.tierShare.mythic, "Legendary and Mythic shares rise slightly (Alola adds 13 Legendary, 7 Mythic)");
assertEqual(fs.existsSync(new URL("../docs/gen6-9/GEN7-ENCOUNTER-COMPARISON.md", import.meta.url)), true, "comparison document generated");

enable(null);
finish();
