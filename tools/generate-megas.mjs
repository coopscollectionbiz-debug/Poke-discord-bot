// ==========================================================
// tools/generate-megas.mjs — builds the Mega Evolution catalogue (Phase M0).
//
// Inputs (pinned):
//   • @pkmn/dex 0.10.12 (Pokémon Showdown data): forms, stats, types,
//     abilities, Mega Stones
//   • PokéAPI CSVs @ e2710d30 (.cache/, downloaded once): cross-check of
//     stats and types, introduction version group, Legendary/Mythical flags
//   • docs/mega-evolution/audit-data/probe-results.json: the audited sprite
//     probe (URLs + SHA-1 of every candidate file)
//   • tools/lib/megaRules.mjs: approved decisions the data can't express
//
// Outputs (do not edit by hand):
//   data/pokedex/megas.json             forms + stones
//   data/pokedex/mega-abilities.json    ability implementation manifest
//   data/sprites/mega-source-manifest.json   audited sprite sources per form
//
// The build FAILS (no files written) if Showdown and PokéAPI disagree on any
// stat or type, if a count differs from the audit, or if a sprite candidate
// isn't 2D pixel art.
//
// Run: npm run generate:megas
// ==========================================================

import fs from "fs";
import { Dex } from "@pkmn/dex";
import { readCsv } from "./lib/csv.mjs";
import { POKEAPI_SHA, POKEAPI_CACHE } from "./lib/paths.mjs";
import { ABILITY_REGISTRY } from "../utils/battle/abilities.js";
import { MEGA_DIMENSION_OVERRIDES, BLOCKED, VARIANT_GROUPS, ABILITY_SLOT_RULE, ABILITY_RULES, ENGINE_REQUIREMENTS } from "./lib/megaRules.mjs";

const ROOT = new URL("..", import.meta.url);
const P = (rel) => new URL(rel, ROOT);
const readJson = (rel) => JSON.parse(fs.readFileSync(P(rel), "utf8"));
const CSV_FILES = ["pokemon_forms", "pokemon_stats", "pokemon_types", "types", "pokemon_species"];
const SK = ["hp", "atk", "def", "spa", "spd", "spe"];
const TYPE_IDS = { Normal: 1, Fighting: 2, Flying: 3, Poison: 4, Ground: 5, Rock: 6, Bug: 7, Ghost: 8, Steel: 9, Fire: 10, Water: 11, Grass: 12, Electric: 13, Psychic: 14, Ice: 15, Dragon: 16, Dark: 17, Fairy: 18 };
const toid = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const PKMN_VERSION = JSON.parse(fs.readFileSync(new URL("../node_modules/@pkmn/dex/package.json", import.meta.url), "utf8")).version;

