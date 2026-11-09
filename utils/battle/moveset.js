import { getSpecies, fallbackMoveFor } from "./data.js";

export const MOVESET_SIZE = 4;

// The default way to learn a move: it becomes the newest, and past 4 the
// oldest is forgotten. A move the Pokémon already knows counts as newest
// again. This is how wild Pokémon's moves work in the real games, and what
// happens whenever a player doesn't choose (see utils/moveChoice.js).
export function learnMove(moves, moveId) {
  const next = [...moves.filter((m) => m !== moveId), moveId];
  return next.length > MOVESET_SIZE ? next.slice(1) : next;
}

// The moves a species' Learnset teaches above `fromLevel`, up to and
// including `toLevel`, in the order it teaches them.
export function movesTaught(speciesId, fromLevel, toLevel) {
  return getSpecies(speciesId).levelMoves
    .filter(([learnedAt]) => learnedAt > fromLevel && learnedAt <= toLevel)
    .map(([, moveId]) => moveId);
}

// The moves a Pokémon knows at `level`, without the stand-in below. With no
// choice it's the last 4 its Learnset taught. With one ({ moves, movesLevel },
// stored by utils/training.js), every move taught since is learned on top of
// the chosen ones the default way.
export function knownMoves(speciesId, level, choice = null) {
  const start = choice ? choice.moves : [];
  return movesTaught(speciesId, choice ? choice.movesLevel : 0, level).reduce(learnMove, start);
}

// A Pokémon that knows no damaging move yet (Abra, Magikarp under 15) fights
// with a stand-in move of its type. The stand-in is never stored or offered.
export function withFallback(speciesId, moves) {
  return moves.length ? moves : [fallbackMoveFor(getSpecies(speciesId).types)];
}

// The Moveset with no choice made: what battles used before players could choose.
export function autoMoveset(speciesId, level) {
  return withFallback(speciesId, knownMoves(speciesId, level));
}
