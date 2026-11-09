// ==========================================================
// tools/generate-pokedex.mjs
// Builds pokemonData.json (+ the byte-identical public/ copy) for the
// whole National Pokédex (#1–1025) and data/pokedex/forms.json.
//
// Sources (pinned, build-time only — the bot never imports them):
//   • data/pokedex/gen1-5-baseline.json — the 649 entries exactly as
//     they shipped before Gen 6–9 (names, tiers, regions, flavor and
//     evolution links are kept as-is).
//   • PokéAPI CSV data at commit POKEAPI_SHA (names, flavor text,
//     generation, legendary/mythical/baby flags, evolution chains and
//     conditions, form identities). Downloaded to .cache/ on first run.
//   • @pkmn/dex (Pokémon Showdown data, MIT) for modern typing, base
//     stats and form data. Types and stats are cross-checked against
//     PokéAPI; any disagreement aborts the build.
//
// Changes applied to #1–649 (approved decisions, nothing else):
//   1. modern typing (Fairy, 22 species — listed in the build log),
//   2. `generation`, `tags` fields,
//   3. new evolution links into Gen 6–9 species, except evolutions that
//      require a regional form (kept as gated metadata on the target).
//
// Run: npm run generate:pokedex
// ==========================================================

import fs from "fs";
import path from "path";
import { Dex } from "@pkmn/dex";
import { readCsv } from "./lib/csv.mjs";
import { classifyTier, TIER_ORDER } from "./lib/tierRules.mjs";

export const POKEAPI_SHA = "e2710d30d14b3f4dc6a02a4a71e8619cd835b7ff";
const ROOT = new URL("..", import.meta.url);
const P = (rel) => new URL(rel, ROOT);
const CACHE = P(`.cache/pokeapi-${POKEAPI_SHA.slice(0, 8)}/`);
const FILES = ["pokemon_species", "pokemon_species_names", "pokemon_species_flavor_text", "pokemon_evolution", "evolution_triggers",
  "item_names", "pokemon", "pokemon_forms", "pokemon_types", "pokemon_stats", "types", "versions", "move_names", "location_names"];

async function ensureCsv() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of FILES) {
    const file = new URL(`${f}.csv`, CACHE);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
    const url = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${POKEAPI_SHA}/data/v2/csv/${f}.csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}
const csv = (f) => readCsv(new URL(`${f}.csv`, CACHE));

export const REGION_RANGES = [
  [1, 151, "Kanto", 1], [152, 251, "Johto", 2], [252, 386, "Hoenn", 3], [387, 493, "Sinnoh", 4], [494, 649, "Unova", 5],
  [650, 721, "Kalos", 6], [722, 809, "Alola", 7], [810, 905, "Galar", 8], [906, 1025, "Paldea", 9],
];
const genOf = (n) => REGION_RANGES.find(([a, b]) => n >= a && n <= b)[3];
const regionOf = (n) => REGION_RANGES.find(([a, b]) => n >= a && n <= b)[2];
// Paradox Pokémon are species with their own dex numbers (never forms).
export const PARADOX = [984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 1005, 1006, 1009, 1010, 1020, 1021, 1022, 1023];
const STARTER_BASES = [650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912];
const toID = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const EN = "9";

