// ==========================================================
// tools/live-event-odds.mjs — what a Live event does to a random roll.
// Same numbers as the admin dashboard's preview (routes/liveEventsAdmin.js).
//
//   node tools/live-event-odds.mjs '<effects JSON>' [pokeball|greatball|ultraball]
//   e.g. node tools/live-event-odds.mjs '[{"kind":"catchLimit","match":{"regions":["Kanto"]}}]'
//
// A Novice player's roll (no Rank bonuses), with the generations that are
// live in this environment (POKEMON_GENERATIONS).
// ==========================================================

import { previewOdds } from "../routes/liveEventsAdmin.js";
import { cleanEvent } from "../utils/liveEventRules.js";

const effects = JSON.parse(process.argv[2] || "[]");
const ball = process.argv[3] || "pokeball";
const now = Date.now();
const r = cleanEvent({ name: "preview", startAt: now, endAt: now + 3600_000, effects });
if (r.error) {
  console.error(r.error);
  process.exit(1);
}
const o = previewOdds({ ...r.event, id: 0 }, [], ball);
const pct = (v) => `${(v * 100).toFixed(2)}%`.padStart(8);
console.log(`Ball: ${ball}\nSpecies: ${o.normal.species} normally, ${o.during.species} during\n`);
console.log("Tier        normally   during");
for (const t of Object.keys(o.normal.tiers)) console.log(`${t.padEnd(10)}${pct(o.normal.tiers[t])} ${pct(o.during.tiers[t])}`);
console.log("\nMost likely single Pokémon during:");
for (const s of o.during.top) console.log(`  ${s.name.padEnd(14)}${pct(s.chance)}  (normally ${pct(s.before).trim()})`);
process.exit(0);
