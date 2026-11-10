// ==========================================================
// tests/challengeRoster.test.js
// The Kanto challenge roster, prize table, and Badge definitions
// (docs/superpowers/specs/2026-11-08-challenges-design.md).
// The Badge emoji ID check fails until the 8 Badge emojis are uploaded
// in the Developer Portal and their IDs pasted in (README Setup).
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { existsSync, readFileSync } from "fs";
import { getSpecies } from "../utils/battle/data.js";
import {
  CHALLENGE_KEYS, CHALLENGES, opponentName, enabledSprites, displaySprite,
} from "../utils/challenge/roster.js";
import { GYM_BADGES, earnedBadgeKeys } from "../public/picker-pokemon/badges.js";
import { badgeUrl, badgeLine } from "../utils/challenge/badgeImages.js";
import { spritePaths } from "../spriteconfig.js";

const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
const ace = (o) => Math.max(...o.team.map((m) => m.level));

section("Structure");
assertEqual(CHALLENGE_KEYS, [...GYMS, "elite4", "blue", "red"], "CHALLENGE_KEYS lists the 8 Gyms, then Elite Four, Blue, Red");
assertTrue(CHALLENGE_KEYS.every((k) => CHALLENGES[k]?.key === k), "every key has a CHALLENGES entry");
assertEqual(GYMS.map((k) => CHALLENGES[k].kind), GYMS.map(() => "gym"), "Gyms are kind gym");
assertEqual(["elite4", "blue", "red"].map((k) => CHALLENGES[k].kind), ["elite4", "champion", "red"], "Elite Four, Blue, and Red kinds");
assertEqual(GYMS.map((k) => CHALLENGES[k].opponents.length), GYMS.map(() => 1), "one opponent per Gym");
assertEqual(CHALLENGES.elite4.opponents.map((o) => o.name), ["Lorelei", "Bruno", "Agatha", "Lance"], "the Elite Four run is Lorelei, Bruno, Agatha, Lance");
assertEqual([CHALLENGES.blue.opponents.length, CHALLENGES.red.opponents.length], [1, 1], "Blue and Red fight alone");
const all = CHALLENGE_KEYS.flatMap((k) => CHALLENGES[k].opponents);
assertEqual(new Set(all.map((o) => o.key)).size, 14, "14 distinct opponents");
assertTrue(all.every((o) => o.team.length === 6), "every team has 6 Pokémon");
assertTrue(all.every((o) => o.team.every((m) => getSpecies(m.speciesId))), "every species exists in battleData.json");
assertTrue(all.every((o) => o.team.every((m) => Number.isInteger(m.level) && m.level >= 1 && m.level <= 100)), "every Level is an integer from 1 to 100");
assertEqual(GYMS.map((k) => CHALLENGES[k].badge?.key), GYMS, "each Gym carries its Badge");
assertEqual(GYMS.map((k) => CHALLENGES[k].opponents[0].title), GYMS.map(() => "Gym Leader"), "Gym Leaders are titled Gym Leader");
assertEqual(opponentName(CHALLENGES.brock.opponents[0]), "Gym Leader Brock", "opponentName joins title and name");
assertEqual(opponentName(CHALLENGES.surge.opponents[0]), "Gym Leader Lt. Surge", "Lt. Surge keeps his rank");
assertEqual(opponentName(CHALLENGES.elite4.opponents[1]), "Elite Four Bruno", "Elite Four title");
assertEqual(opponentName(CHALLENGES.blue.opponents[0]), "Champion Blue", "Blue is the Champion");
assertEqual(opponentName(CHALLENGES.red.opponents[0]), "Pokémon Trainer Red", "Red is a Pokémon Trainer");
assertEqual([CHALLENGES.blue.opponents[0].type, CHALLENGES.red.opponents[0].type], [null, null], "Blue and Red have no type");
assertEqual(CHALLENGES.elite4.opponents.map((o) => o.type), ["Ice", "Fighting", "Ghost", "Dragon"], "Elite Four types");
assertEqual(CHALLENGES.surge.opponents[0].trainerKey, "ltsurge", "Lt. Surge's sprite key is ltsurge");

