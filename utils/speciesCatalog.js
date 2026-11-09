// ==========================================================
// utils/speciesCatalog.js — the one place that decides whether a
// species may enter gameplay.
//
//   isSpeciesComplete(id)  — catalogue entry, battle data, sprites and
//                            metadata are all present and valid.
//   isGenerationLive(gen)  — configured (config/generations.js) AND every
//                            species of the generation is complete.
//   isAcquirable(id)       — base species of a live generation.
//   acquirablePokemon(list)— filter for every acquisition pool.
//
// Display, inventories, gifting and battles of already-owned Pokémon use
// the full catalogue; only *new acquisition* goes through these checks.
// ==========================================================

import fs from "fs";
import { GENERATIONS, ALWAYS_ENABLED, configuredGenerations, generationOfDex, MAX_DEX } from "../config/generations.js";
import { getSpecies as getBattleSpecies, TYPE_ID_TO_NAME } from "./battle/data.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const POKEMON = read("../pokemonData.json");
const SPRITES = read("../data/sprites/sprites.json").species;
const SPRITE_DIR = new URL("../public/sprites/pokemon/", import.meta.url);
const TIERS = new Set(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);
/**
 * Pre-existing Gen 1–5 sprite defects, reported but not blocking (these
 * species were already in gameplay before Gen 6–9). Fixing them is a
 * separate decision; see docs/gen6-9/OUTSTANDING.md.
 */
export const KNOWN_LEGACY_SPRITE_ISSUES = Object.freeze({
  493: "Arceus: the shipped shiny GIF is byte-identical to the normal GIF (same defect upstream in PokéAPI black-white/animated).",
});

export const getSpeciesEntry = (id) => POKEMON[Number(id)] ?? null;

/** Name key for look-ups: accents, punctuation, spaces and case ignored ("Flabébé" = "flabebe", "Type: Null" = "type null"). */
export const nameKey = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/♀/g, "f").replace(/♂/g, "m").toLowerCase().replace(/[^a-z0-9]/g, "");
export const allSpeciesIds = () => Object.keys(POKEMON).map(Number).sort((a, b) => a - b);

/** Problems that keep a species out of gameplay (empty array = complete). */
export function speciesProblems(id) {
  const n = Number(id);
  const p = POKEMON[n];
  const out = [];
  if (!p) return [`#${n} has no catalogue entry`];
  if (p.id !== n) out.push(`#${n} id field is ${p.id}`);
  if (!p.name || typeof p.name !== "string") out.push(`#${n} has no name`);
  if (!TIERS.has(p.tier)) out.push(`#${n} has invalid tier ${p.tier}`);
  if (p.generation !== generationOfDex(n)) out.push(`#${n} generation ${p.generation} ≠ ${generationOfDex(n)}`);
  if (p.region !== GENERATIONS[generationOfDex(n)]?.region) out.push(`#${n} region ${p.region}`);
  if (!Array.isArray(p.types) || p.types.length < 1 || p.types.length > 2 || p.types.some((t) => !TYPE_ID_TO_NAME[t])) out.push(`#${n} has invalid types`);
  if (!p.flavor) out.push(`#${n} has no flavor text`);
  for (const k of ["evolvesTo", "evolvesFrom"]) {
    if (!Array.isArray(p[k]) || p[k].some((t) => !POKEMON[t])) out.push(`#${n} ${k} references an unknown species`);
  }
  const b = getBattleSpecies(n);
  if (!b) out.push(`#${n} has no battle data`);
  else {
    if (!b.baseStats || ["hp", "atk", "def", "spa", "spd", "spe"].some((s) => !(b.baseStats[s] > 0))) out.push(`#${n} battle data has invalid base stats`);
    if (JSON.stringify(b.types) !== JSON.stringify((p.types || []).map((t) => TYPE_ID_TO_NAME[t]))) out.push(`#${n} battle types differ from catalogue types`);
    if (!Array.isArray(b.levelMoves)) out.push(`#${n} battle data has no move list`);
  }
  const s = SPRITES[n];
  if (!s?.normal?.file || !s?.shiny?.file) out.push(`#${n} has no sprite manifest entry`);
  else {
    if (s.normal.fileSha1 === s.shiny.fileSha1 && !KNOWN_LEGACY_SPRITE_ISSUES[n]) out.push(`#${n} shiny sprite is identical to the normal sprite`);
    for (const v of ["normal", "shiny", "grayscale"]) {
      if (!s[v]?.file || !fs.existsSync(new URL(s[v].file, SPRITE_DIR))) out.push(`#${n} ${v} sprite file is missing`);
    }
  }
  return out;
}

const completeCache = new Map();
export function isSpeciesComplete(id) {
  const n = Number(id);
  if (!completeCache.has(n)) completeCache.set(n, speciesProblems(n).length === 0);
  return completeCache.get(n);
}

/** Validation problems for a whole generation. */
export function generationProblems(gen) {
  const g = GENERATIONS[gen];
  if (!g) return [`generation ${gen} is not supported`];
  const out = [];
  for (let n = g.first; n <= g.last; n++) out.push(...speciesProblems(n));
  return out;
}

const liveCache = new Map();
let warned = new Set();
/** Configured AND fully valid. Gens 1–5 are always live. */
export function isGenerationLive(gen) {
  const g = Number(gen);
  if (ALWAYS_ENABLED.includes(g)) return true;
  if (!configuredGenerations().includes(g)) return false;
  if (!liveCache.has(g)) {
    const problems = generationProblems(g);
    if (problems.length && !warned.has(g)) {
      warned.add(g);
      console.error(`⛔ Generation ${g} is configured but NOT enabled — ${problems.length} validation problem(s), e.g. ${problems.slice(0, 3).join("; ")}`);
    }
    liveCache.set(g, problems.length === 0);
  }
  return liveCache.get(g);
}

export const liveGenerations = () => Object.keys(GENERATIONS).map(Number).filter(isGenerationLive);

/** May this species be newly acquired through normal gameplay? */
export function isAcquirable(idOrPokemon) {
  const n = Number(typeof idOrPokemon === "object" && idOrPokemon ? idOrPokemon.id : idOrPokemon);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DEX) return false; // forms use "<dex>:<form>" keys and are never acquirable here
  const gen = generationOfDex(n);
  return isGenerationLive(gen) && isSpeciesComplete(n);
}

/** Filter any Pokémon list (objects with `id`) down to acquirable species. */
export const acquirablePokemon = (list) => (Array.isArray(list) ? list : Object.values(list || {})).filter(isAcquirable);

/** Test hook: forget cached validation (after changing configuration). */
export function resetCatalogCachesForTesting() {
  liveCache.clear();
  warned = new Set();
}
