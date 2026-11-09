// ==========================================================
// utils/challenge/badgeEmojis.js
// The 8 Badges as the bot application's own emojis. After uploading the
// Badge PNGs in the Discord Developer Portal (your app → Emojis), paste
// each emoji's ID here (README Setup). IDs aren't secrets.
// ==========================================================

import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";

export const BADGE_EMOJIS = {
  brock: { name: "boulder_badge", id: "" },
  misty: { name: "cascade_badge", id: "" },
  surge: { name: "thunder_badge", id: "" },
  erika: { name: "rainbow_badge", id: "" },
  koga: { name: "soul_badge", id: "" },
  sabrina: { name: "marsh_badge", id: "" },
  blaine: { name: "volcano_badge", id: "" },
  giovanni: { name: "earth_badge", id: "" },
};

export function badgeEmoji(key) {
  const { name, id } = BADGE_EMOJIS[key];
  return `<:${name}:${id}>`;
}

export function badgeLine(user) {
  const earned = earnedBadgeKeys(user);
  const head = `🏅 **Badges:** ${earned.length}/${GYM_BADGES.length}`;
  return earned.length ? `${head} ${earned.map(badgeEmoji).join(" ")}` : head;
}
