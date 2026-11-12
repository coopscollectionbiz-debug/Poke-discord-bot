// ===========================================================
// Badges — the 8 Kanto Gym Badges a player earns from /challenge
// (see CONTEXT.md). No DOM access, so the bot can import this too.
// ===========================================================

const badge = (key, leader, name, type, file) =>
  ({ key, leader, badge: `${name} Badge`, type, image: `/public/sprites/badges/${file}` });

// In Gym order.
export const GYM_BADGES = [
  badge("brock", "Brock", "Boulder", "Rock", "boulder.png"),
  badge("misty", "Misty", "Cascade", "Water", "cascade.png"),
  badge("surge", "Lt. Surge", "Thunder", "Electric", "thunder.png"),
  badge("erika", "Erika", "Rainbow", "Grass", "rainbow.png"),
  badge("koga", "Koga", "Soul", "Poison", "soul.png"),
  badge("sabrina", "Sabrina", "Marsh", "Psychic", "marsh.png"),
  badge("blaine", "Blaine", "Volcano", "Fire", "volcano.png"),
  badge("giovanni", "Giovanni", "Earth", "Ground", "earth.png"),
];

// A Badge is a Gym key in user.challenge.won; other keys (elite4, blue, red) aren't Badges.
export function earnedBadgeKeys(user) {
  const won = user?.challenge?.won ?? {};
  return GYM_BADGES.map((b) => b.key).filter((key) => key in won);
}
