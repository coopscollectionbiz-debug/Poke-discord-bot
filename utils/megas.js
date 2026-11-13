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
import { isMegaFormAllowedByFlags, isMegaEvolutionEnabled, isMegaCapabilityEnabled, megaFormAllowlist } from "../config/features.js";
import { generationOfDex } from "../config/generations.js";
import { isGenerationLive } from "./speciesCatalog.js";
import { PLACEHOLDER_PATH } from "./sprites.js";
import { getAbility } from "./battle/abilities.js";
import { isAcceptedZaProfile } from "../config/megaBattleProfiles.js";

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
export function megaAvailability(id, opts = {}) {
  const e = megaBattleEligibility(id, opts);
  return { available: e.battleReady, reasons: e.reasons };
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

/**
 * Phase M1 gate for one form and one capability ("dashboard" | "unlock" |
 * "team"). Unlike megaAvailability (battle use), this doesn't require
 * launchReady: unlocking and team selection are built in M1, battles aren't.
 * Blocked forms (Rayquaza, Floette, Zygarde, Magearna Original) never pass.
 */
export function megaFormGate(id, capability, { env = process.env, generationLive = isGenerationLive } = {}) {
  const f = getMega(id);
  if (!f) return { allowed: false, reasons: ["unknown Mega form"] };
  const reasons = [];
  if (!isMegaCapabilityEnabled(capability, env)) reasons.push(`Mega ${capability} is switched off`);
  const allow = megaFormAllowlist(env);
  if (allow !== null && !allow.has(id)) reasons.push("not in MEGA_FORMS");
  if (f.status !== "eligible") reasons.push(...f.blockReasons);
  if (!generationLive(generationOfDex(f.species))) reasons.push(`generation ${generationOfDex(f.species)} is not live`);
  return { allowed: reasons.length === 0, reasons };
}

/**
 * Battle-eligibility metadata shown on cards. Phase M1: never battle-ready.
 * Lists every reason (battle capability not built, launch blockers, ability
 * not implemented, ability unverified) so nothing claims to work.
 */
export function megaBattleEligibility(id, { env = process.env, generationLive = isGenerationLive } = {}) {
  const f = getMega(id);
  if (!f) return { battleReady: false, reasons: ["unknown Mega form"] };
  const reasons = [];
  if (!isMegaCapabilityEnabled("battle", env)) reasons.push("Mega battles are switched off");
  const allow = megaFormAllowlist(env);
  if (allow !== null && !allow.has(id)) reasons.push("not in MEGA_FORMS");
  if (f.status !== "eligible") reasons.push(...f.blockReasons);
  // Owner-accepted Z-A profiles (Gen 6–9 Pokémon) may battle; see config/megaBattleProfiles.js.
  const accepted = isAcceptedZaProfile(f);
  if (!f.battleProfile?.verified && !accepted) reasons.push("battle profile unverified (Legends: Z-A has no abilities in play)");
  const status = getAbility(f.ability)?.status;
  if (status !== "implemented" && status !== "no-effect") reasons.push(`ability ${f.ability} is not modelled`);
  if (!megaSpriteRecord(id)) reasons.push("no sprite");
  if (!generationLive(generationOfDex(f.species))) reasons.push(`generation ${generationOfDex(f.species)} is not live`);
  return {
    battleReady: reasons.length === 0,
    reasons,
    abilityStatus: status ?? "missing",
    abilityVerified: !!f.battleProfile?.verified,
    profileConfidence: accepted ? "accepted" : f.battleProfile?.confidence ?? "unverified",
  };
}

/** The battle-only profile for a form (stats, types, ability, display name). */
export function megaBattleProfile(id) {
  const f = getMega(id);
  if (!f) return null;
  return Object.freeze({ formId: f.id, name: f.name, species: f.species, types: [...f.types], baseStats: { ...f.baseStats }, ability: f.ability });
}
