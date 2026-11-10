// ==========================================================
// tools/import-trainer-credits.mjs — builds data/sprites/trainer-credits.json
// from Pokémon Showdown's trainer-sprite credits, limited to the trainer
// sprites this bot actually ships (public/sprites/trainers_2/*.png).
//
// Showdown keeps the credits in its client repo:
//   smogon/pokemon-showdown-client → play.pokemonshowdown.com/sprites/trainers/index.php
// ("Many of these sprites are not from the games. Credit must be given to the
//  appropriate artist if used elsewhere.")
//
// Run: node tools/import-trainer-credits.mjs <path to that index.php>
// then: npm run generate:credits
// ==========================================================

import fs from "fs";

const ROOT = new URL("..", import.meta.url);
const src = process.argv[2];
if (!src) {
  console.error("usage: node tools/import-trainer-credits.mjs <showdown sprites/trainers/index.php>");
  process.exit(1);
}

// Community-drawn trainer sprites that Showdown hosts without naming an artist
// (Smogon's sprite repo lists them as "noncanonical"; none is a game rip).
const UNCREDITED_COMMUNITY = [
  "ash.png", "ash-alola.png", "ash-capbackward.png", "ash-hoenn.png", "ash-johto.png", "ash-kalos.png",
  "ash-sinnoh.png", "ash-unova.png", "clemont.png", "juniper.png", "teamrocket.png", "unknown.png",
  "unknownf.png", "yellow.png",
];

const shipped = new Set(fs.readdirSync(new URL("public/sprites/trainers_2/", ROOT)).filter((f) => f.endsWith(".png")));
const php = fs.readFileSync(src, "utf8");
const credited = {};
for (const m of php.matchAll(/"([^"]+\.png)"\s*=>\s*"([^"]+)"/g)) if (shipped.has(m[1])) credited[m[1]] = m[2];

const sorted = Object.fromEntries(Object.entries(credited).sort(([a], [b]) => a.localeCompare(b)));
const out = {
  source: "https://github.com/smogon/pokemon-showdown-client/blob/master/play.pokemonshowdown.com/sprites/trainers/index.php",
  hostedAt: "https://play.pokemonshowdown.com/sprites/trainers/",
  note: "Artists of community-drawn trainer sprites, as credited by Pokémon Showdown. Showdown credits no artist for the other shipped trainer sprites; they are game sprites, apart from those listed in uncreditedCommunity.",
  credited: sorted,
  uncreditedCommunity: UNCREDITED_COMMUNITY.filter((f) => shipped.has(f)),
};
fs.writeFileSync(new URL("data/sprites/trainer-credits.json", ROOT), JSON.stringify(out, null, 2) + "\n");
const artists = new Set(Object.values(sorted));
console.log(`trainer credits: ${Object.keys(sorted).length} credited files by ${artists.size} artists; ${out.uncreditedCommunity.length} community files without a listed artist; ${shipped.size} shipped`);
