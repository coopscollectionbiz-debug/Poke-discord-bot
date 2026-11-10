// ==========================================================
// tests/megaCatalog.test.js — Mega Evolution Phase M0: catalogue,
// stones/items, special cases and the ability manifest. Real data only;
// nothing here touches player records.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const MEGAS = read("../data/pokedex/megas.json");
const ABILITIES = read("../data/pokedex/mega-abilities.json").abilities;
const DEX = read("../pokemonData.json");
const BATTLE = read("../battleData.json");
const FORMS_JSON = read("../data/pokedex/forms.json").forms;

const { megaProblems, EXPECTED } = await import("../tools/lib/megaValidation.mjs");
const M = await import("../utils/megas.js");
const items = await import("../catalog/items.js");
const inv = await import("../services/inventory.js");
const { autoMoveset } = await import("../utils/battle/moveset.js");
const { isSpeciesKey, parseFormKey, getForm } = await import("../utils/forms.js");

const F = MEGAS.forms;
const byId = Object.fromEntries(F.map((f) => [f.id, f]));

section("Validation gate (npm run validate:megas)");
const problems = await megaProblems();
assertEqual(problems, [], "megaProblems() finds nothing: catalogue, stones, items, sprites, SHA-256 and ability manifest agree");

section("Catalogue completeness");
assertEqual(F.length, 97, "97 catalogue records");
assertEqual(MEGAS.totals.officialForms, 93, "93 official Mega forms (Meowstic M/F, Tatsugiri ×3 and Magearna/Original counted once)");
assertEqual(new Set(F.map((f) => f.species)).size, 87, "87 base species");
assertEqual(MEGAS.stones.length, 92, "92 Mega Stones");
assertEqual([MEGAS.totals.eligibleRecords, MEGAS.totals.blockedRecords], [93, 4], "93 eligible records (90 official forms), 4 blocked");
assertEqual(F.filter((f) => f.introducedIn === "X/Y").length, 30, "X/Y: 30");
assertEqual(F.filter((f) => f.introducedIn === "Omega Ruby/Alpha Sapphire").length, 18, "ORAS: 18");
assertEqual(F.filter((f) => f.introducedIn === "Legends: Z-A").length, 26, "Legends: Z-A base game: 26");
assertEqual(F.filter((f) => f.introducedIn === "Legends: Z-A Mega Dimension").length, 23, "Mega Dimension: 23 records (19 official forms)");
assertTrue(F.every((f) => f.status === "eligible" ? f.blockReasons.length === 0 : f.blockReasons.length > 0), "every blocked record has a reason, no eligible record has one");
assertTrue(F.every((f) => f.launchReady === false), "no form is launch-ready in Phase M0 (D-5)");
assertTrue(!F.some((f) => /primal/i.test(f.id)), "Primal Reversions are not in the Mega catalogue");

section("Identity: never a species, never a dex number");
assertEqual(new Set(F.map((f) => f.id)).size, F.length, "form ids are unique");
assertTrue(F.every((f) => /^mega-[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id)), "ids look like mega-<species>[-variant]");
assertTrue(["mega-charizard-x", "mega-charizard-y", "mega-mewtwo-x", "mega-mewtwo-y", "mega-absol-z", "mega-meowstic-m", "mega-tatsugiri-curly"].every((id) => byId[id]), "required stable ids present");
assertTrue(F.every((f) => !isSpeciesKey(f.id) && parseFormKey(f.id) === null), "a Mega id can't parse as a species key or a form key");
assertEqual(Object.keys(DEX).length, 1025, "no National Dex numbers added (still 1,025 species)");
assertTrue(!Object.values(DEX).some((p) => /^Mega /.test(p.name)), "no species is named Mega …");
assertTrue(F.every((f) => DEX[f.species] && f.species >= 1 && f.species <= 1025), "every Mega belongs to a real base species");
assertEqual(FORMS_JSON.length, 361, "forms.json unchanged (361 records, all still disabled)");
assertTrue(F.filter((f) => f.formKey).every((f) => getForm(f.formKey)?.species === f.species), "existing form keys link to the same species");

