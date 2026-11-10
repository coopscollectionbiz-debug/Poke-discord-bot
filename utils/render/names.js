// ==========================================================
// utils/render/names.js
// Player-facing species names. pokemonData.json stores 24 names as API
// slugs ("Mr-mime", "Nidoran-f", "Giratina-altered"), which every command
// and the dashboard show as-is. This maps them to the names the games use,
// for display only: the data file, name search (findPokemonByName) and
// achievements keep the stored names untouched.
// ==========================================================

export const DISPLAY_NAMES = Object.freeze({
  29: "Nidoran♀",
  32: "Nidoran♂",
  122: "Mr. Mime",
  250: "Ho-Oh",
  386: "Deoxys",
  413: "Wormadam",
  439: "Mime Jr.",
  474: "Porygon-Z",
  487: "Giratina",
  492: "Shaymin",
  550: "Basculin",
  555: "Darmanitan",
  641: "Tornadus",
  642: "Thundurus",
  645: "Landorus",
  647: "Keldeo",
  648: "Meloetta",
  782: "Jangmo-o",
  783: "Hakamo-o",
  784: "Kommo-o",
  1001: "Wo-Chien",
  1002: "Chien-Pao",
  1003: "Ting-Lu",
  1004: "Chi-Yu",
});

/** The name to show for a species, given its stored name. */
export const displaySpeciesName = (id, stored) => DISPLAY_NAMES[Number(id)] ?? stored ?? `#${id}`;
