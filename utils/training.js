// ==========================================================
// utils/training.js
// Levels, EXP, and Movesets, stored once per species + Variant:
//   user.training["6:normal"] = { exp, moves?, movesLevel? }
// Level is derived from exp. `moves` is the player's chosen Moveset and
// `movesLevel` the Level it was chosen at; both are written only when a
// player picks (utils/moveChoice.js) or an evolution passes a choice on.
// No record means the Pokémon sits at the bottom of its catch range, so
// existing collections need no migration. Losing the last copy deletes the
// record (resetLevelIfGone), so the next catch rolls a new Catch level.
// ==========================================================

import fs from "fs";
import {
  LEVEL_CAP, CATCH_RANGES, CATCH_SKEW, CATCH_TAIL_CHANCE, DUPLICATE_LEVEL_SHARE,
} from "./battle/tuning.js";
import { knownMoves, movesTaught, withFallback } from "./battle/moveset.js";

const pokemonData = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));

export const trainingKey = (id, variant) => `${id}:${variant}`;
export const speciesName = (id) => pokemonData[id]?.name ?? `#${id}`;

// Medium Fast growth: Level³ total EXP.
export const expForLevel = (level) => (level <= 1 ? 0 : level ** 3);

export function levelForExp(exp) {
  let level = Math.floor(Math.cbrt(exp));
  while (level > 1 && level ** 3 > exp) level--;
  while ((level + 1) ** 3 <= exp) level++;
  return Math.min(LEVEL_CAP, Math.max(1, level));
}

export function stageOf(speciesId) {
  let stage = 1;
  let p = pokemonData[speciesId];
  // evolution.from covers species whose pre-evolution needs a regional form
  // (e.g. Obstagoon from Galarian Linoone), which has no evolvesFrom link.
  const prev = (q) => q?.evolvesFrom?.[0] ?? q?.evolution?.from;
  for (let guard = 0; prev(p) && guard < 5; guard++) {
    stage++;
    p = pokemonData[prev(p)];
  }
  return stage;
}

export function catchBand(speciesId) {
  const stage = stageOf(speciesId);
  const tier = String(pokemonData[speciesId]?.tier || "").toLowerCase();
  return stage === 1 && (tier === "legendary" || tier === "mythic") ? "legendary" : stage;
}

export const floorLevel = (speciesId) => CATCH_RANGES[catchBand(speciesId)].min;

export function rollCatchLevel(speciesId, rand = Math.random) {
  const { min, max, tailMax } = CATCH_RANGES[catchBand(speciesId)];
  if (rand() < CATCH_TAIL_CHANCE) return max + 1 + Math.floor(rand() * (tailMax - max));
  return min + Math.floor((max - min + 1) * rand() ** CATCH_SKEW);
}

export function getTraining(user, id, variant) {
  const exp = user.training?.[trainingKey(id, variant)]?.exp ?? expForLevel(floorLevel(id));
  return { exp, level: levelForExp(exp) };
}

// Keeps the record's other fields: a chosen Moveset survives every EXP change.
function setExp(user, id, variant, exp) {
  user.training ??= {};
  const key = trainingKey(id, variant);
  user.training[key] = { ...user.training[key], exp: Math.min(exp, expForLevel(LEVEL_CAP)) };
}

const choiceOf = (user, id, variant) => {
  const record = user.training?.[trainingKey(id, variant)];
  return record?.moves ? record : null;
};

// The Moveset this Pokémon fights with, as move ids.
export function getMoveset(user, id, variant) {
  const { level } = getTraining(user, id, variant);
  return withFallback(id, knownMoves(id, level, choiceOf(user, id, variant)));
}

// Stores the player's choice. `moves` must be the whole Moveset at the
// current Level, so later Level-ups learn on top of it from here.
export function chooseMoves(user, id, variant, moves) {
  const { exp, level } = getTraining(user, id, variant);
  setExp(user, id, variant, exp);
  Object.assign(user.training[trainingKey(id, variant)], { moves: [...moves], movesLevel: level });
}

// What a Level-up taught, for the move prompt: the Moveset before it
// (without the stand-in move) and the moves taught, in order. Null when it
// taught nothing. Call it right after the EXP change: the record's choice
// must still be the one it had at `fromLevel`.
export function moveLesson(user, id, variant, fromLevel, toLevel) {
  const taught = movesTaught(id, fromLevel, toLevel);
  if (!taught.length) return null;
  return { speciesId: id, variant, toLevel, before: knownMoves(id, fromLevel, choiceOf(user, id, variant)), taught };
}

export function addExp(user, id, variant, amount) {
  const before = getTraining(user, id, variant);
  setExp(user, id, variant, before.exp + amount);
  return { fromLevel: before.level, toLevel: getTraining(user, id, variant).level };
}

// Every catch goes through here: +1 count, then either a Catch level roll
// (first time) or duplicate EXP (record already exists).
// Gifts and admin grants don't use this — they add count only.
export function grantCatch(user, speciesId, variant, rand = Math.random) {
  user.pokemon ??= {};
  user.pokemon[speciesId] ??= { normal: 0, shiny: 0 };
  user.pokemon[speciesId][variant] = (user.pokemon[speciesId][variant] ?? 0) + 1;

  if (!user.training?.[trainingKey(speciesId, variant)]) {
    const level = rollCatchLevel(speciesId, rand);
    setExp(user, speciesId, variant, expForLevel(level));
    return { level, isNew: true, expGained: 0, lesson: null };
  }

  const { level } = getTraining(user, speciesId, variant);
  const expGained = level >= LEVEL_CAP
    ? 0
    : Math.floor((expForLevel(level + 1) - expForLevel(level)) * DUPLICATE_LEVEL_SHARE);
  const { fromLevel, toLevel } = addExp(user, speciesId, variant, expGained);
  return { level: toLevel, isNew: false, expGained, lesson: moveLesson(user, speciesId, variant, fromLevel, toLevel) };
}

// Evolution and shiny craft: the target keeps the higher of its own Level
// (or its floor, if never owned) and the source's Level. A source with a
// chosen Moveset passes it on, unless the target has a choice of its own;
// the target then learns its own Learnset's moves above the source's Level.
export function carryLevel(user, from, to) {
  const source = getTraining(user, from.id, from.variant);
  const inherited = choiceOf(user, from.id, from.variant) && !choiceOf(user, to.id, to.variant)
    ? { moves: knownMoves(from.id, source.level, choiceOf(user, from.id, from.variant)), movesLevel: source.level }
    : null;
  setExp(user, to.id, to.variant, Math.max(getTraining(user, to.id, to.variant).exp, source.exp));
  if (inherited) Object.assign(user.training[trainingKey(to.id, to.variant)], inherited);
}

// Every path that removes copies (gift, donate, evolve, shiny craft) calls
// this after its count change. Evolve and shiny craft call it after
// carryLevel, which still needs the source's Level.
export function resetLevelIfGone(user, id, variant) {
  if ((user.pokemon?.[id]?.[variant] ?? 0) <= 0) delete user.training?.[trainingKey(id, variant)];
}

export function levelsForUser(user) {
  const out = {};
  for (const [id, counts] of Object.entries(user.pokemon ?? {})) {
    for (const variant of ["normal", "shiny"]) {
      if ((counts?.[variant] ?? 0) > 0) out[trainingKey(id, variant)] = getTraining(user, id, variant).level;
    }
  }
  return out;
}
