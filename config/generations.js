// ==========================================================
// config/generations.js — which Pokémon generations are live.
//
// Gens 1–5 are always enabled (existing collections, achievements and
// battles depend on them). Gens 6–9 are OFF unless the operator turns
// them on with the POKEMON_GENERATIONS environment variable, e.g.
//
//   POKEMON_GENERATIONS=7          → Gens 1–5 + 7 (Alola)
//   POKEMON_GENERATIONS=6,7        → Gens 1–5 + Kalos + Alola
//   POKEMON_GENERATIONS=6-9        → everything
//
// "Enabled" means a generation's species can be newly acquired (catches,
// /daily, shop, quests, recruit, weekly pack, evolution targets, admin
// grants without an override). Owned Pokémon from a disabled generation
// stay in inventories and stay viewable, giftable and battle-ready;
// nothing is ever deleted by turning a generation off.
//
// A generation that fails validation (missing battle data, sprites or
// metadata — see utils/speciesCatalog.js) is refused even if listed.
// ==========================================================

export const GENERATIONS = Object.freeze({
  1: { region: "Kanto", first: 1, last: 151 },
  2: { region: "Johto", first: 152, last: 251 },
  3: { region: "Hoenn", first: 252, last: 386 },
  4: { region: "Sinnoh", first: 387, last: 493 },
  5: { region: "Unova", first: 494, last: 649 },
  6: { region: "Kalos", first: 650, last: 721 },
  7: { region: "Alola", first: 722, last: 809 },
  // Gen 8 includes the Hisui-introduced species #899–905; they belong to
  // Galar for Pokédex completion so no species is ever counted twice.
  8: { region: "Galar", first: 810, last: 905 },
  9: { region: "Paldea", first: 906, last: 1025 },
});

export const ALWAYS_ENABLED = Object.freeze([1, 2, 3, 4, 5]);
export const OPTIONAL_GENERATIONS = Object.freeze([6, 7, 8, 9]);
export const MAX_DEX = 1025;

export function generationOfDex(id) {
  const n = Number(id);
  for (const [gen, g] of Object.entries(GENERATIONS)) if (n >= g.first && n <= g.last) return Number(gen);
  return null;
}

/**
 * Parse a POKEMON_GENERATIONS value. Unknown or malformed parts are
 * reported and ignored; Gens 1–5 are always included.
 * @returns {{ enabled: number[], warnings: string[] }}
 */
export function parseGenerations(value) {
  const enabled = new Set(ALWAYS_ENABLED);
  const warnings = [];
  for (const raw of String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d)(?:\s*-\s*(\d))?$/.exec(raw);
    if (!m) { warnings.push(`ignored "${raw}" (expected a number like 7 or a range like 6-9)`); continue; }
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a > b) { warnings.push(`ignored "${raw}" (range runs backwards)`); continue; }
    for (let g = a; g <= b; g++) {
      if (!GENERATIONS[g]) warnings.push(`ignored generation ${g} (not supported)`);
      else enabled.add(g);
    }
  }
  return { enabled: [...enabled].sort((x, y) => x - y), warnings };
}

let override = null; // tests only

/** Generations requested by configuration (before validation). */
export function configuredGenerations(env = process.env) {
  if (override) return override;
  return parseGenerations(env.POKEMON_GENERATIONS).enabled;
}

/** Test hook: force a configuration; pass null to restore the environment. */
export function setGenerationsForTesting(list) {
  override = list ? parseGenerations(list.join(",")).enabled : null;
}
