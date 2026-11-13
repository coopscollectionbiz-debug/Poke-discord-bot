// ==========================================================
// utils/training.js
// Levels and EXP. Every copy has its own (user.box, services/box.js);
// user.training["6:normal"] = { exp } is DERIVED: the line's best copy,
// rewritten by syncLine. getTraining() therefore answers "the best copy of
// this species + Variant"; team and battle code reads the slot's copy.
// ==========================================================

import fs from "fs";
import { addCopy } from "../services/box.js";
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

function setExp(user, id, variant, exp) {
  user.training ??= {};
  user.training[trainingKey(id, variant)] = { exp: Math.min(exp, expForLevel(LEVEL_CAP)) };
}

export function addExp(user, id, variant, amount) {
  const before = getTraining(user, id, variant);
  setExp(user, id, variant, before.exp + amount);
  return { fromLevel: before.level, toLevel: getTraining(user, id, variant).level };
}

// Every catch goes through here: a new copy (services/box.js) with its own
// Catch level roll. isNew = the species entered the Pokédex just now;
// isNewShiny = the first shiny of it ever. Duplicates no longer add EXP;
// players Feed them instead.
export function grantCatch(user, speciesId, variant, rand = Math.random) {
  const made = addCopy(user, Number(speciesId), variant, { rand });
  return { level: made.level, isNew: made.newSpecies, isNewShiny: made.newShiny, expGained: 0, uid: made.uid };
}

// Evolution and shiny craft: the target keeps the higher of its own Level
// (or its floor, if never owned) and the source's Level.
export function carryLevel(user, from, to) {
  const exp = Math.max(getTraining(user, to.id, to.variant).exp, getTraining(user, from.id, from.variant).exp);
  setExp(user, to.id, to.variant, exp);
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
