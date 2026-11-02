// ==========================================================
// utils/training.js
// Levels and EXP, stored once per species + Variant:
//   user.training["6:normal"] = { exp }   (Level is derived from exp)
// No record means the Pokémon sits at the bottom of its catch range, so
// existing collections need no migration. Records survive the count
// reaching 0, so a re-caught Pokémon comes back at its old Level.
// ==========================================================

import fs from "fs";
import {
  LEVEL_CAP, CATCH_RANGES, CATCH_SKEW, CATCH_TAIL_CHANCE, DUPLICATE_LEVEL_SHARE,
} from "./battle/tuning.js";

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
  while (p?.evolvesFrom?.length) {
    stage++;
    p = pokemonData[p.evolvesFrom[0]];
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

function setExp(user, id, variant, exp) {
  user.training ??= {};
  user.training[trainingKey(id, variant)] = { exp: Math.min(exp, expForLevel(LEVEL_CAP)) };
}

export function addExp(user, id, variant, amount) {
  const before = getTraining(user, id, variant);
  setExp(user, id, variant, before.exp + amount);
  return { fromLevel: before.level, toLevel: getTraining(user, id, variant).level };
}

// Every catch goes through here: +1 count, then either a Catch level roll
// (first time) or duplicate EXP (record already exists, even at count 0).
// Gifts and admin grants don't use this — they add count only.
export function grantCatch(user, speciesId, variant, rand = Math.random) {
  user.pokemon ??= {};
  user.pokemon[speciesId] ??= { normal: 0, shiny: 0 };
  user.pokemon[speciesId][variant] = (user.pokemon[speciesId][variant] ?? 0) + 1;

  if (!user.training?.[trainingKey(speciesId, variant)]) {
    const level = rollCatchLevel(speciesId, rand);
    setExp(user, speciesId, variant, expForLevel(level));
    return { level, isNew: true, expGained: 0 };
  }

  const { level } = getTraining(user, speciesId, variant);
  const expGained = level >= LEVEL_CAP
    ? 0
    : Math.floor((expForLevel(level + 1) - expForLevel(level)) * DUPLICATE_LEVEL_SHARE);
  const { toLevel } = addExp(user, speciesId, variant, expGained);
  return { level: toLevel, isNew: false, expGained };
}

// Evolution and shiny craft: the target keeps the higher of its own Level
// (or its floor, if never owned) and the source's Level.
export function carryLevel(user, from, to) {
  const exp = Math.max(getTraining(user, to.id, to.variant).exp, getTraining(user, from.id, from.variant).exp);
  setExp(user, to.id, to.variant, exp);
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
