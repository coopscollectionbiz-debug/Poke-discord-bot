// ==========================================================
// tests/gen69Catalog.test.js — Generations 6–9 catalogue, sprites, battle
// data, Fairy typing, evolution graph and form identity.
// Real data only; nothing here touches player records.
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import omggif from "omggif";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const DEX = read("../pokemonData.json");
const PUBLIC_DEX = fs.readFileSync(new URL("../public/pokemonData.json", import.meta.url), "utf8");
const BASELINE = read("../data/pokedex/gen1-5-baseline.json");
// Owner-approved tier changes (2026-11-11 re-tier) sit on top of the baseline.
const TIER_OVERRIDES = read("../data/pokedex/tier-overrides.json").overrides;
const BATTLE = read("../battleData.json");
const SPRITES = read("../data/sprites/sprites.json").species;
const SOURCE = read("../data/sprites/source-manifest.json").entries;
const FORMS = read("../data/pokedex/forms.json").forms;
const REPORT = read("../data/pokedex/build-report.json");

const { speciesProblems, isSpeciesComplete, nameKey, KNOWN_LEGACY_SPRITE_ISSUES } = await import("../utils/speciesCatalog.js");
const { effectiveness, TYPE_ID_TO_NAME, getSpecies } = await import("../utils/battle/data.js");
const { buildMon } = await import("../utils/battle/sim.js");
const { autoMoveset } = await import("../utils/battle/moveset.js");
const { pokemonSpritePath, pokemonSpriteUrl, PLACEHOLDER_PATH } = await import("../utils/sprites.js");
const { parseFormKey, isFormKey, isSpeciesKey, speciesOfKey, getForm, formsOf, isFormEnabled } = await import("../utils/forms.js");
const { EVOLVE_STONE_COST } = await import("../services/gameplay.js");
const { publicBaseUrl } = await import("../utils/publicUrl.js");

const ids = Object.keys(DEX).map(Number);
const NEW = ids.filter((n) => n >= 650);
const GEN_RANGES = { 6: [650, 721], 7: [722, 809], 8: [810, 905], 9: [906, 1025] };

