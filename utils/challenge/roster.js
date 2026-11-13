// ==========================================================
// utils/challenge/roster.js
// The fixed Kanto teams players face in /challenge, and the prize for a
// first win. Teams start from FireRed/LeafGreen and are filled to 6 from
// later canon teams; Levels are shifted so each ace hits its target, and
// they're written out literally (see the challenges spec, Draft rosters).
// ==========================================================

import fs from "fs";
import { GYM_BADGES } from "../../public/picker-pokemon/badges.js";

const trainerSprites = JSON.parse(fs.readFileSync(new URL("../../trainerSprites.json", import.meta.url), "utf8"));

const team = (...pairs) => pairs.map(([speciesId, level]) => ({ speciesId, level }));
const opponent = (key, name, title, type, trainerKey, members) => ({ key, name, title, type, trainerKey, team: members });
const gymLeader = (key, trainerKey, members) => {
  const b = GYM_BADGES.find((x) => x.key === key);
  return opponent(key, b.leader, "Gym Leader", b.type, trainerKey, members);
};
const prize = (cc, stones, dust) => ({ cc, stones, dust });

const gym = (key, trainerKey, p, members) => ({
  key,
  label: GYM_BADGES.find((b) => b.key === key).leader,
  kind: "gym",
  prize: p,
  opponents: [gymLeader(key, trainerKey, members)],
  badge: GYM_BADGES.find((b) => b.key === key),
});

export const CHALLENGES = {
  brock: gym("brock", "brock", prize(2500, 1, 5),
    team([74, 23], [95, 25], [141, 24], [139, 24], [142, 24], [76, 24])),
  misty: gym("misty", "misty", prize(3000, 1, 5),
    team([120, 27], [121, 30], [55, 29], [87, 29], [134, 29], [130, 29])),
  surge: gym("surge", "ltsurge", prize(4000, 1, 10),
    team([100, 32], [25, 29], [26, 35], [125, 32], [82, 32], [135, 32])),
  erika: gym("erika", "erika", prize(5000, 1, 10),
    team([71, 40], [114, 35], [45, 40], [47, 38], [103, 38], [182, 38])),
  koga: gym("koga", "koga", prize(6000, 2, 15),
    team([109, 38], [109, 38], [89, 40], [110, 44], [42, 40], [49, 40])),
  sabrina: gym("sabrina", "sabrina", prize(7500, 2, 15),
    team([64, 43], [122, 42], [49, 43], [65, 48], [97, 44], [80, 44])),
  blaine: gym("blaine", "blaine", prize(9000, 2, 20),
    team([58, 48], [77, 46], [78, 48], [59, 53], [126, 49], [38, 49])),
  giovanni: gym("giovanni", "giovanni", prize(12000, 3, 25),
    team([111, 53], [51, 50], [31, 52], [34, 53], [112, 58], [53, 53])),
  elite4: {
    key: "elite4",
    label: "Elite Four",
    kind: "elite4",
    prize: prize(30000, 4, 40),
    opponents: [
      opponent("lorelei", "Lorelei", "Elite Four", "Ice", "lorelei",
        team([87, 54], [91, 53], [80, 54], [124, 56], [131, 56], [221, 55])),
      opponent("bruno", "Bruno", "Elite Four", "Fighting", "bruno",
        team([95, 52], [107, 54], [106, 54], [95, 55], [68, 57], [62, 54])),
      opponent("agatha", "Agatha", "Elite Four", "Ghost", "agatha",
        team([94, 54], [42, 54], [93, 53], [24, 56], [94, 58], [110, 55])),
      opponent("lance", "Lance", "Elite Four", "Dragon", "lance",
        team([130, 56], [148, 54], [148, 54], [142, 58], [149, 60], [6, 56])),
    ],
  },
  blue: {
    key: "blue",
    label: "Blue",
    kind: "champion",
    prize: prize(50000, 5, 60),
    opponents: [opponent("blue", "Blue", "Champion", null, "blue",
      team([18, 71], [65, 69], [112, 71], [59, 71], [103, 73], [9, 75]))],
  },
  red: {
    key: "red",
    label: "Red",
    kind: "red",
    prize: prize(100000, 6, 120),
    opponents: [opponent("red", "Red", "Pokémon Trainer", null, "red",
      team([25, 88], [131, 80], [143, 82], [3, 84], [6, 84], [9, 84]))],
  },
};

export const CHALLENGE_KEYS = Object.keys(CHALLENGES);

export const opponentName = (o) => `${o.title} ${o.name}`;

// trainerSprites.json lists a sprite as a filename, or { file, disabled } when it can't be unlocked.
export function enabledSprites(trainerKey) {
  const entry = trainerSprites[trainerKey];
  const files = entry.sprites
    .filter((s) => typeof s === "string" || !s.disabled)
    .map((s) => (typeof s === "string" ? s : s.file));
  return { files, tier: String(entry.tier).toLowerCase() };
}

export const displaySprite = (o) => enabledSprites(o.trainerKey).files[0];
