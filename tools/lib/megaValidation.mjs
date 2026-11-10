// ==========================================================
// tools/lib/megaValidation.mjs — every structural check on the Mega
// catalogue, sprites and items, as one function returning a list of
// problems ([] = valid). Used by `npm run validate:megas` and by
// tests/megaCatalog.test.js, so the release gate and the tests can't drift.
// ==========================================================

import fs from "fs";
import crypto from "crypto";

const ROOT = new URL("../../", import.meta.url);
const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, ROOT), "utf8"));
const SK = ["hp", "atk", "def", "spa", "spd", "spe"];
const TYPES = ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy"];

export const EXPECTED = Object.freeze({
  records: 97, officialForms: 93, species: 87, stones: 92, eligibleRecords: 93, blockedRecords: 4,
  blocked: ["mega-floette", "mega-magearna-original", "mega-rayquaza", "mega-zygarde"],
  spriteForms: 95, animated: 24, abilities: 69,
  abilityCategories: { "current-engine": 34, "new-system": 20, "no-effect": 15, supported: 0 },
});

export async function megaProblems() {
  const out = [];
  const megas = read("data/pokedex/megas.json");
  const sprites = read("data/sprites/megas.json");
  const abilities = read("data/pokedex/mega-abilities.json").abilities;
  const dex = read("pokemonData.json");
  const { listCatalog, getCatalogItem } = await import("../../catalog/items.js");
  const forms = megas.forms;
  const ids = forms.map((f) => f.id);

  // ---- totals ----
  const t = megas.totals;
  for (const k of ["records", "officialForms", "species", "stones", "eligibleRecords", "blockedRecords"]) if (t[k] !== EXPECTED[k]) out.push(`totals.${k} = ${t[k]}, expected ${EXPECTED[k]}`);
  if (forms.length !== t.records) out.push("forms.length disagrees with totals.records");
  if (t.launchReady !== 0 || forms.some((f) => f.launchReady)) out.push("a Mega form is launchReady in Phase M0");
  const blocked = forms.filter((f) => f.status === "blocked").map((f) => f.id).sort();
  if (JSON.stringify(blocked) !== JSON.stringify(EXPECTED.blocked)) out.push(`blocked forms ${blocked}`);

  // ---- identity ----
  if (new Set(ids).size !== ids.length) out.push("duplicate Mega form ids");
  for (const f of forms) {
    const tag = f.id;
    if (!/^mega-[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id)) out.push(`${tag}: malformed id`);
    if (/^\d+$/.test(f.id) || f.id.includes(":")) out.push(`${tag}: id looks like a species or form key`);
    if (!dex[f.species] || dex[f.species].name !== f.baseSpecies.replace(/-.*$/, "") && dex[f.species].name !== f.baseSpecies) out.push(`${tag}: base species #${f.species} mismatch (${dex[f.species]?.name} vs ${f.baseSpecies})`);
    if (!f.name.startsWith("Mega ")) out.push(`${tag}: display name`);
    if (!Array.isArray(f.types) || f.types.length < 1 || f.types.length > 2 || f.types.some((x) => !TYPES.includes(x))) out.push(`${tag}: types`);
    if (f.typeIds.some((id, i) => TYPES[id - 1] !== f.types[i])) out.push(`${tag}: typeIds disagree with types`);
    if (SK.some((k) => !Number.isInteger(f.baseStats[k]) || f.baseStats[k] < 1 || f.baseStats[k] > 255)) out.push(`${tag}: base stats`);
    if (SK.reduce((a, k) => a + f.baseStats[k], 0) !== f.bst) out.push(`${tag}: bst`);
    if (!f.ability || !Object.values(f.abilitySlots).includes(f.ability)) out.push(`${tag}: ability`);
    if (!abilities.some((a) => a.name === f.ability && a.megas.includes(f.id))) out.push(`${tag}: ability missing from the manifest`);
    if (!f.source?.statsAndTypesCrossChecked) out.push(`${tag}: not cross-checked`);
    if (f.status === "blocked" && !f.blockReasons.length) out.push(`${tag}: blocked without a reason`);
    if (f.status === "eligible" && f.blockReasons.length) out.push(`${tag}: eligible with block reasons`);
    if (f.prerequisite.kind === "stone" && !megas.stones.some((s) => s.id === f.prerequisite.item && s.forms.includes(f.id))) out.push(`${tag}: stone mapping`);
    if (f.prerequisite.kind === "move" && (f.id !== "mega-rayquaza" || f.prerequisite.move !== "dragonascent")) out.push(`${tag}: unexpected move prerequisite`);
  }

  // ---- stones and items ----
  const stoneIds = megas.stones.map((s) => s.id);
  if (new Set(stoneIds).size !== stoneIds.length) out.push("duplicate stone ids");
  const allItemIds = listCatalog().map((i) => i.id);
  if (new Set(allItemIds).size !== allItemIds.length) out.push("duplicate item ids in catalog/items.js");
  for (const s of megas.stones) {
    const item = getCatalogItem(s.id);
    if (!item) { out.push(`${s.id}: not in catalog/items.js`); continue; }
    if (item.status !== "defined") out.push(`${s.id}: status ${item.status} (must stay "defined" in M0)`);
    if (item.shop) out.push(`${s.id}: has a shop entry`);
    if (item.tradable) out.push(`${s.id}: tradable`);
    if (!item.consumable || item.storage !== "inventory") out.push(`${s.id}: must be a consumable inventory item`);
    if (s.forms.some((id) => forms.find((f) => f.id === id)?.species !== s.species)) out.push(`${s.id}: maps to another species`);
    const restricted = ["legendary", "mythical"].includes(s.officialStatus);
    if (restricted !== (s.acquisition === "milestone-or-event-only")) out.push(`${s.id}: acquisition restriction`);
    if (restricted && item.sources.some((src) => !["milestone_voucher", "event"].includes(src))) out.push(`${s.id}: Legendary/Mythical stone has a random source`);
  }
  for (const id of ["mega_shard", "mega_stone_voucher", "mega_stone_voucher_legendary"]) {
    const i = getCatalogItem(id);
    if (!i || i.status !== "defined" || i.shop) out.push(`${id}: must exist, be "defined" and have no shop entry`);
  }

  // ---- sprites ----
  const spriteForms = Object.keys(sprites.forms);
  if (spriteForms.length !== EXPECTED.spriteForms) out.push(`sprite forms ${spriteForms.length}`);
  const animated = Object.values(sprites.forms).filter((r) => r.normal.kind === "animated").length;
  if (animated !== EXPECTED.animated) out.push(`animated forms ${animated}`);
  for (const f of forms) {
    const rec = sprites.forms[f.id];
    const wanted = !!f.sprite.normal;
    if (wanted !== !!rec) out.push(`${f.id}: catalogue sprite ${wanted} but manifest ${!!rec}`);
    if (!rec) continue;
    for (const v of ["normal", "shiny", "grayscale"]) {
      const file = new URL(`public/sprites/pokemon/mega/${rec[v].file}`, ROOT);
      if (!fs.existsSync(file)) { out.push(`${f.id}: ${v} file missing`); continue; }
      const buf = fs.readFileSync(file);
      if (crypto.createHash("sha256").update(buf).digest("hex") !== rec[v].fileSha256) out.push(`${f.id}: ${v} SHA-256 mismatch`);
      if (crypto.createHash("sha1").update(buf).digest("hex") !== rec[v].fileSha1) out.push(`${f.id}: ${v} SHA-1 mismatch`);
      if (buf.subarray(0, 6).toString("latin1") !== "GIF89a") out.push(`${f.id}: ${v} is not a GIF89a`);
    }
    if (rec.normal.fileSha1 === rec.shiny.fileSha1 || rec.normal.firstFrameSha1 === rec.shiny.firstFrameSha1) out.push(`${f.id}: shiny equals normal`);
    if (!/^https:\/\/(play\.pokemonshowdown\.com|raw\.githubusercontent\.com\/PokeAPI)\//.test(rec.normal.sourceUrl)) out.push(`${f.id}: unexpected sprite source`);
    if (/\/sprites\/(ani|dex|home|gen6)\//.test(rec.normal.sourceUrl + rec.shiny.sourceUrl)) out.push(`${f.id}: 3D source`);
    if (!rec.credit) out.push(`${f.id}: no credit`);
  }

  // ---- abilities ----
  if (abilities.length !== EXPECTED.abilities) out.push(`abilities ${abilities.length}`);
  const cats = { "current-engine": 0, "new-system": 0, "no-effect": 0, supported: 0 };
  for (const a of abilities) cats[a.category] = (cats[a.category] ?? 0) + 1;
  if (JSON.stringify(cats) !== JSON.stringify(EXPECTED.abilityCategories)) out.push(`ability categories ${JSON.stringify(cats)}`);
  const { ABILITY_REGISTRY } = await import("../../utils/battle/abilities.js");
  for (const a of abilities) {
    const r = ABILITY_REGISTRY[a.name];
    if (!r) out.push(`ability ${a.name} missing from the battle registry`);
    else if (a.implemented !== (r.status === "implemented")) out.push(`ability ${a.name}: manifest and registry disagree`);
  }
  if (abilities.some((a) => a.category === "new-system" && !a.requires.length)) out.push("a new-system ability lists no requirement");
  return out;
}