section("Stats, types and abilities");
const cx = byId["mega-charizard-x"], cy = byId["mega-charizard-y"];
assertEqual([cx.types, cx.baseStats, cx.ability], [["Fire", "Dragon"], { hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100 }, "Tough Claws"], "Mega Charizard X: Fire/Dragon, 78/130/111/130/85/100, Tough Claws");
assertEqual([cy.types, cy.baseStats.spa, cy.ability], [["Fire", "Flying"], 159, "Drought"], "Mega Charizard Y: Fire/Flying, 159 Sp. Atk, Drought");
assertEqual([byId["mega-mewtwo-x"].types, byId["mega-mewtwo-y"].types], [["Psychic", "Fighting"], ["Psychic"]], "Mega Mewtwo X/Y typings");
assertEqual(byId["mega-zygarde"].baseStats.hp, 216, "Mega Zygarde HP 216 (from Complete Forme)");
assertEqual(F.filter((f) => f.hpChangesFromBot).map((f) => f.id), ["mega-chimecho", "mega-floette", "mega-zygarde"], "only Chimecho, Floette and Zygarde change base HP vs the bot's stored base");
assertTrue(F.every((f) => f.source.statsAndTypesCrossChecked && f.source.pokeapi.startsWith("e2710d30")), "stats and types cross-checked against PokéAPI e2710d30 for every record");
assertEqual([byId["mega-heatran"].ability, byId["mega-tatsugiri-droopy"].ability], ["Flash Fire", "Commander"], "D-11: slot 0 for Mega Heatran and Mega Tatsugiri");
assertTrue(byId["mega-heatran"].abilityVerification.startsWith("unverified") && byId["mega-heatran"].abilityVerification.includes("D-11"), "D-11 choice recorded as unverified");
assertTrue(F.filter((f) => f.introducedIn.startsWith("Legends")).every((f) => f.abilityVerification.startsWith("unverified")), "all Z-A abilities are marked unverified");
assertTrue(F.filter((f) => !f.introducedIn.startsWith("Legends")).every((f) => f.abilityVerification.startsWith("verified")), "X/Y and ORAS abilities are marked verified");

