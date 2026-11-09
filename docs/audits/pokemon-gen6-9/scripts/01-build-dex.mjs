// 01-build-dex.mjs — read-only. Builds the Gen 6–9 species + form list.
// Sources: @pkmn/dex 0.10.12 (Pokémon Showdown data, MIT) for species/forms,
// PokéAPI CSV (pokemon_species.csv) for generation/legendary/gender-difference flags.
// Usage: node 01-build-dex.mjs <path-to-node_modules> <pokeapi-csv-dir> <out.json>
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const [nm, csvDir, out] = process.argv.slice(2);
const { Dex } = await import(pathToFileURL(path.join(nm, "@pkmn/dex/build/index.mjs")).href).catch(() =>
  import(pathToFileURL(path.join(nm, "@pkmn/dex/build/index.js")).href));

const toID = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
// Showdown sprite-file id: base id + "-" + forme id (matches play.pokemonshowdown.com/sprites)
const spriteId = (sp) => (sp.forme ? `${toID(sp.baseSpecies)}-${toID(sp.forme)}` : toID(sp.name));

const csv = (f) => {
  const [h, ...rows] = fs.readFileSync(path.join(csvDir, f), "utf8").trim().split(/\r?\n/);
  const keys = h.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));
};
const pSpecies = new Map(csv("pokemon_species.csv").map((r) => [Number(r.id), r]));

const genOf = (n) => (n <= 151 ? 1 : n <= 251 ? 2 : n <= 386 ? 3 : n <= 493 ? 4 : n <= 649 ? 5 : n <= 721 ? 6 : n <= 809 ? 7 : n <= 905 ? 8 : 9);
const PARADOX = (sp) => (sp.tags || []).includes("Paradox");

function formCategory(sp) {
  const f = sp.forme || "";
  if (/^Mega/.test(f)) return "mega";
  if (f === "Primal") return "primal";
  if (/Gmax$/.test(f) || f === "Gmax") return "gigantamax";
  if (/^Alola/.test(f)) return "regional-alola";
  if (/^Galar/.test(f)) return "regional-galar";
  if (/^Hisui/.test(f)) return "regional-hisui";
  if (/^Paldea/.test(f)) return "regional-paldea";
  if (/Tera|Stellar|Terastal/.test(f)) return "terastal";
  if (sp.battleOnly) return "battle-only";
  return "other";
}

const rows = [];
const seen = new Set();
const push = (sp, kind, extra = {}) => {
  const sid = spriteId(sp);
  if (seen.has(sid)) return;
  seen.add(sid);
  const ps = pSpecies.get(sp.num) || {};
  rows.push({
    num: sp.num,
    name: sp.name,
    baseSpecies: sp.baseSpecies,
    forme: sp.forme || "",
    spriteId: sid,
    speciesGen: genOf(sp.num),
    formGen: sp.gen,
    kind, // "species" | "form" | "cosmetic" | "gender"
    category: kind === "species" ? (PARADOX(sp) ? "paradox" : "species") : kind === "cosmetic" ? "cosmetic" : kind === "gender" ? "gender" : formCategory(sp),
    tags: (sp.tags || []).join("|"),
    isNonstandard: sp.isNonstandard || "",
    legendary: ps.is_legendary === "1",
    mythical: ps.is_mythical === "1",
    types: sp.types.join("/"),
    ...extra,
  });
};

const all = Dex.species.all().filter((s) => s.num >= 1 && s.num <= 1025 && !["CAP", "Custom"].includes(s.isNonstandard));
// 1) base species 650–1025
for (const s of all.filter((s) => s.num >= 650 && !s.forme).sort((a, b) => a.num - b.num)) push(s, "species");
// 2) forms: any forme of a 650+ species, and any forme of a 1–649 species introduced in Gen 6+
for (const s of all.filter((s) => s.forme && (s.num >= 650 || s.gen >= 6)).sort((a, b) => a.num - b.num)) push(s, "form");
// 3) cosmetic formes (Vivillon patterns, Alcremie, Minior colours, …) of 650+ species or gen6+ introduced
for (const s of all.filter((s) => s.cosmeticFormes?.length && (s.num >= 650 || s.gen >= 6))) {
  for (const n of s.cosmeticFormes) {
    const c = Dex.species.get(n);
    if (c?.exists) push(c, "cosmetic");
  }
}
// 4) gender-specific appearances for 650+ species (PokéAPI has_gender_differences), Showdown "-f" sprite id
for (const [num, ps] of pSpecies) {
  if (num < 650 || ps.has_gender_differences !== "1") continue;
  const base = Dex.species.get(String(num) === "0" ? "" : all.find((s) => s.num === num && !s.forme)?.name);
  if (!base?.exists) continue;
  if (all.some((s) => s.num === num && /^F$|-F$/.test(s.forme))) continue; // already a forme (Meowstic-F, Indeedee-F…)
  const sid = `${toID(base.name)}-f`;
  if (seen.has(sid)) continue;
  seen.add(sid);
  rows.push({ num, name: `${base.name} (female)`, baseSpecies: base.name, forme: "F", spriteId: sid, speciesGen: genOf(num), formGen: genOf(num), kind: "gender", category: "gender", tags: "", isNonstandard: "", legendary: false, mythical: false, types: base.types.join("/") });
}

const species = rows.filter((r) => r.kind === "species");
const perGen = {};
for (const r of species) perGen[r.speciesGen] = (perGen[r.speciesGen] || 0) + 1;
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), source: "@pkmn/dex 0.10.12 + PokeAPI pokemon_species.csv", rows }, null, 1));
console.log("species", species.length, perGen, "forms", rows.length - species.length);
const cats = {};
for (const r of rows) cats[r.category] = (cats[r.category] || 0) + 1;
console.log(cats);
