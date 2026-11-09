// ==========================================================
// utils/forms.js — identity for alternate forms (regional variants,
// gender appearances, Mega Evolutions, Primal Reversions, Gigantamax,
// Terastal and other transformations).
//
// A form is NOT a species: it has no National Dex number of its own.
//   • Species inventory key:  "52"          (national dex number)
//   • Form key:               "52:galar"    ("<dex>:<forme id>")
//   • Level/EXP key:          "52:normal"   (utils/training.js; always a
//                                            variant word, never a forme id)
// Form keys always contain exactly one ":" followed by a forme id from
// data/pokedex/forms.json, so they can never collide with a species key,
// and FORME ids never equal "normal"/"shiny".
//
// Each form carries its own types, base stats, sprite id, battle-only flag
// and region. Every form is DISABLED: none can be acquired, displayed as
// owned, evolved into, or battled with until its mechanics are verified
// and it is switched on in data (enabled: true) — and the code paths that
// would use it are reviewed. Mega/Gigantamax/Primal/Terastal battle
// mechanics are deliberately not simulated.
// ==========================================================

import fs from "fs";

const DATA = JSON.parse(fs.readFileSync(new URL("../data/pokedex/forms.json", import.meta.url), "utf8"));
const BY_KEY = new Map(DATA.forms.map((f) => [f.key, Object.freeze(f)]));
export const FORM_KINDS = Object.freeze(["regional", "gender", "mega", "primal", "gigantamax", "terastal", "battle-only", "totem", "cosmetic", "alternate"]);
const RESERVED_VARIANTS = new Set(["normal", "shiny"]);

/** "52:galar" → { species: 52, form: "galar" }; anything else → null. */
export function parseFormKey(key) {
  const m = /^(\d{1,4}):([a-z0-9]+)$/.exec(String(key));
  if (!m || RESERVED_VARIANTS.has(m[2])) return null;
  return { species: Number(m[1]), form: m[2] };
}

export const isFormKey = (key) => parseFormKey(key) !== null && BY_KEY.has(String(key));
export const isSpeciesKey = (key) => /^[1-9]\d{0,3}$/.test(String(key));
export const formKey = (species, formId) => `${Number(species)}:${String(formId).toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
export const getForm = (key) => BY_KEY.get(String(key)) ?? null;
export const formsOf = (species) => DATA.forms.filter((f) => f.species === Number(species));
export const allForms = () => DATA.forms;

/** National Dex species an inventory key belongs to (species or form key), else null. */
export function speciesOfKey(key) {
  if (isSpeciesKey(key)) return Number(key);
  const f = getForm(key);
  return f ? f.species : null;
}

/** Forms are architecture-only for now: never live in gameplay. */
export function isFormEnabled(key) {
  const f = getForm(key);
  return !!(f && f.enabled === true && false); // the second guard stays until form gameplay is reviewed
}
