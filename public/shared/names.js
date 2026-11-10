// ==========================================================
// public/shared/names.js — browser copy of utils/render/names.js
// pokemonData.json stores 24 species names as API slugs ("Mr-mime").
// This maps them to the names the games use, for DISPLAY ONLY: search
// matches both names, and nothing here is sent to the server.
// tests/dashboardNames.test.js keeps this file in sync with the server copy.
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

// The stored slug for each id above, so names coming from the server
// without an id (shop rewards) can be mapped too.
const STORED_NAMES = Object.freeze({
  29: "Nidoran-f", 32: "Nidoran-m", 122: "Mr-mime", 250: "Ho-oh", 386: "Deoxys-normal",
  413: "Wormadam-plant", 439: "Mime-jr", 474: "Porygon-z", 487: "Giratina-altered",
  492: "Shaymin-land", 550: "Basculin-red-striped", 555: "Darmanitan-standard",
  641: "Tornadus-incarnate", 642: "Thundurus-incarnate", 645: "Landorus-incarnate",
  647: "Keldeo-ordinary", 648: "Meloetta-aria", 782: "Jangmo-o", 783: "Hakamo-o",
  784: "Kommo-o", 1001: "Wo-Chien", 1002: "Chien-Pao", 1003: "Ting-Lu", 1004: "Chi-Yu",
});
export const STORED_SLUGS = STORED_NAMES;

const BY_STORED = new Map(Object.entries(STORED_NAMES).map(([id, s]) => [s.toLowerCase(), DISPLAY_NAMES[id]]));

/** The name to show for a species, given its id and stored name. */
export const displaySpeciesName = (id, stored) => DISPLAY_NAMES[Number(id)] ?? stored ?? `#${id}`;

/** The name to show when only the stored name is known. */
export const displayNameFromStored = (stored) => BY_STORED.get(String(stored ?? "").toLowerCase()) ?? stored;

/** Search helper: does `query` match the display name or the stored name? */
export function nameMatches(query, id, stored) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return true;
  return String(stored || "").toLowerCase().includes(q) || displaySpeciesName(id, stored).toLowerCase().includes(q);
}
