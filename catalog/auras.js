// ==========================================================
// catalog/auras.js — every Aura a player can collect (docs: CONTEXT.md "Aura").
//
// An Aura is the effect drawn behind a player's trainer on their cards and
// battle images. `look` is what the renderer draws:
//   • a tier key ("epic" | "legendary" | "mythic"): the procedural tier
//     backdrop (utils/render/trainerBackdrop.js);
//   • "art:<id>": the spritesheets in assets/auras/<id>/ (aura.json +
//     back.png). Until that folder exists the Aura can be owned but not
//     equipped, and the shop does not sell it.
//
// How each kind is earned (services/auras.js):
//   tier       owning (ever) a trainer of that tier
//   gym        beating that Gym Leader in /challenge
//   elite4     beating that Elite Four member (any fight in a run)
//   champion   beating Blue · red: beating Red
//   milestone  unlocking the named achievement
//   shop       buying it with CC (price)
//   event      granted during an event; `retired` ones are never granted again
// Ids are camelCase and stable: they are saved in player records and name
// the art folders.
// ==========================================================

const tier = (id, name, t) => ({ id, name, kind: "tier", look: t, tier: t });
const art = (id, name, kind, extra = {}) => ({ id, name, kind, look: `art:${id}`, ...extra });

const GYMS = [
  ["brock", "Boulder Aura", "Brock"], ["misty", "Cascade Aura", "Misty"], ["surge", "Thunder Aura", "Lt. Surge"],
  ["erika", "Rainbow Aura", "Erika"], ["koga", "Soul Aura", "Koga"], ["sabrina", "Marsh Aura", "Sabrina"],
  ["blaine", "Volcano Aura", "Blaine"], ["giovanni", "Earth Aura", "Giovanni"],
];
const ELITE4 = [["lorelei", "Lorelei"], ["bruno", "Bruno"], ["agatha", "Agatha"], ["lance", "Lance"]];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Milestones ride on achievements, so the achievement engine's retro check backfills them.
const REGIONS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"];

export const AURAS = Object.freeze([
  tier("tierEpic", "Epic Aura", "epic"),
  tier("tierLegendary", "Legendary Aura", "legendary"),
  tier("tierMythic", "Mythic Aura", "mythic"),

  ...GYMS.map(([key, name, leader]) => art(`gym${cap(key)}`, name, "gym", { challenge: key, by: leader })),
  ...ELITE4.map(([key, who]) => art(`e4${cap(key)}`, `${who}'s Aura`, "elite4", { challenge: "elite4", opponent: key, by: who })),
  art("champBlue", "Champion's Aura", "champion", { challenge: "blue", by: "Blue" }),
  art("red", "Mt. Silver Aura", "champion", { challenge: "red", by: "Red" }),

  ...REGIONS.map((r) => art(`milestone${cap(r)}`, `${cap(r)} Aura`, "milestone", { achievement: `col_region_${r}_full`, goal: `Complete the ${cap(r)} Pokédex` })),
  art("milestoneRating1400", "Contender Aura", "milestone", { achievement: "bat_rating_1400", goal: "Reach a ranked rating of 1400" }),
  art("milestoneRating1600", "Elite Aura", "milestone", { achievement: "bat_rating_1600", goal: "Reach a ranked rating of 1600" }),
  art("milestoneShiny25", "Glimmer Aura", "milestone", { achievement: "shiny_species_25", goal: "Own 25 different shiny Pokémon" }),
  art("milestoneShiny100", "Prismatic Aura", "milestone", { achievement: "shiny_species_100", goal: "Own 100 different shiny Pokémon" }),

  // CC shop: three price tiers (25k / 50k / 100k). Listed only once their art exists.
  art("shopShimmer", "Shimmer Aura", "shop", { price: 25_000 }),
  art("shopStarfield", "Starfield Aura", "shop", { price: 25_000 }),
  art("shopBreeze", "Breeze Aura", "shop", { price: 25_000 }),
  art("shopTwilight", "Twilight Aura", "shop", { price: 50_000 }),
  art("shopPrismOrbs", "Prism Orbs Aura", "shop", { price: 50_000 }),
  art("shopBlossomMoon", "Blossom Moon Aura", "shop", { price: 50_000 }),
  art("shopNeonLattice", "Neon Lattice Aura", "shop", { price: 100_000 }),
  art("shopSynthwave", "Synthwave Sun Aura", "shop", { price: 100_000 }),
  art("shopAbyss", "Abyss Aura", "shop", { price: 100_000 }),

  // Events: granted while the event runs (admin grant), kept forever; retired = never granted again.
  art("eventWinterfest", "Winterfest Aura", "event", { retired: false }),
  art("eventSpooky", "Spooky Season Aura", "event", { retired: false }),
  art("eventFireworks", "Fireworks Aura", "event", { retired: false }),
]);

export const AURA_BY_ID = new Map(AURAS.map((a) => [a.id, a]));
export const getAura = (id) => AURA_BY_ID.get(String(id ?? "")) ?? null;
export const SHOP_PRICES = Object.freeze([25_000, 50_000, 100_000]);
/** The tier Aura a trainer tier unlocks, or null below Epic. */
export const TIER_AURA = Object.freeze({ epic: "tierEpic", legendary: "tierLegendary", mythic: "tierMythic" });
