import { getSpecies, fallbackMoveFor } from "./data.js";

// The last 4 distinct moves learned at or below `level` — how wild Pokémon's
// moves work in the real games. A re-learned move counts as recent again.
export function autoMoveset(speciesId, level) {
  const species = getSpecies(speciesId);
  const known = [];
  for (const [learnedAt, moveId] of species.levelMoves) {
    if (learnedAt > level) break;
    const i = known.indexOf(moveId);
    if (i >= 0) known.splice(i, 1);
    known.push(moveId);
  }
  return known.length ? known.slice(-4) : [fallbackMoveFor(species.types)];
}

export function movesLearned(speciesId, fromLevel, toLevel) {
  const before = autoMoveset(speciesId, fromLevel);
  return autoMoveset(speciesId, toLevel).filter((m) => !before.includes(m));
}