async function main() {
  await ensureCsv();
  const baseline = JSON.parse(fs.readFileSync(P("data/pokedex/gen1-5-baseline.json"), "utf8"));
  if (Object.keys(baseline).length !== 649) throw new Error("baseline must hold exactly 649 species");

  const typeIdByName = Object.fromEntries(csv("types").filter((t) => Number(t.id) <= 18).map((t) => [t.identifier, Number(t.id)]));
  const typeIds = (names) => names.map((n) => { const id = typeIdByName[n.toLowerCase()]; if (!id) throw new Error(`unknown type ${n}`); return id; });

  const species = new Map(csv("pokemon_species").map((r) => [Number(r.id), r]));
  const names = new Map(csv("pokemon_species_names").filter((r) => r.local_language_id === EN).map((r) => [Number(r.pokemon_species_id), r.name]));
  const versionOrder = new Map(csv("versions").map((v) => [v.id, Number(v.id)]));
  const flavor = new Map();
  for (const r of csv("pokemon_species_flavor_text")) {
    if (r.language_id !== EN) continue;
    const id = Number(r.species_id), v = versionOrder.get(r.version_id) ?? 0;
    const prev = flavor.get(id);
    if (!prev || v < prev.v) flavor.set(id, { v, text: r.flavor_text.replace(/[\f\n\r­]+/g, " ").replace(/\s+/g, " ").trim() });
  }
  const pokemonRows = csv("pokemon");
  const defaultPokemon = new Map(pokemonRows.filter((r) => r.is_default === "1").map((r) => [Number(r.species_id), Number(r.id)]));
  const pkTypes = new Map();
  for (const r of csv("pokemon_types")) (pkTypes.get(Number(r.pokemon_id)) ?? pkTypes.set(Number(r.pokemon_id), []).get(Number(r.pokemon_id)))[Number(r.slot) - 1] = Number(r.type_id);
  const STAT = { 1: "hp", 2: "atk", 3: "def", 4: "spa", 5: "spd", 6: "spe" };
  const pkStats = new Map();
  for (const r of csv("pokemon_stats")) (pkStats.get(Number(r.pokemon_id)) ?? pkStats.set(Number(r.pokemon_id), {}).get(Number(r.pokemon_id)))[STAT[r.stat_id]] = Number(r.base_stat);
  const forms = new Map(csv("pokemon_forms").map((r) => [Number(r.id), r]));
  const itemName = new Map(csv("item_names").filter((r) => r.local_language_id === EN).map((r) => [Number(r.item_id), r.name]));
  const moveName = new Map(csv("move_names").filter((r) => r.local_language_id === EN).map((r) => [Number(r.move_id), r.name]));
  const locName = new Map(csv("location_names").filter((r) => r.local_language_id === EN).map((r) => [Number(r.location_id), r.name]));
  const trigger = new Map(csv("evolution_triggers").map((r) => [Number(r.id), r.identifier]));
  const typeName = Object.fromEntries(Object.entries(typeIdByName).map(([n, id]) => [id, n[0].toUpperCase() + n.slice(1)]));

  // ---- Showdown species by dex number (base forme)
  const dexByNum = new Map();
  for (const s of Dex.species.all()) if (s.num >= 1 && s.num <= 1025 && !s.forme && !["CAP", "Custom"].includes(s.isNonstandard)) dexByNum.set(s.num, s);

  // ---- cross-check Showdown vs PokéAPI (types + base stats of the default form)
  // Known, reviewed differences in which form each source calls the default:
  const KNOWN_DEFAULT_FORM_DIFFERENCES = {
    774: "Minior: Showdown's base forme is Core (matches the Showdown/Smogon sprite); PokéAPI's default is Red Meteor. Showdown data is used.",
  };
  const problems = [];
  for (let n = 1; n <= 1025; n++) {
    const s = dexByNum.get(n);
    if (!s) { problems.push(`#${n} missing in @pkmn/dex`); continue; }
    const pid = defaultPokemon.get(n);
    const want = pkTypes.get(pid) || [];
    const got = typeIds(s.types);
    if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`#${n} ${s.name} types: pkmn ${s.types} vs pokeapi ${want}`);
    const ps = pkStats.get(pid);
    if (JSON.stringify(ps) !== JSON.stringify(Object.fromEntries(Object.entries(s.baseStats)))) {
      const a = Object.values(s.baseStats).join("/"), b = ps && Object.values(ps).join("/");
      if (a !== b && !KNOWN_DEFAULT_FORM_DIFFERENCES[n]) problems.push(`#${n} ${s.name} stats: pkmn ${a} vs pokeapi ${b}`);
    }
  }
  if (problems.length) throw new Error("source disagreement:\n" + problems.join("\n"));

  // ---- evolution conditions (one record per evolved species: default row, else most recent version group)
  const evoRows = new Map();
  for (const r of csv("pokemon_evolution")) {
    const id = Number(r.evolved_species_id);
    (evoRows.get(id) ?? evoRows.set(id, []).get(id)).push(r);
  }
  const conditionFor = (id) => {
    const rows = evoRows.get(id);
    if (!rows?.length) return null;
    const r = rows.filter((x) => x.is_default === "1").sort((a, b) => Number(b.version_group_id || 0) - Number(a.version_group_id || 0))[0]
      ?? rows.sort((a, b) => Number(b.version_group_id || 0) - Number(a.version_group_id || 0))[0];
    const c = { trigger: trigger.get(Number(r.evolution_trigger_id)) };
    const num = (k) => (r[k] !== "" ? Number(r[k]) : null);
    if (num("minimum_level") != null) c.minLevel = num("minimum_level");
    if (num("trigger_item_id") != null) c.item = itemName.get(num("trigger_item_id"));
    if (num("held_item_id") != null) c.heldItem = itemName.get(num("held_item_id"));
    if (num("known_move_id") != null) c.knownMove = moveName.get(num("known_move_id"));
    if (num("used_move_id") != null) c.usedMove = moveName.get(num("used_move_id"));
    if (num("known_move_type_id") != null) c.knownMoveType = typeName[num("known_move_type_id")];
    if (num("minimum_happiness") != null) c.minHappiness = num("minimum_happiness");
    if (num("minimum_affection") != null) c.minAffection = num("minimum_affection");
    if (r.time_of_day) c.timeOfDay = r.time_of_day;
    if (num("gender_id") != null) c.gender = num("gender_id") === 1 ? "female" : "male";
    if (num("location_id") != null) c.location = locName.get(num("location_id"));
    if (num("party_species_id") != null) c.partySpecies = num("party_species_id");
    if (num("party_type_id") != null) c.partyType = typeName[num("party_type_id")];
    if (num("trade_species_id") != null) c.tradeSpecies = num("trade_species_id");
    if (num("minimum_move_count") != null) c.moveCount = num("minimum_move_count");
    if (num("minimum_steps") != null) c.steps = num("minimum_steps");
    if (num("minimum_damage_taken") != null) c.damageTaken = num("minimum_damage_taken");
    if (r.needs_overworld_rain === "1") c.rain = true;
    if (r.turn_upside_down === "1") c.upsideDown = true;
    if (r.condition_expression) c.condition = r.condition_expression;
    const req = num("required_pokemon_form_id");
    if (req != null) {
      const f = forms.get(req);
      if (f && f.is_default === "0") c.requiresForm = f.form_identifier;
    }
    for (const k of Object.keys(c)) if (c[k] == null || c[k] === "") delete c[k];
    return c;
  };

  // ---- assemble
  const out = {};
  const retyped = [];
  const crossGen = [];
  const gated = [];
  const tagsFor = (n) => {
    const s = species.get(n), t = [];
    if (s.is_legendary === "1") t.push("legendary");
    if (s.is_mythical === "1") t.push("mythical");
    if (s.is_baby === "1") t.push("baby");
    if ((dexByNum.get(n).tags || []).includes("Ultra Beast")) t.push("ultra-beast");
    if (PARADOX.includes(n)) t.push("paradox");
    return t;
  };

  for (let n = 1; n <= 649; n++) {
    const b = baseline[n];
    const types = typeIds(dexByNum.get(n).types);
    if (JSON.stringify(types) !== JSON.stringify(b.types)) retyped.push(`#${n} ${b.name}: ${b.types} → ${types}`);
    const e = { id: n, name: b.name, tier: b.tier, region: b.region, generation: genOf(n), types, flavor: b.flavor,
      evolvesTo: [...(b.evolvesTo || [])], evolvesFrom: [...(b.evolvesFrom || [])] };
    const tags = tagsFor(n);
    if (tags.length) e.tags = tags;
    if (b.region !== regionOf(n)) throw new Error(`baseline region mismatch #${n}`);
    out[n] = e;
  }

  // New species: dex, names, flavor, links (tiers assigned after the graph exists)
  for (let n = 650; n <= 1025; n++) {
    const s = species.get(n);
    const d = dexByNum.get(n);
    const name = names.get(n);
    if (!s || !d || !name) throw new Error(`missing source data for #${n}`);
    const fl = flavor.get(n);
    if (!fl) throw new Error(`no English flavor text for #${n} ${name}`);
    const e = { id: n, name, tier: null, region: regionOf(n), generation: genOf(n), types: typeIds(d.types), flavor: fl.text, evolvesTo: [], evolvesFrom: [] };
    const tags = tagsFor(n);
    if (tags.length) e.tags = tags;
    out[n] = e;
  }
  // Evolution edges that involve at least one Gen 6–9 species.
  for (let n = 650; n <= 1025; n++) {
    const from = Number(species.get(n).evolves_from_species_id) || null;
    if (!from) continue;
    const cond = conditionFor(n) || { trigger: "unknown" };
    // Showdown names the pre-evolution's form when the games require one
    // (e.g. Obstagoon's prevo is "Linoone-Galar"); PokéAPI often does not.
    const prevo = dexByNum.get(n).prevo ? Dex.species.get(dexByNum.get(n).prevo) : null;
    if (prevo?.forme && !cond.requiresForm) cond.requiresForm = toID(prevo.forme);
    out[n].evolution = { from, ...cond };
    if (cond.requiresForm) {
      gated.push(`#${from} ${out[from].name} (${cond.requiresForm}) → #${n} ${out[n].name}`);
      continue; // the bot has no regional forms yet: no base-species shortcut
    }
    out[n].evolvesFrom.push(from);
    if (!out[from].evolvesTo.includes(n)) out[from].evolvesTo.push(n);
    if (from <= 649) crossGen.push(`#${from} ${out[from].name} → #${n} ${out[n].name}`);
  }

  // Tiers for new species (rule documented in tools/lib/tierRules.mjs), then
  // make every evolution step non-decreasing so the stone-cost table applies.
  const bst = (n) => Object.values(dexByNum.get(n).baseStats).reduce((a, c) => a + c, 0);
  const ctx = (n) => ({ id: n, bst: bst(n), capture: Number(species.get(n).capture_rate), tags: out[n].tags || [],
    hasPre: out[n].evolvesFrom.length > 0 || !!out[n].evolution?.requiresForm, hasEvo: out[n].evolvesTo.length > 0,
    starter: isStarterLine(n), pseudo: isPseudoLine(n), fossil: isFossil(n) });
  const lineOf = (n) => { let r = n; while (out[r].evolvesFrom[0]) r = out[r].evolvesFrom[0]; return r; };
  function isStarterLine(n) { return STARTER_BASES.includes(lineOf(n)); }
  function isPseudoLine(n) {
    const root = lineOf(n);
    const finals = []; const walk = (x, depth) => { if (!out[x].evolvesTo.length) finals.push([x, depth]); for (const t of out[x].evolvesTo) walk(t, depth + 1); };
    walk(root, 1);
    return finals.some(([f, depth]) => depth === 3 && bst(f) === 600 && !(out[f].tags || []).some((t) => t === "legendary" || t === "mythical"));
  }
  function isFossil(n) { return [696, 697, 698, 699, 880, 881, 882, 883].includes(n); }
  for (let n = 650; n <= 1025; n++) out[n].tier = classifyTier(ctx(n));
  // monotone along evolutions (only raises Gen 6–9 targets; Gen 1–5 tiers are never touched)
  for (let pass = 0; pass < 3; pass++) {
    for (let n = 650; n <= 1025; n++) {
      for (const f of out[n].evolvesFrom) {
        if (TIER_ORDER.indexOf(out[n].tier) < TIER_ORDER.indexOf(out[f].tier)) out[n].tier = out[f].tier;
      }
    }
  }

  // Forms (architecture data; every form is disabled for gameplay).
  const formsOut = buildForms(typeIds);

  const json = JSON.stringify(out, null, 2) + "\n";
  fs.writeFileSync(P("pokemonData.json"), json);
  fs.writeFileSync(P("public/pokemonData.json"), json);
  fs.writeFileSync(P("data/pokedex/forms.json"), JSON.stringify(formsOut, null, 1) + "\n");
  const meta = { generatedBy: "tools/generate-pokedex.mjs", pokeapiCommit: POKEAPI_SHA, pkmnDex: "@pkmn/dex@0.10.12",
    species: Object.keys(out).length, retyped, crossGenerationEvolutions: crossGen, formGatedEvolutions: gated,
    tiers: Object.fromEntries(TIER_ORDER.map((t) => [t, Object.values(out).filter((e) => e.id >= 650 && e.tier === t).length])) };
  fs.writeFileSync(P("data/pokedex/build-report.json"), JSON.stringify(meta, null, 1) + "\n");
  console.log(`species ${meta.species}; retyped ${retyped.length}; cross-gen ${crossGen.length}; gated ${gated.length}; forms ${formsOut.forms.length}`);
  console.log(meta.tiers);
}