section("Levels (Task 7 may retune; update with it)");
assertEqual(GYMS.map((k) => ace(CHALLENGES[k].opponents[0])), [25, 30, 35, 40, 44, 48, 53, 58], "Gym aces");
assertEqual(CHALLENGES.elite4.opponents.map(ace), [56, 57, 58, 60], "Elite Four aces");
assertEqual(CHALLENGES.elite4.opponents.map((o) => o.team.map((m) => m.level)), [
  [54, 53, 54, 56, 56, 55], [52, 54, 54, 55, 57, 54], [54, 54, 53, 56, 58, 55], [56, 54, 54, 58, 60, 56],
], "the Elite Four are at their draft Levels (the Revive breaks the tie with Blue)");
assertEqual(ace(CHALLENGES.blue.opponents[0]), 75, "Blue's ace");
assertEqual(CHALLENGES.blue.opponents[0].team.at(-1).speciesId, 9, "Blue's ace is Blastoise");
assertEqual(CHALLENGES.red.opponents[0].team.map((m) => m.level), [88, 80, 82, 84, 84, 84], "Red's HGSS Levels");
assertEqual(CHALLENGES.giovanni.opponents[0].team.at(-1).speciesId, 53, "Giovanni's sixth is Persian");

section("Prizes");
assertEqual(CHALLENGE_KEYS.map((k) => CHALLENGES[k].prize), [
  { cc: 2500, stones: 1, dust: 5 }, { cc: 3000, stones: 1, dust: 5 }, { cc: 4000, stones: 1, dust: 10 },
  { cc: 5000, stones: 1, dust: 10 }, { cc: 6000, stones: 2, dust: 15 }, { cc: 7500, stones: 2, dust: 15 },
  { cc: 9000, stones: 2, dust: 20 }, { cc: 12000, stones: 3, dust: 25 }, { cc: 30000, stones: 4, dust: 40 },
  { cc: 50000, stones: 5, dust: 60 }, { cc: 100000, stones: 6, dust: 120 },
], "prizes match the spec table");
const sum = (f) => CHALLENGE_KEYS.reduce((a, k) => a + CHALLENGES[k].prize[f], 0);
assertEqual([sum("cc"), sum("stones"), sum("dust")], [229000, 28, 325], "totals 229,000 CC, 28 stones, 325 Dust");

section("Sprites");
assertTrue(all.every((o) => enabledSprites(o.trainerKey).files.length > 0), "every opponent has an enabled sprite");
assertEqual(enabledSprites("brock"), { files: ["brock-gen3.png", "brock-lgpe.png", "brock.png"], tier: "rare" }, "enabledSprites skips disabled files and lowercases the tier");
assertEqual(displaySprite(CHALLENGES.brock.opponents[0]), "brock-gen3.png", "Brock's display sprite");
assertEqual(displaySprite(CHALLENGES.sabrina.opponents[0]), "sabrina-frlg.png", "Sabrina's display sprite");

section("Badges");
assertEqual(GYM_BADGES.map((b) => b.key), GYMS, "8 Badges in Gym order");
assertEqual(GYM_BADGES[0], { key: "brock", leader: "Brock", badge: "Boulder Badge", type: "Rock", image: "/public/sprites/badges/boulder.png" }, "Brock's Badge entry");
assertEqual(GYM_BADGES.map((b) => b.badge), ["Boulder Badge", "Cascade Badge", "Thunder Badge", "Rainbow Badge", "Soul Badge", "Marsh Badge", "Volcano Badge", "Earth Badge"], "Badge names");
assertEqual(earnedBadgeKeys({ challenge: { won: { misty: "d", brock: "d", red: "d" } } }), ["brock", "misty"], "earnedBadgeKeys: Gym keys only, in Gym order");
assertEqual(earnedBadgeKeys({}), [], "earnedBadgeKeys: none without a record");
{
  // The dashboard shows these files, and the same PNGs are uploaded as the Badge emojis
  // (Discord: 128×128, under 256 KiB). tools/tint-badges.mjs makes them.
  const pngs = GYM_BADGES.map((b) => {
    const file = new URL(`..${b.image}`, import.meta.url);
    if (!existsSync(file)) return { file: b.image, missing: true };
    const bytes = readFileSync(file);
    return { file: b.image, png: bytes.toString("latin1", 1, 4) === "PNG", w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20), size: bytes.length };
  });
  const bad = pngs.filter((p) => p.missing || !p.png || p.w !== 128 || p.h !== 128 || p.size >= 256 * 1024);
  assertEqual(bad.map((p) => p.file), [], "every Badge image is a 128×128 PNG under 256 KiB");
}
// Like trainer sprites: served from the bot's public host, nothing to upload to Discord.
assertEqual(GYMS.map(badgeUrl), GYM_BADGES.map((b) => `${spritePaths.badges}${b.image.split("/").pop()}`), "Badge images come from the sprite host");
assertTrue(badgeUrl("brock").endsWith("/public/sprites/badges/boulder.png"), "the Boulder Badge's image");
assertEqual(badgeLine({}), "🏅 **Badges:** 0/8", "badgeLine with no Badges");
assertEqual(badgeLine({ challenge: { won: { brock: "d", misty: "d", elite4: "d" } } }), "🏅 **Badges:** 2/8 · Boulder, Cascade",
  "badgeLine names the earned Badges in Gym order");

finish();
