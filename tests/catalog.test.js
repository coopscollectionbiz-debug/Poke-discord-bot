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

finish();