async function ensureCsv() {
  fs.mkdirSync(POKEAPI_CACHE, { recursive: true });
  for (const f of CSV_FILES) {
    const file = new URL(`${f}.csv`, POKEAPI_CACHE);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
    const url = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${POKEAPI_SHA}/data/v2/csv/${f}.csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}
const csv = (f) => readCsv(new URL(`${f}.csv`, POKEAPI_CACHE));

/** "mega-charizard-x", "mega-meowstic-m", "mega-tatsugiri-curly", "mega-magearna-original". */
export function stableIdFor(s) {
  const base = toid(s.baseSpecies);
  const suffix = s.forme.match(/^Mega-([XYZ])$/)?.[1];
  const prefix = s.forme.match(/^(.+)-Mega$/)?.[1];
  if (suffix) return `mega-${base}-${suffix.toLowerCase()}`;
  if (prefix) return `mega-${base}-${toid(prefix)}`;
  return `mega-${base}`;
}

function displayName(s) {
  const suffix = s.forme.match(/^Mega-([XYZ])$/)?.[1];
  const prefix = s.forme.match(/^(.+)-Mega$/)?.[1];
  const label = { M: "Male", F: "Female", Original: "Original Color" }[prefix] ?? prefix;
  return `Mega ${s.baseSpecies}${suffix ? ` ${suffix}` : ""}${prefix ? ` (${label})` : ""}`;
}

// The same 2D rule the audit used: ≤ 64 opaque colours and hard-edged alpha.
const isPixelArt = (f) => !!f?.w && f.colours <= 64 && f.alphaLevels <= 2;
const SOURCE_KEYS = {
  normal: [["sd_ani", "sd", "GIF", "animated"], ["pa_ani", "pa", "GIF", "animated"], ["sd_static", "sds", "PNG", "static"], ["pa_static", "pas", "PNG", "static"]],
  shiny: [["sd_ani_shiny", "sd", "GIF", "animated"], ["pa_ani_shiny", "pa", "GIF", "animated"], ["sd_static_shiny", "sds", "PNG", "static"], ["pa_static_shiny", "pas", "PNG", "static"]],
};
function pickSprite(files, variant) {
  for (const [key, source, format, kind] of SOURCE_KEYS[variant]) {
    const f = files[key];
    if (!f?.w) continue;
    if (kind === "static" && !isPixelArt(f)) continue; // 3D render placeholders are never eligible
    if (kind === "animated" && !(f.colours <= 64 && f.alphaLevels <= 2)) throw new Error(`animated candidate is not pixel art: ${f.url}`);
    return { url: f.url, sha1: f.sha1, source, format, kind, frames: f.frames, size: `${f.w}x${f.h}`, colours: f.colours };
  }
  return null;
}

function introGroup(s, pokeapiForm, stoneNum) {
  const vg = pokeapiForm?.introduced_in_version_group_id;
  if (vg === "15") return "X/Y";
  if (vg === "16") return "Omega Ruby/Alpha Sapphire";
  if (vg !== "31") throw new Error(`${s.name}: unexpected PokéAPI version group ${vg}`);
  if (MEGA_DIMENSION_OVERRIDES.has(s.name)) return "Legends: Z-A Mega Dimension";
  if (stoneNum >= 2559 && stoneNum <= 2587) return "Legends: Z-A";
  if (stoneNum >= 2635) return "Legends: Z-A Mega Dimension";
  throw new Error(`${s.name}: can't place stone #${stoneNum}`);
}

async function main() {
  await ensureCsv();
  const pkForms = csv("pokemon_forms");
  const pkStats = csv("pokemon_stats");
  const pkTypes = csv("pokemon_types");
  const typeName = Object.fromEntries(csv("types").map((t) => [t.id, t.identifier]));
  const pkSpecies = Object.fromEntries(csv("pokemon_species").map((r) => [r.id, r]));
  const battle = readJson("battleData.json").species;
  const dex = readJson("pokemonData.json");
  const existingForms = Object.fromEntries(readJson("data/pokedex/forms.json").forms.map((f) => [f.name, f.key]));
  const probe = Object.fromEntries(readJson("docs/mega-evolution/audit-data/probe-results.json").map((r) => [r.name, r.files]));

  const megas = Dex.species.all().filter((s) => s.num > 0 && /(^|-)Mega(-[XYZ])?$/.test(s.forme));
  const forms = [];
  const stones = new Map();
  const errors = [];

  for (const s of megas) {
    const id = stableIdFor(s);
    const base = Dex.species.get(s.baseSpecies);
    const pkIdent = toid(s.name.replace("-M-", "-Male-").replace("-F-", "-Female-"));
    const pkForm = pkForms.find((f) => toid(f.identifier) === pkIdent);
    if (!pkForm) { errors.push(`${s.name}: not in PokéAPI pokemon_forms`); continue; }
    const pid = pkForm.pokemon_id;
    const paStats = Object.fromEntries(pkStats.filter((r) => r.pokemon_id === pid).map((r) => [SK[Number(r.stat_id) - 1], Number(r.base_stat)]));
    const paTypes = pkTypes.filter((r) => r.pokemon_id === pid).sort((a, b) => a.slot - b.slot).map((r) => typeName[r.type_id]);
    if (SK.some((k) => paStats[k] !== s.baseStats[k])) errors.push(`${s.name}: stats differ (Showdown ${JSON.stringify(s.baseStats)} vs PokéAPI ${JSON.stringify(paStats)})`);
    if (paTypes.join("/") !== s.types.map(toid).join("/")) errors.push(`${s.name}: types differ (${s.types} vs ${paTypes})`);

    const item = s.requiredItem ? Dex.items.get(s.requiredItem) : null;
    const stoneId = item ? `megastone_${item.id}` : null;
    const group = introGroup(s, pkForm, item?.num ?? 0);
    const sp = pkSpecies[String(s.num)];
    const status = sp?.is_legendary === "1" ? "legendary" : sp?.is_mythical === "1" ? "mythical" : "regular";

    const slots = Object.entries(s.abilities);
    const slot = ABILITY_SLOT_RULE[s.name] ?? "0";
    if (slots.length > 1 && !ABILITY_SLOT_RULE[s.name]) errors.push(`${s.name}: several abilities but no slot rule`);
    const ability = s.abilities[slot];
    if (!ABILITY_RULES[ability]) errors.push(`${s.name}: ability ${ability} has no implementation rule`);
    const future = s.isNonstandard === "Future";

    const vg = VARIANT_GROUPS[s.baseSpecies];
    const variant = vg ? { kind: vg.kind, value: vg.byForme[s.forme], decision: vg.decision } : null;
    if (vg && !variant.value) errors.push(`${s.name}: no variant value`);

    const files = probe[s.name] ?? {};
    const sprite = { normal: pickSprite(files, "normal"), shiny: pickSprite(files, "shiny") };
    const blockReasons = [...(BLOCKED[id] ?? [])];
    if ((!sprite.normal || !sprite.shiny) && !blockReasons.some((r) => r.startsWith("sprite:"))) errors.push(`${s.name}: no sprite but not blocked`);

    const prerequisite = s.requiredMove
      ? { kind: "move", move: toid(s.requiredMove), moveName: s.requiredMove }
      : { kind: "stone", item: stoneId };
    const requiresForme = id === "mega-floette" ? "Floette-Eternal" : id === "mega-zygarde" ? "Zygarde-Complete" : null;

    const botBase = battle[s.num]?.baseStats ?? null;
    forms.push({
      id,
      species: s.num,
      baseSpecies: s.baseSpecies,
      name: displayName(s),
      showdownName: s.name,
      formKey: existingForms[s.name] ?? null,
      introducedIn: group,
      officialStatus: status,
      prerequisite,
      requiresForme,
      variant,
      types: s.types,
      typeIds: s.types.map((t) => TYPE_IDS[t]),
      baseStats: { ...s.baseStats },
      bst: SK.reduce((a, k) => a + s.baseStats[k], 0),
      ability,
      abilitySlots: { ...s.abilities },
      abilityVerification: future
        ? `unverified: Showdown "Future" data (Legends: Z-A has no abilities in play)${ABILITY_SLOT_RULE[s.name] ? "; slot 0 chosen per D-11" : ""}`
        : "verified: X/Y/ORAS data in Showdown and PokéAPI",
      base: {
        types: base.types,
        baseStats: { ...base.baseStats },
        botBaseStats: botBase,
        botTypeIds: dex[s.num]?.types ?? null,
      },
      hpChangesFromBot: !!botBase && botBase.hp !== s.baseStats.hp,
      // No base-form substitution: a form without both audited sprites, or an unsupported variant (D-8), has none.
      sprite: sprite.normal && sprite.shiny && !blockReasons.some((r) => /^(unsupported-variant|sprite):/.test(r))
        ? { normal: `normal/${id}.gif`, shiny: `shiny/${id}.gif`, grayscale: `grayscale/${id}.gif` }
        : { normal: null, shiny: null, grayscale: null },
      status: blockReasons.length ? "blocked" : "eligible",
      blockReasons,
      // Phase M2: battle profile. A form may enter battle only with a verified
      // profile (official games with abilities: X/Y, ORAS). Legends: Z-A has no
      // abilities in play, so its Megas stay out of battle until verified.
      battleProfile: future
        ? { verified: false, confidence: "unverified", source: "Pokémon Showdown 'Future' data (@pkmn/dex); Legends: Z-A has no abilities in play" }
        : { verified: true, confidence: "high", source: "X/Y / Omega Ruby–Alpha Sapphire: Pokémon Showdown (@pkmn/dex) and PokéAPI agree on stats and types; ability from Showdown's X/Y/ORAS data" },
      launchReady: false, // "activated for players" — needs the owner's approval (Phase M5)
      launchBlockers: [
        ...(future ? ["Battle profile unverified: Legends: Z-A has no abilities in play"] : []),
        "Mega battles not activated for players (owner approval required)",
      ],
      source: { showdown: `@pkmn/dex ${PKMN_VERSION}`, pokeapi: POKEAPI_SHA, pokeapiPokemonId: Number(pid), statsAndTypesCrossChecked: true },
    });
    if (stoneId) {
      const st = stones.get(stoneId) ?? {
        id: stoneId, name: item.name, showdownId: item.id, itemNum: item.num, species: s.num, baseSpecies: s.baseSpecies,
        forms: [], officialStatus: status, introducedIn: group,
        acquisition: status === "regular" ? "random-pool" : "milestone-or-event-only",
      };
      st.forms.push(id);
      stones.set(stoneId, st);
    }
  }

  forms.sort((a, b) => a.species - b.species || a.id.localeCompare(b.id));
  const stoneList = [...stones.values()].sort((a, b) => a.species - b.species || a.id.localeCompare(b.id));

  // ---- counts the audit established; a difference stops the build ----
  const distinctForms = new Set(forms.map((f) => (f.variant ? `${f.species}:${f.variant.kind}` : f.id))).size;
  const checks = {
    records: [forms.length, 97],
    officialForms: [distinctForms, 93],
    species: [new Set(forms.map((f) => f.species)).size, 87],
    stones: [stoneList.length, 92],
    abilities: [new Set(forms.map((f) => f.ability)).size, 67],
    abilitiesAllSlots: [new Set(forms.flatMap((f) => Object.values(f.abilitySlots))).size, 69],
    noStone: [forms.filter((f) => f.prerequisite.kind === "move").length, 1],
  };
  for (const [k, [got, want]] of Object.entries(checks)) if (got !== want) errors.push(`count ${k}: ${got}, audit says ${want}`);
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

  // ---- ability manifest ----
  const abilityNames = [...new Set(forms.flatMap((f) => Object.values(f.abilitySlots)))].sort();
  const abilities = abilityNames.map((name) => {
    const r = ABILITY_RULES[name];
    if (!r) throw new Error(`no rule for ability ${name}`);
    const a = Dex.abilities.get(name);
    const users = forms.filter((f) => f.ability === name).map((f) => f.id);
    const alternateOnly = forms.filter((f) => f.ability !== name && Object.values(f.abilitySlots).includes(name)).map((f) => f.id);
    return {
      name, id: a.id, category: r.category, rule: r.rule, requires: r.requires ?? [], moveFlags: r.moveFlags ?? [],
      showdownDescription: a.shortDesc || a.desc, showdownNonstandard: a.isNonstandard ?? null,
      megas: users, unusedSlotOf: alternateOnly,
      registryStatus: ABILITY_REGISTRY[name]?.status ?? "missing",
      implemented: ABILITY_REGISTRY[name]?.status === "implemented",
      showdownBreakable: !!a.flags?.breakable, showdownNoTrace: !!(a.flags?.notrace || a.flags?.failroleplay),
    };
  });

  const out = {
    note: "Mega Evolution catalogue (Phase M0). Generated by tools/generate-megas.mjs; do not edit by hand. Megas are battle forms of an owned species line, never National Dex species.",
    sources: { showdown: `@pkmn/dex ${PKMN_VERSION}`, pokeapi: POKEAPI_SHA, spriteAudit: "docs/mega-evolution/audit-data/probe-results.json (2026-11-09)" },
    totals: {
      records: forms.length, officialForms: distinctForms, species: checks.species[0], stones: stoneList.length,
      eligibleRecords: forms.filter((f) => f.status === "eligible").length,
      blockedRecords: forms.filter((f) => f.status === "blocked").length,
      launchReady: forms.filter((f) => f.launchReady).length,
    },
    forms,
    stones: stoneList,
  };
  const abilityOut = {
    note: "Mega ability implementation manifest (D-5). Generated by tools/generate-megas.mjs from tools/lib/megaRules.mjs. 'implemented' becomes true only when utils/battle/abilities.js models the rule and its tests pass.",
    engineRequirements: ENGINE_REQUIREMENTS,
    abilities,
  };
  const spriteOut = {
    note: "Audited sprite sources for Mega forms (Phase M0). Generated by tools/generate-megas.mjs from the 2026-11-09 probe; tools/import-mega-sprites.mjs imports exactly these files (SHA-1 checked).",
    rules: "normal: verified animated BW-style front, else verified static BW-style front (≤64 colours, hard alpha); shiny likewise; 3D renders and 3D animations never eligible; no base-form substitution",
    entries: forms.filter((f) => f.sprite.normal && f.sprite.shiny).map((f) => ({ id: f.id, species: f.species, name: f.name, normal: pickSprite(probe[f.showdownName], "normal"), shiny: pickSprite(probe[f.showdownName], "shiny") })),
  };
  fs.writeFileSync(P("data/pokedex/megas.json"), JSON.stringify(out, null, 1) + "\n");
  fs.writeFileSync(P("data/pokedex/mega-abilities.json"), JSON.stringify(abilityOut, null, 1) + "\n");
  fs.writeFileSync(P("data/sprites/mega-source-manifest.json"), JSON.stringify(spriteOut, null, 1) + "\n");
  const byCat = abilities.reduce((a, x) => ((a[x.category] = (a[x.category] || 0) + 1), a), {});
  console.log("megas", out.totals, "abilities", abilities.length, byCat, "sprite entries", spriteOut.entries.length);
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