section("Ability implementation manifest (D-5)");
assertEqual(ABILITIES.length, 69, "69 distinct abilities across all slots");
const cats = ABILITIES.reduce((a, x) => ((a[x.category] = (a[x.category] || 0) + 1), a), {});
assertEqual([cats.supported ?? 0, cats["current-engine"], cats["new-system"], cats["no-effect"]], [0, 34, 20, 15], "0 already supported / 34 current engine / 20 new system / 15 no effect");
const { ABILITY_REGISTRY } = await import("../utils/battle/abilities.js");
assertTrue(ABILITIES.every((a) => a.implemented === (ABILITY_REGISTRY[a.name]?.status === "implemented") && a.registryStatus === ABILITY_REGISTRY[a.name]?.status), "M2: implemented in the manifest equals the battle ability registry (nothing claimed without code)");
assertTrue(ABILITIES.filter((a) => a.category === "new-system").every((a) => a.requires.length > 0), "every new-system ability names the systems it needs");
assertEqual(ABILITIES.filter((a) => a.moveFlags.length).length, 8, "8 abilities need move flags");
const simSrc = fs.readFileSync(new URL("../utils/battle/sim.js", import.meta.url), "utf8");
assertTrue(simSrc.includes("No abilities (except Shedinja's") && /return simulateBattleFx\(/.test(simSrc), "M2: the legacy loop still models no abilities; battles with an ability are handed to the effects engine");
assertTrue(!Object.values(BATTLE.moves).some((m) => m.flags), "battleData.json stays unchanged: move flags live in data/battle/move-flags.json");

section("Special cases");
const ray = byId["mega-rayquaza"];
assertEqual([ray.status, ray.prerequisite], ["blocked", { kind: "move", move: "dragonascent", moveName: "Dragon Ascent" }], "Mega Rayquaza: blocked, requires Dragon Ascent, no stone (D-9)");
assertTrue(!MEGAS.stones.some((s) => s.forms.includes("mega-rayquaza")) && !items.listCatalog().some((i) => /rayquaz/.test(i.id)), "no invented Rayquaza stone");
assertTrue(!!BATTLE.moves.dragonascent, "Dragon Ascent exists in the move table");
assertTrue(!Object.values(BATTLE.species).some((s) => s.levelMoves.some(([, m]) => m === "dragonascent")), "no species learns Dragon Ascent by level-up in the bot");
assertTrue([1, 25, 50, 75, 100].every((lv) => !autoMoveset(384, lv).includes("dragonascent")), "Rayquaza's automatic moveset never contains Dragon Ascent (prerequisite unmet)");
assertEqual([byId["mega-floette"].status, byId["mega-floette"].requiresForme], ["blocked", "Floette-Eternal"], "Mega Floette blocked: needs Floette-Eternal (D-16)");
assertEqual([byId["mega-zygarde"].status, byId["mega-zygarde"].requiresForme, byId["mega-zygarde"].sprite.normal], ["blocked", "Zygarde-Complete", null], "Mega Zygarde blocked: needs Complete Forme and has no sprite (D-16)");
assertEqual([byId["mega-magearna"].status, byId["mega-magearna-original"].status], ["eligible", "blocked"], "Magearna: standard Mega only (D-8)");
assertEqual([byId["mega-meowstic-m"].variant, byId["mega-meowstic-f"].variant], [{ kind: "gender", value: "m", decision: "D-6" }, { kind: "gender", value: "f", decision: "D-6" }], "Meowstic: gender variants (D-6)");
assertEqual(["curly", "droopy", "stretchy"].map((a) => byId[`mega-tatsugiri-${a}`].variant.value), ["curly", "droopy", "stretchy"], "Tatsugiri: appearance variants (D-7)");
assertEqual(F.filter((f) => /-[xyz]$/.test(f.id)).map((f) => f.id), ["mega-charizard-x", "mega-charizard-y", "mega-raichu-x", "mega-raichu-y", "mega-mewtwo-x", "mega-mewtwo-y", "mega-absol-z", "mega-lucario-z", "mega-garchomp-z"].sort((a, b) => byId[a].species - byId[b].species || a.localeCompare(b)), "multi-form species: Charizard, Raichu, Mewtwo (X/Y); Absol, Garchomp, Lucario (Mega Z)");

section("Mega Stones, Shards and vouchers");
const stoneItems = items.listCatalog().filter((i) => i.id.startsWith("megastone_"));
assertEqual(stoneItems.length, 92, "92 stone items in catalog/items.js");
assertEqual(new Set(items.listCatalog().map((i) => i.id)).size, items.listCatalog().length, "no duplicate item ids");
assertTrue(items.listCatalog().every((i) => items.ITEM_ID_PATTERN.test(i.id)), "every item id matches the id pattern");
assertTrue(stoneItems.every((i) => i.status === "defined" && !i.shop && !i.tradable && i.consumable && i.storage === "inventory"), "stones: defined, no shop entry, not tradable, consumable inventory items");
assertTrue(stoneItems.every((i) => i.category === "evolution" && items.CATEGORIES[i.category]), "stones use an existing category (inventory menus unchanged)");
assertEqual(Object.keys(items.CATEGORIES).length, 8, "no new inventory category");
assertTrue(["mega_shard", "mega_stone_voucher", "mega_stone_voucher_legendary"].every((id) => items.getCatalogItem(id)?.status === "defined"), "Mega Shard and vouchers defined (not obtainable)");
assertTrue([...stoneItems, items.getCatalogItem("mega_shard")].every((i) => !inv.grantItem({ items: {} }, i.id, 1).ok), "grantItem refuses every stone and the shard");
assertTrue(stoneItems.every((i) => !items.isHoldable(i.id)), "no stone is holdable yet");
const restricted = MEGAS.stones.filter((s) => s.acquisition === "milestone-or-event-only").map((s) => s.id).sort();
assertEqual(restricted, ["megastone_darkranite", "megastone_diancite", "megastone_heatranite", "megastone_latiasite", "megastone_latiosite", "megastone_magearnite", "megastone_mewtwonitex", "megastone_mewtwonitey", "megastone_zeraorite", "megastone_zygardite"], "the 10 Legendary/Mythical stones are milestone/event only (D-15)");
assertTrue(stoneItems.filter((i) => restricted.includes(i.id)).every((i) => i.rarity === "legendary" && i.sources.every((s) => ["milestone_voucher", "event"].includes(s))), "restricted stones have no random source");
assertEqual(M.megasForStone("megastone_meowsticite").map((f) => f.id), ["mega-meowstic-f", "mega-meowstic-m"], "Meowsticite unlocks either Meowstic gender");
assertEqual(M.megasForStone("megastone_tatsugirinite").length, 3, "Tatsugirinite maps to the 3 appearances");
assertTrue(MEGAS.stones.every((s) => s.forms.every((id) => byId[id].species === s.species)), "every stone maps only to forms of its own species");
const { MEGA_REWARDS } = await import("../config/megaRewards.js");
assertEqual([MEGA_REWARDS.active, MEGA_REWARDS.shards, MEGA_REWARDS.randomDrops.maxPerIsoWeek, MEGA_REWARDS.randomDrops.battleWin.enabled], [false, { perRandomDrop: 2, perDuplicateStone: 5, costPerRegularStone: 25 }, 2, false], "economy config: inactive; D-12 shards, D-13 weekly cap 2, D-14 no battle drops");

finish();
