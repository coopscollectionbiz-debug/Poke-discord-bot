// ==========================================================
// tools/migrate-battle-teams.mjs — B7, the one-time Battle team move-over.
//
// For every player WITHOUT a Battle team: copy the Display team
// (displayedPokemon, cleaned the same way the bot cleans it, Mega kept) into
// battleTeam, keep the first mythic-tier Pokémon and drop later ones, and
// record battleTeamMigration = { at, dropped } for the dashboard notice.
// Idempotent: players who already have battleTeam are untouched.
// Logic lives in services/battleTeam.js (moveOverBattleTeam).
//
//   node tools/migrate-battle-teams.mjs <trainerData.json>                 dry run (default): report only
//   node tools/migrate-battle-teams.mjs <trainerData.json> --out <file>    write the migrated copy to <file>
//
// It NEVER writes the input file and never talks to the bot or storage.
// Running it against production data, or applying the result, needs the
// owner's explicit approval (production data change).
// ==========================================================

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : null;
if (!input) {
  console.error("usage: node tools/migrate-battle-teams.mjs <trainerData.json> [--out <file>]");
  process.exit(2);
}
if (out && path.resolve(out) === path.resolve(input)) {
  console.error("Refusing to overwrite the input file. Choose a different --out path.");
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const { moveOverBattleTeam, hasBattleTeam } = await import(pathToFileURL(path.join(root, "services/battleTeam.js")).href);
const { getSpeciesEntry } = await import(pathToFileURL(path.join(root, "utils/speciesCatalog.js")).href);

const data = JSON.parse(fs.readFileSync(input, "utf8"));
const now = Date.now();
const report = { players: 0, alreadyHad: 0, migrated: 0, emptyTeams: 0, withDropped: 0, droppedSlots: 0, droppedBySpecies: {} };

for (const [id, user] of Object.entries(data)) {
  if (!user || typeof user !== "object") continue;
  report.players++;
  if (hasBattleTeam(user)) { report.alreadyHad++; continue; }
  const r = moveOverBattleTeam(user, { now });
  if (!r) continue;
  report.migrated++;
  if (r.copied === 0) report.emptyTeams++;
  if (r.dropped.length) {
    report.withDropped++;
    report.droppedSlots += r.dropped.length;
    for (const s of r.dropped) {
      const name = getSpeciesEntry(s.id)?.name ?? `#${s.id}`;
      report.droppedBySpecies[name] = (report.droppedBySpecies[name] ?? 0) + 1;
    }
  }
}

console.log(JSON.stringify({ mode: out ? "write-copy" : "dry-run", input: path.basename(input), ...report }, null, 2));
if (out) {
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Migrated copy written to ${out} (input unchanged).`);
}
