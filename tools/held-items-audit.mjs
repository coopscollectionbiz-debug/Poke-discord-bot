// ==========================================================
// tools/held-items-audit.mjs — READ-ONLY migration dry run for held items.
//
// Usage: node tools/held-items-audit.mjs <path/to/trainerData.json>
//
// Loads a COPY of player data into memory and, for every record:
//   1. runs the load-time repair this release adds (normalizeEquipment)
//      after the existing team cleaning, and checks it changes nothing for
//      records that have no held-item data (all of them today);
//   2. simulates the starter grant (flags on, in memory only) and checks it
//      only adds the eight unlocks + the entitlement marker — never touching
//      Pokémon, Levels, CC, other items, teams, trainers or progression;
//   3. runs it twice to prove it is idempotent.
// Prints aggregates only (no ids or names). Never writes any file.
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import { validateUserSchema } from "../utils/userSchema.js";
import { normalizeDisplayedTeam } from "../services/megaTeam.js";
import { normalizeBattleTeam } from "../services/battleTeam.js";
import { normalizeEquipment, ensureStarterHeldItems } from "../services/heldItems.js";
import { STARTER_HELD_ITEMS } from "../catalog/heldItems.js";

const file = process.argv[2];
if (!file) { console.error("usage: node tools/held-items-audit.mjs <trainerData.json>"); process.exit(2); }
const raw = fs.readFileSync(file, "utf8");
const sha = crypto.createHash("sha256").update(raw).digest("hex");
const data = JSON.parse(raw);
const ON = { HELD_ITEMS_ENABLED: "1" };
const PROTECTED = ["pokemon", "training", "cc", "tp", "displayedPokemon", "battleTeam", "movesets", "megaUnlocks", "trainers", "displayedTrainer", "battle", "casual", "progression", "achievements", "purchases", "lastDaily"];
const fp = (u, keys) => crypto.createHash("sha256").update(JSON.stringify(keys.map((k) => [k, u[k] ?? null]))).digest("hex");
const itemsExcept = (u, skip) => JSON.stringify(Object.entries(u.items ?? {}).filter(([k]) => !skip.includes(k)).sort());

const stats = { records: 0, withEquipment: 0, repairChanged: 0, grantRecords: 0, unlocksGranted: 0, alreadyOwned: 0, protectedChanged: 0, otherItemsChanged: 0, secondGrantChanged: 0, errors: 0 };
for (const [id, original] of Object.entries(data)) {
  stats.records++;
  try {
    const u = structuredClone(original);
    // The existing load path (same order as bot_final normalizeUserSchema).
    validateUserSchema(u, id, u.name);
    normalizeDisplayedTeam(u);
    normalizeBattleTeam(u);
    if ("equipment" in u) stats.withEquipment++;
    const before = JSON.stringify(u);
    normalizeEquipment(u);
    if (JSON.stringify(u) !== before) stats.repairChanged++;

    const prot = fp(u, PROTECTED);
    const others = itemsExcept(u, STARTER_HELD_ITEMS);
    stats.alreadyOwned += STARTER_HELD_ITEMS.filter((i) => (u.items?.[i] ?? 0) > 0).length;
    const g = ensureStarterHeldItems(u, { env: ON });
    if (g.changed) stats.grantRecords++;
    stats.unlocksGranted += g.granted.length;
    if (fp(u, PROTECTED) !== prot) stats.protectedChanged++;
    if (itemsExcept(u, STARTER_HELD_ITEMS) !== others) stats.otherItemsChanged++;
    const once = JSON.stringify(u);
    ensureStarterHeldItems(u, { env: ON });
    if (JSON.stringify(u) !== once) stats.secondGrantChanged++;
  } catch (err) {
    stats.errors++;
    if (stats.errors <= 3) console.error(`record failed: ${err?.message || err}`);
  }
}
const ok = stats.repairChanged === 0 && stats.protectedChanged === 0 && stats.otherItemsChanged === 0 && stats.secondGrantChanged === 0 && stats.errors === 0
  && stats.unlocksGranted + stats.alreadyOwned === stats.records * STARTER_HELD_ITEMS.length;
console.log(JSON.stringify({ input: { sha256: sha, bytes: raw.length }, ...stats, verdict: ok ? "PASS" : "FAIL" }, null, 2));
process.exit(ok ? 0 : 1);