section("Species catalogue");
assertEqual(ids.length, 1025, "all 1,025 species load");
assertEqual(ids.sort((a, b) => a - b), Array.from({ length: 1025 }, (_, i) => i + 1), "national dex 1–1025, no gaps, no duplicates");
assertEqual(new Set(Object.values(DEX).map((p) => nameKey(p.name))).size, 1025, "no duplicate species names");
assertEqual(NEW.length, 376, "376 new species");
for (const [g, [a, b]] of Object.entries(GEN_RANGES)) {
  assertEqual(NEW.filter((n) => n >= a && n <= b).length, b - a + 1, `Gen ${g}: ${b - a + 1} species`);
  assertTrue(NEW.filter((n) => n >= a && n <= b).every((n) => DEX[n].generation === Number(g)), `Gen ${g} species carry generation ${g}`);
}
assertEqual(Object.values(DEX).filter((p) => p.id >= 650).map((p) => p.region).filter((r, i, a) => a.indexOf(r) === i), ["Kalos", "Alola", "Galar", "Paldea"], "new regions Kalos, Alola, Galar (incl. Hisui #899–905), Paldea");
const problems = ids.flatMap((n) => speciesProblems(n));
assertEqual(problems, [], "every species has valid metadata, battle data and sprites (speciesProblems)");
assertTrue(NEW.every(isSpeciesComplete), "all 376 new species are complete");
assertEqual(PUBLIC_DEX, fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"), "public/pokemonData.json is byte-identical to pokemonData.json");
assertTrue(NEW.every((n) => DEX[n].flavor && !/Hisui/.test(DEX[n].flavor) || [899, 900, 901, 902, 903, 904, 905].includes(n)), "flavor text describes the species, not a later regional form");

section("Gen 1–5 data preserved");
const changed = [];
for (let n = 1; n <= 649; n++) {
  const a = BASELINE[n], b = DEX[n];
  for (const k of ["name", "tier", "region", "flavor"]) {
    const want = k === "tier" && TIER_OVERRIDES[n] ? (a.tier === TIER_OVERRIDES[n].from ? TIER_OVERRIDES[n].tier : `override from ${TIER_OVERRIDES[n].from}`) : a[k];
    if (want !== b[k]) changed.push(`#${n} ${k}`);
  }
  if (!a.evolvesFrom.every((x, i) => b.evolvesFrom[i] === x) || b.evolvesFrom.length !== a.evolvesFrom.length) changed.push(`#${n} evolvesFrom`);
  if (!a.evolvesTo.every((x, i) => b.evolvesTo[i] === x)) changed.push(`#${n} evolvesTo order`);
  if (b.evolvesTo.slice(a.evolvesTo.length).some((t) => t <= 649)) changed.push(`#${n} new Gen 1–5 evolution`);
}
assertEqual(changed, [], "names, tiers (apart from approved overrides), regions, flavor and existing evolution links of #1–649 unchanged");
const retyped = [];
for (let n = 1; n <= 649; n++) if (JSON.stringify(BASELINE[n].types) !== JSON.stringify(DEX[n].types)) retyped.push(n);
assertEqual(retyped, [35, 36, 39, 40, 122, 173, 174, 175, 176, 183, 184, 209, 210, 280, 281, 282, 298, 303, 439, 468, 546, 547], "exactly the 22 audited species are retyped");
assertTrue(retyped.every((n) => DEX[n].types.includes(18)), "every retyped species gains Fairy");
assertEqual([DEX[35].types, DEX[282].types, DEX[468].types, DEX[303].types], [[18], [14, 18], [18, 3], [9, 18]], "Clefairy Fairy, Gardevoir Psychic/Fairy, Togekiss Fairy/Flying, Mawile Steel/Fairy");
let gen5Same = true;
const BEFORE_MOVES = ["tackle", "flamethrower", "thunderbolt", "surf", "psychic", "earthquake"];
for (let n = 1; n <= 649; n++) if (!BATTLE.species[n]?.baseStats) gen5Same = false;
assertTrue(gen5Same, "every Gen 1–5 species keeps battle data");
assertEqual(BATTLE.species[25].baseStats, { hp: 35, atk: 55, def: 30, spa: 50, spd: 40, spe: 90 }, "Pikachu keeps Gen 5 base stats (no later buffs)");
assertTrue(BEFORE_MOVES.every((m) => BATTLE.moves[m]), "classic moves still present");
assertEqual(BATTLE.moves.flamethrower.power, 95, "Gen 5 move values kept (Flamethrower 95)");

section("Battle data for every new species");
assertEqual(Object.keys(BATTLE.species).length, 1025, "battle data covers 1,025 species");
assertTrue(NEW.every((n) => JSON.stringify(BATTLE.species[n].types) === JSON.stringify(DEX[n].types.map((t) => TYPE_ID_TO_NAME[t]))), "battle types match catalogue types");
assertTrue(NEW.every((n) => Object.values(BATTLE.species[n].baseStats).every((v) => v > 0)), "positive base stats");
assertTrue(Object.values(BATTLE.species).flatMap((s) => s.levelMoves.map(([, m]) => m)).every((m) => BATTLE.moves[m]), "every learnable move is in the move table");
assertTrue(Object.values(BATTLE.moves).every((m) => m.category !== "Status" && m.power > 1), "only damaging moves");
assertTrue(!Object.keys(BATTLE.moves).some((m) => /^(max|gmax)/.test(m) && BATTLE.moves[m].power >= 90 && m !== "maxima"), "no Max/G-Max moves");
assertEqual(BATTLE.species[722].baseStats, { hp: 68, atk: 55, def: 55, spa: 50, spd: 50, spe: 42 }, "Rowlet base stats");
assertEqual(BATTLE.species[1025].types, ["Poison", "Ghost"], "Pecharunt Poison/Ghost");
let simOk = true;
for (const n of NEW) {
  try {
    const mon = buildMon({ speciesId: n, level: 50 });
    const moves = autoMoveset(n, 50);
    if (!(mon.maxHp > 0) || !moves.length || !moves.every((m) => BATTLE.moves[m])) simOk = false;
  } catch { simOk = false; }
}
assertTrue(simOk, "every new species builds a battler with valid moves at Lv 50");

section("Fairy typing");
const eff = (move, ...def) => effectiveness(move, def);
assertEqual(eff("Fairy", "Dragon"), 2, "Fairy → Dragon 2×");
assertEqual(eff("Fairy", "Dark"), 2, "Fairy → Dark 2×");
assertEqual(eff("Fairy", "Fighting"), 2, "Fairy → Fighting 2×");
assertEqual([eff("Fairy", "Steel"), eff("Fairy", "Poison"), eff("Fairy", "Fire")], [0.5, 0.5, 0.5], "Fairy → Steel/Poison/Fire ½×");
assertEqual(eff("Dragon", "Fairy"), 0, "Dragon → Fairy immune");
assertEqual([eff("Steel", "Fairy"), eff("Poison", "Fairy")], [2, 2], "Steel/Poison → Fairy 2×");
assertEqual([eff("Fighting", "Fairy"), eff("Bug", "Fairy"), eff("Dark", "Fairy")], [0.5, 0.5, 0.5], "Fighting/Bug/Dark → Fairy ½×");
assertEqual(eff("Dragon", "Dragon", "Fairy"), 0, "dual type: Dragon → Dragon/Fairy immune");
assertEqual(eff("Fairy", "Dragon", "Dark"), 4, "dual type: Fairy → Dragon/Dark 4×");
assertEqual(eff("Fairy", "Fire", "Steel"), 0.25, "dual type: Fairy → Fire/Steel ¼×");
assertEqual(eff("Poison", "Steel", "Fairy"), 0, "dual type: Poison → Steel/Fairy (Mawile) 0×");
assertEqual([eff("Ghost", "Steel"), eff("Dark", "Steel")], [1, 1], "Gen 6 chart: Steel no longer resists Ghost/Dark");
assertTrue(BATTLE.moves.moonblast?.type === "Fairy" && BATTLE.moves.moonblast.power === 95, "Moonblast (Fairy, 95)");
assertTrue(BATTLE.species[35].levelMoves.some(([, m]) => m === "moonblast") && BATTLE.species[36].levelMoves.some(([, m]) => m === "moonblast"), "Clefairy line learns Moonblast");
assertTrue(BATTLE.fallbackByType.Fairy && BATTLE.moves[BATTLE.fallbackByType.Fairy].type === "Fairy", "Fairy fallback move");
assertTrue(fs.existsSync(new URL("../public/sprites/types/18.png", import.meta.url)), "Fairy type icon 18.png");

section("Sprites");
assertEqual(Object.keys(SPRITES).length, 1025, "sprite manifest covers 1,025 species");
const sha1 = (f) => crypto.createHash("sha1").update(fs.readFileSync(new URL(`../public/sprites/pokemon/${f}`, import.meta.url))).digest("hex");
let fileOk = true, distinct = true, gifOk = true;
const counts = { animated: 0, static: 0 };
for (const n of NEW) {
  const r = SPRITES[n];
  for (const v of ["normal", "shiny", "grayscale"]) if (sha1(r[v].file) !== r[v].fileSha1) fileOk = false;
  if (r.normal.fileSha1 === r.shiny.fileSha1) distinct = false;
  counts[r.normal.kind]++;
  for (const v of ["normal", "shiny"]) {
    const g = new omggif.GifReader(fs.readFileSync(new URL(`../public/sprites/pokemon/${r[v].file}`, import.meta.url)));
    // Animated art, or static art with the 4-frame breathing idle (tools/generate-pokemon-idles.mjs).
    const moving = r[v].kind === "animated" || r[v].motion === "breathing";
    if (g.numFrames() < 1 || moving !== (g.numFrames() > 1) || (r[v].motion === "breathing" && g.numFrames() !== 4)) gifOk = false;
  }
}
assertTrue(fileOk, "every shipped file matches the manifest SHA-1");
assertTrue(distinct, "every new species has a shiny distinct from its normal sprite");
assertTrue(gifOk, "every sprite is a valid GIF; animated or breathing ↔ multi-frame (breathing = 4 frames)");
assertEqual(counts, { animated: 220, static: 156 }, "220 animated + 156 static normal sprites (audited coverage)");
const byGen = {};
for (const n of NEW) { const g = DEX[n].generation; byGen[g] ??= [0, 0]; byGen[g][SPRITES[n].normal.kind === "animated" ? 0 : 1]++; }
assertEqual(byGen, { 6: [54, 18], 7: [74, 14], 8: [67, 29], 9: [25, 95] }, "per-generation animated/static split matches the audit");
const src = new Map(SOURCE.filter((e) => e.kind === "species").map((e) => [e.dex, e]));
assertTrue(NEW.every((n) => SPRITES[n].normal.sourceSha1 === src.get(n).normal.sha1 && SPRITES[n].shiny.sourceSha1 === src.get(n).shiny.sha1), "every sprite came from the audited source file");
assertTrue(SOURCE.every((e) => ["normal", "shiny"].every((v) => !e[v] || (e[v].alphaLevels <= 2 && e[v].maxColors <= 128) || e[v].maxColors <= 64)), "no 3D/render source: every source passed the 2D pixel-art check");
assertTrue(NEW.every((n) => !/\/sprites\/(ani|ani-shiny|ani-back|ani-back-shiny|dex|dex-shiny|home|home-shiny|gen6)\/|other\/(showdown|home|official-artwork)\//.test(SPRITES[n].normal.sourceUrl + SPRITES[n].shiny.sourceUrl)), "no source URL points at a 3D/render collection");
assertEqual(pokemonSpritePath(700, "shiny"), "/public/sprites/pokemon/shiny/700.gif", "resolver: Sylveon shiny path");
assertEqual(pokemonSpritePath(99999, "shiny"), PLACEHOLDER_PATH, "resolver: unknown species → placeholder, never another sprite");
assertEqual(pokemonSpriteUrl(906, true, {}), "https://poke-discord-bot-49shta.fly.dev/public/sprites/pokemon/shiny/906.gif", "Discord URL uses the Fly host by default");
assertEqual(publicBaseUrl({ RENDER_EXTERNAL_URL: "https://poke-discord-bot-2.onrender.com" }), "https://poke-discord-bot-49shta.fly.dev", "retired Render URL is ignored");
assertEqual(publicBaseUrl({ FLY_APP_NAME: "x-app" }), "https://x-app.fly.dev", "FLY_APP_NAME derives the host");
assertEqual(publicBaseUrl({ PUBLIC_URL: "https://bot.example/" }), "https://bot.example", "PUBLIC_URL wins");
assertEqual(Object.keys(KNOWN_LEGACY_SPRITE_ISSUES), ["493"], "only one known pre-existing sprite defect (Arceus shiny), reported not hidden");
assertTrue(fs.readFileSync(new URL("../public/credits/index.html", import.meta.url), "utf8").includes("Smogon X/Y Sprite Project"), "credits page lists the sprite projects");

section("Evolution graph");
let consistent = true;
for (const p of Object.values(DEX)) {
  for (const t of p.evolvesTo) if (!DEX[t].evolvesFrom.includes(p.id)) consistent = false;
  for (const f of p.evolvesFrom) if (!DEX[f].evolvesTo.includes(p.id)) consistent = false;
}
assertTrue(consistent, "evolvesTo / evolvesFrom are mirror images");
const cyc = [];
for (const p of Object.values(DEX)) {
  const seen = new Set();
  const walk = (id, depth) => { if (depth > 5 || seen.has(id)) { cyc.push(p.id); return; } seen.add(id); for (const t of DEX[id].evolvesTo) walk(t, depth + 1); seen.delete(id); };
  walk(p.id, 0);
}
assertEqual([...new Set(cyc)], [], "no evolution loops (and no chain longer than 3 stages)");
const tierIdx = (t) => ["common", "uncommon", "rare", "epic", "legendary", "mythic"].indexOf(t);
const unsupported = [];
for (const p of Object.values(DEX)) for (const t of p.evolvesTo) if (!(EVOLVE_STONE_COST[`${p.tier}-${DEX[t].tier}`] > 0)) unsupported.push(`${p.id}→${t}`);
assertEqual(unsupported.filter((e) => Number(e.split("→")[1]) >= 650), [], "every Gen 6–9 evolution has an Evolution Stone price");
assertTrue(NEW.every((n) => DEX[n].evolvesFrom.every((f) => tierIdx(DEX[n].tier) >= tierIdx(DEX[f].tier))), "Gen 6–9 evolutions never drop a rarity tier");
assertEqual(REPORT.crossGenerationEvolutions.length, 8, "8 Gen 1–5 species gain a Gen 6–9 evolution");
assertEqual(DEX[133].evolvesTo.at(-1), 700, "Eevee → Sylveon");
assertEqual(REPORT.formGatedEvolutions.length, 10, "10 evolutions need a regional form and are gated");
for (const [from, to] of [[264, 862], [52, 863], [215, 903], [194, 980], [550, 902]]) {
  assertTrue(!DEX[from].evolvesTo.includes(to) && DEX[to].evolution?.requiresForm && DEX[to].evolution.from === from, `#${from} → #${to} gated on its regional form`);
}
assertEqual(DEX[700].evolution, { from: 133, trigger: "level-up", knownMoveType: "Fairy", minHappiness: 160 }, "Sylveon's official method recorded");
assertEqual(DEX[651].evolution.minLevel, 16, "Quilladin at Lv 16");

section("Forms (architecture only)");
assertEqual(FORMS.length, 361, "361 audited alternate forms");
assertEqual(new Set(FORMS.map((f) => f.key)).size, 361, "form keys are unique");
assertTrue(FORMS.every((f) => /^\d{1,4}:[a-z0-9]+$/.test(f.key) && !isSpeciesKey(f.key)), "form keys can never equal a species key");
assertTrue(FORMS.every((f) => !["normal", "shiny"].includes(f.key.split(":")[1])), "form keys can never equal a Level key (\"<id>:normal|shiny\")");
assertTrue(FORMS.every((f) => f.enabled === false && !isFormEnabled(f.key)), "every form is disabled");
assertTrue(FORMS.every((f) => DEX[f.species]), "every form belongs to a real species");
assertTrue(!FORMS.some((f) => [984, 1005, 1009, 1020, 1021, 1022, 1023].includes(f.species) && /Paradox/.test(f.name)), "Paradox Pokémon are species, not forms");
assertTrue(NEW.filter((n) => DEX[n].tags?.includes("paradox")).length === 20, "20 Paradox species in the catalogue");
assertEqual(getForm("52:galar")?.types, [9], "Galarian Meowth: own types (Steel)");
assertEqual(getForm("6:megax")?.types, [10, 16], "Mega Charizard X: own types (Fire/Dragon)");
assertTrue(getForm("6:megax").baseStats.atk === 130, "Mega Charizard X: own stats");
assertEqual(parseFormKey("52:galar"), { species: 52, form: "galar" }, "parse a form key");
assertEqual([parseFormKey("52"), parseFormKey("52:normal"), parseFormKey("52:shiny")], [null, null, null], "species and Level keys are not form keys");
assertEqual([speciesOfKey("52"), speciesOfKey("52:galar"), speciesOfKey("nope")], [52, 52, null], "a form maps to its base species");
assertTrue(isFormKey("668:f") && formsOf(6).some((f) => f.kind === "mega") && formsOf(6).some((f) => f.kind === "gigantamax"), "gender, Mega and Gigantamax forms present");
const kinds = new Set(FORMS.map((f) => f.kind));
assertTrue(["regional", "gender", "mega", "primal", "gigantamax", "terastal"].every((k) => kinds.has(k)), "regional, gender, Mega, Primal, Gigantamax and Terastal kinds represented");

finish();
