// ==========================================================
// utils/challenge/badgeImages.js
// The 8 Badges in Discord: images served from the bot's public host, like
// trainer sprites (spriteconfig.js), so nothing is uploaded to Discord and
// every bot application shows them the same way. Text can't hold an image,
// so text lines name the Badges instead.
// ==========================================================

import { GYM_BADGES, earnedBadgeKeys } from "../../public/picker-pokemon/badges.js";
import { spritePaths } from "../../spriteconfig.js";

const byKey = Object.fromEntries(GYM_BADGES.map((b) => [b.key, b]));

export const badgeUrl = (key) => `${spritePaths.badges}${byKey[key].image.split("/").pop()}`;

export function badgeLine(user) {
  const earned = earnedBadgeKeys(user);
  const head = `🏅 **Badges:** ${earned.length}/${GYM_BADGES.length}`;
  return earned.length ? `${head} · ${earned.map((k) => byKey[k].badge.replace(/ Badge$/, "")).join(", ")}` : head;
}
