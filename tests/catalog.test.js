// ==========================================================
// tests/catalog.test.js
// Every trainer tier must be one of the known rarities (D12: a typo,
// "Uncommmon", made one trainer miss tier lookups), and the public copy of
// the catalog must match the server copy.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const TIERS = new Set(["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]);
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

function tiersOf(catalog) {
  const out = [];
  for (const group of Object.values(catalog)) {
    for (const entry of Array.isArray(group) ? group : [group]) {
      if (entry && typeof entry === "object" && "tier" in entry) out.push(entry.tier);
    }
  }
  return out;
}

section("Trainer catalog tiers");
for (const f of ["trainerSprites.json", "public/trainerSprites.json"]) {
  const tiers = tiersOf(read(f));
  const bad = [...new Set(tiers.filter((t) => !TIERS.has(t)))];
  assertTrue(tiers.length > 500, `${f}: ${tiers.length} trainers have a tier`);
  assertEqual(bad, [], `${f}: every tier is a known rarity`);
}

section("Server and public copies agree");
assertEqual(read("trainerSprites.json"), read("public/trainerSprites.json"), "trainerSprites.json matches public/trainerSprites.json");

// Catalog hygiene (collectible rarity audit, 2026-11-10).
section("Every sprite file belongs to exactly one group");
{
  const catalog = read("trainerSprites.json");
  const owner = new Map();
  const dupes = [];
  for (const [key, group] of Object.entries(catalog)) {
    for (const s of group.sprites || []) {
      const file = String(typeof s === "string" ? s : s.file).toLowerCase();
      if (owner.has(file)) dupes.push(`${file} (${owner.get(file)} + ${key})`);
      else owner.set(file, key);
    }
  }
  // A file listed twice showed two prices in the picker while the server
  // charged the first group's tier, and achievements counted the last one.
  assertEqual(dupes, [], "no sprite file is listed in two groups");
  assertEqual(["che", "clif", "railstaf", "leaguestaf"].filter((k) => k in catalog), [], "typo group keys are gone (keys are shown as names)");
  assertEqual(["chef", "cliff", "railstaff", "leaguestaff", "leaguestafff"].map((k) => catalog[k]?.sprites?.[0]), ["chef.png", "cliff.png", "railstaff.png", "leaguestaff.png", "leaguestafff.png"], "renamed groups keep their sprites");
}

section("Flattened trainers only offer real, enabled sprites");
{
  const { flattenTrainerSprites } = await import("../utils/dataLoader.js");
  const flat = flattenTrainerSprites(read("trainerSprites.json"));
  const missing = flat.flatMap((t) => t.sprites).filter((f) => !fs.existsSync(new URL(`../public/sprites/trainers_2/${f}`, import.meta.url)));
  assertEqual(missing, [], "every flattened sprite exists in public/sprites/trainers_2");
  const allDisabled = flattenTrainerSprites({
    ghost: { sprites: [{ file: "ghost-gen1.png", disabled: true }], tier: "Rare" },
    kept: { sprites: [{ file: "kept-gen1.png", disabled: true }, "kept.png"], tier: "Common" },
  });
  assertEqual(allDisabled.map((t) => [t.id, t.spriteFile]), [["kept", "kept.png"]], "a group with only disabled sprites is skipped (no invented <key>.png)");
}

finish();