// ---------------------------------------------------------------- forms
// Same selection as the Gen 6–9 audit: every forme of a #650+ species and
// every Gen 6+ forme of a #1–649 species, cosmetic formes, and gender
// sprites. Keys are "<dex>:<formeId>" — never a bare number, so they can
// never collide with a species inventory key.
function formKind(sp) {
  const f = sp.forme || "";
  if (/^Mega/.test(f)) return "mega";
  if (f === "Primal") return "primal";
  if (/Gmax$/.test(f)) return "gigantamax";
  if (/^Alola/.test(f)) return "regional";
  if (/^Galar/.test(f)) return "regional";
  if (/^Hisui/.test(f)) return "regional";
  if (/^Paldea/.test(f)) return "regional";
  if (/Tera|Stellar|Terastal/.test(f)) return "terastal";
  if (/Totem/.test(f)) return "totem";
  if (sp.battleOnly) return "battle-only";
  return "alternate";
}
function regionOfForme(f) {
  const m = /^(Alola|Galar|Hisui|Paldea)/.exec(f || "");
  return m ? { Alola: "Alola", Galar: "Galar", Hisui: "Hisui", Paldea: "Paldea" }[m[1]] : null;
}
function buildForms(typeIds) {
  const all = Dex.species.all().filter((s) => s.num >= 1 && s.num <= 1025 && !["CAP", "Custom"].includes(s.isNonstandard));
  const list = [];
  const seen = new Set();
  const push = (s, kind) => {
    const key = `${s.num}:${toID(s.forme)}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      key, species: s.num, name: s.name, forme: s.forme, kind, region: regionOfForme(s.forme),
      types: typeIds(s.types), baseStats: s.baseStats,
      battleOnly: s.battleOnly ? [].concat(s.battleOnly) : null, requiredItem: s.requiredItem || null,
      introducedGen: s.gen, showdownSpriteId: `${toID(s.baseSpecies)}-${toID(s.forme)}`,
      enabled: false, status: "architecture-only: mechanics and eligibility not yet verified",
    });
  };
  for (const s of all.filter((s) => s.forme && (s.num >= 650 || s.gen >= 6)).sort((a, b) => a.num - b.num || a.name.localeCompare(b.name))) push(s, formKind(s));
  for (const s of all.filter((s) => !s.forme && s.cosmeticFormes?.length && (s.num >= 650 || s.gen >= 6))) {
    for (const n of s.cosmeticFormes) { const c = Dex.species.get(n); if (c?.exists) push(c, "cosmetic"); }
  }
  // gender-only appearance (sprite differs, no Showdown forme): Pyroar
  const pyroar = Dex.species.get("Pyroar");
  list.push({ key: "668:f", species: 668, name: "Pyroar (female)", forme: "F", kind: "gender", region: null, types: typeIds(pyroar.types),
    baseStats: pyroar.baseStats, battleOnly: null, requiredItem: null, introducedGen: 6, showdownSpriteId: "pyroar-f",
    enabled: false, status: "architecture-only: mechanics and eligibility not yet verified" });
  return { note: "Alternate forms. Keys are '<dex>:<forme>'. All disabled until each form's mechanics and eligibility are verified.", forms: list };
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
