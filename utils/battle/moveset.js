import { getSpecies, getMove, fallbackMoveFor } from "./data.js";

// The last 4 distinct moves learned at or below `level` — how wild Pokémon's
// moves work in the real games. A re-learned move counts as recent again.
// Attacks only: the full sim's learnsets also teach status moves, which a
// Pokémon brings only when its player picks them (battleData.json has none,
// so this changes nothing with the full sim off).
export function autoMoveset(speciesId, level, env) {
  const species = getSpecies(speciesId, env);
  const known = [];
  for (const [learnedAt, moveId] of species.levelMoves) {
    if (learnedAt > level) break;
    if (getMove(moveId, env)?.category === "Status") continue;
    const i = known.indexOf(moveId);
    if (i >= 0) known.splice(i, 1);
    known.push(moveId);
  }
  return known.length ? known.slice(-4) : [fallbackMoveFor(species.types, env)];
}

export function movesLearned(speciesId, fromLevel, toLevel) {
  const before = autoMoveset(speciesId, fromLevel);
  return autoMoveset(speciesId, toLevel).filter((m) => !before.includes(m));
}
