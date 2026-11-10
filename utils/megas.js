// ==========================================================
// utils/megas.js — read-only access to the Mega Evolution catalogue
// (data/pokedex/megas.json) and the Mega sprite manifest
// (data/sprites/megas.json). Phase M0: data only. Nothing here grants,
// unlocks or transforms anything.
//
// Identity (D-1, docs/mega-evolution/MEGA-ARCHITECTURE-AUDIT.md §2):
//   Mega form id   "mega-charizard-x"   (stable, never a National Dex number)
//   Base species   6                    (the only thing that is ever owned)
//   Line           "6:normal"           (species + variant; holds Level and unlocks)
// A Mega is never a species: it can't be caught, counted in the Pokédex,
// gifted, donated or evolved. It is a battle form of an owned line.
// ==========================================================

import fs from "fs";
import { isMegaFormAllowedByFlags, isMegaEvolutionEnabled } from "../config/features.js";
import { generationOfDex } from "../config/generations.js";
import { isGenerationLive } from "./speciesCatalog.js";
import { PLACEHOLDER_PATH } from "./sprites.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const DATA = read("../data/pokedex/megas.json");
const SPRITES = read("../data/sprites/megas.json");
const ABILITIES = read("../data/pokedex/mega-abilities.json");

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};
const FORMS = deepFreeze(DATA.forms);
const BY_ID = new Map(FORMS.map((f) => [f.id, f]));
const BY_STONE = new Map();
for (const f of FORMS) if (f.prerequisite.kind === "stone") (BY_STONE.get(f.prerequisite.item) ?? BY_STONE.set(f.prerequisite.item, []).get(f.prerequisite.item)).push(f);
const STONES = deepFreeze(DATA.stones);
const ABILITY_BY_NAME = new Map(ABILITIES.abilities.map((a) => [a.name, deepFreeze(a)]));

export const MEGA_ID_PATTERN = /^mega-[a-z0-9]+(-[a-z0-9]+)*$/;

export const allMegas = () => FORMS;
export const allMegaStones = () => STONES;
export const megaTotals = () => DATA.totals;
export const getMega = (id) => (typeof id === "string" ? BY_ID.get(id) ?? null : null);
export const isMegaId = (id) => BY_ID.has(id);
export const megasOfSpecies = (species) => FORMS.filter((f) => f.species === Number(species));
/** Forms a stone can unlock (several for Meowsticite, Tatsugirinite, Magearnite). */
export const megasForStone = (stoneItemId) => BY_STONE.get(stoneItemId) ?? [];
export const megaAbility = (name) => ABILITY_BY_NAME.get(name) ?? null;
export const megaAbilities = () => ABILITIES.abilities;

/**
 * Can this form be used in gameplay right now? Phase M0: never, because no
 * form is launchReady (D-5: battle abilities first). Returns every reason, so
 * callers and tests can see exactly what blocks it.
 */
export function megaAvailability(id, { env = process.env, generationLive = isGenerationLive } = {}) {
  const f = getMega(id);
  if (!f) return { available: false, reasons: ["unknown Mega form"] };
  const reasons = [];
  if (!isMegaEvolutionEnabled(env)) reasons.push("MEGA_EVOLUTION_ENABLED is off");
  else if (!isMegaFormAllowedByFlags(id, env)) reasons.push("not in MEGA_FORMS");
  if (f.status !== "eligible") reasons.push(...f.blockReasons);
  if (!f.launchReady) reasons.push(...f.launchBlockers);
  if (!generationLive(generationOfDex(f.species))) reasons.push(`generation ${generationOfDex(f.species)} is not live`);
  return { available: reasons.length === 0, reasons };
}
export const isMegaAvailable = (id, opts) => megaAvailability(id, opts).available;

/** Sprite manifest record for a Mega form, or null. */
export const megaSpriteRecord = (id) => SPRITES.forms[id] ?? null;

/**
 * "/public/sprites/pokemon/mega/<variant>/<id>.gif", or the Poké Ball
 * placeholder. Never the base species' sprite (no substitution).
 */
export function megaSpritePath(id, variant = "normal") {
  const v = variant === true ? "shiny" : variant === false ? "normal" : variant;
  const rec = megaSpriteRecord(id)?.[v];
  return rec?.file ? `${SPRITES.basePath}${rec.file}` : PLACEHOLDER_PATH;
}
