// ==========================================================
// utils/encounter/generate.js
// Rolls the Trainer for a Trainer encounter from the player's Team and a
// seed (docs/superpowers/specs/2026-11-10-trainer-encounters-design.md, The
// Trainer). Pure: the same Team and seed always give the same Trainer.
// Levels follow the Team's average; species follow the class's type theme
// and are always the furthest form of their line that fits their Level.
// ==========================================================

import { readFileSync } from "fs";
import { createRng } from "../battle/rng.js";
import { getSpecies, TYPE_ID_TO_NAME } from "../battle/data.js";
import { floorLevel } from "../training.js";
import { isAcquirable } from "../speciesCatalog.js";
import { ENCOUNTER } from "../battle/tuning.js";
import { TRAINER_CLASSES, ACE_KEYS, REGULAR_KEYS, NAMES, classSprite } from "./roster.js";
import { LINES, OVER_INTRO } from "./lines.js";

const pokemonData = JSON.parse(readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));

export const teamAverage = (team) => Math.round(team.reduce((t, m) => t + m.level, 0) / team.length);

// Released, and something the battle sim can field.
const usable = (id) => isAcquirable(id) && Boolean(getSpecies(id));

// This game's legendary tier also holds starters' and pseudo-legendaries'
// final forms (Charizard, Dragonite), so a legendary is judged by its line:
// one whose first form is legendary or mythic, the rule catch Levels use.
export function legendaryLine(id) {
  let p = pokemonData[id];
  for (let guard = 0; guard < 5; guard++) {
    const prev = p?.evolvesFrom?.[0] ?? p?.evolution?.from;
    if (!prev || !pokemonData[prev]) break;
    p = pokemonData[prev];
  }
  return ["legendary", "mythic"].includes(String(p?.tier).toLowerCase());
}

// The furthest form that fits: allowed at this Level, and no evolution is.
const fits = (id, level) =>
  floorLevel(id) <= level && !(pokemonData[id].evolvesTo ?? []).some((e) => usable(e) && floorLevel(e) <= level);

let allSpecies = null;
const species = () => (allSpecies ??= Object.keys(pokemonData).map(Number).filter((id) => Number.isInteger(id) && usable(id)));

const onTheme = (theme, id) => !theme.length || pokemonData[id].types.some((t) => theme.includes(TYPE_ID_TO_NAME[t]));

const cache = new Map();
const cached = (key, build) => {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
};

/** The species a class can field at a Level: on theme, never legendary, the furthest form that fits. */
export const candidates = (classKey, level) => cached(`${classKey}:${level}`, () => {
  const theme = TRAINER_CLASSES[classKey].types;
  return species().filter((id) => !legendaryLine(id) && onTheme(theme, id) && fits(id, level));
});

/** The surprise's species at a Level: any type, legendaries included. */
export const surprisePool = (level) => cached(`surprise:${level}`, () => species().filter((id) => fits(id, level)));

export const prizeMoney = (classKey, party) => TRAINER_CLASSES[classKey].base * party.at(-1).level;

/**
 * The Trainer for an encounter. `team` is the player's Team ({ level } at
 * least). Every roll comes from one seeded stream in a fixed order (tier,
 * class, name, size, Levels, species, surprise, lines).
 */
export function rollTrainer({ team, seed }) {
  const rng = createRng(seed);
  const pick = (list) => list[rng.int(list.length)];
  const avg = teamAverage(team);
  const clamp = (level) => Math.min(ENCOUNTER.maxLevel, Math.max(ENCOUNTER.minLevel, level));
  const roll = ([lo, hi]) => clamp(avg + lo + rng.int(hi - lo + 1));

  const u = rng.next();
  let acc = 0;
  const tier = ENCOUNTER.tiers.find((t) => (acc += t.share) > u) ?? ENCOUNTER.tiers.at(-1);
  const ace = tier.key === "over" && rng.next() < ENCOUNTER.aceShare;
  const classKey = pick(ace ? ACE_KEYS : REGULAR_KEYS);
  const cls = TRAINER_CLASSES[classKey];
  const name = pick(NAMES[cls.gender]);
  const [minSize, maxSize] = ENCOUNTER.partySize;
  const size = minSize + rng.int(maxSize - minSize + 1);

  // Weakest to strongest, so the strongest comes out last, as in the games.
  const levels = Array.from({ length: size }, () => roll(tier.band)).sort((a, b) => a - b);
  const party = [];
  for (const level of levels) {
    const pool = candidates(classKey, level);
    const fresh = pool.filter((id) => !party.some((m) => m.speciesId === id));
    party.push({ speciesId: pick(fresh.length ? fresh : pool), level });
  }
  // Its band starts above Under's, so it stays last.
  const surprise = tier.key === "under" && rng.next() < ENCOUNTER.surprise.share;
  if (surprise) {
    const level = roll(ENCOUNTER.surprise.band);
    party[party.length - 1] = { speciesId: pick(surprisePool(level)), level };
  }

  const set = LINES[cls.lines];
  const lines = { intro: pick(tier.key === "over" && !cls.ace ? OVER_INTRO : set.intro), lost: pick(set.lost), won: pick(set.won) };
  return { classKey, title: cls.title, name, spriteFile: classSprite(classKey), tier: tier.key, surprise, party, prize: prizeMoney(classKey, party), lines };
}
