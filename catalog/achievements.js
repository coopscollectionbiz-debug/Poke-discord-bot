// ==========================================================
// catalog/achievements.js — the single achievement registry (Release C)
//
// Source: ACHIEVEMENT-SYSTEM-DESIGN.md §3 (ids, targets, tiers, AP and
// reward VALUES are taken from it). Ids are stable and never reused.
//
// Rewards: decision D-07 (retroactive payouts / cap) is NOT approved, and
// the design review made current-state achievements prestige-only. So every
// currency/item/title/badge/cosmetic reward is defined here with
// rewardStatus "pending_approval" and CANNOT be claimed. Achievement Points
// (non-spendable prestige) are the only thing players earn in Release C.
// To enable a reward later, add its id to config/achievementRewards.js.
//
// metric.kind:
//   "state"   – computed from the current record (fully reconstructable)
//   "counter" – user.stats counter; tracked from Release C on
//               (retro = "baseline": seeded with a provable lower bound;
//                retro = "none": starts at 0)
// ==========================================================

import { getRankTiers } from "../utils/rankSystem.js";
import { TYPE_ID_TO_NAME } from "../utils/battle/data.js";

/**
 * Bump when a definition's target/metric changes or entries are added.
 * 1 = Release C (83). 2 = Mastery expansion (adds entries only; every
 * revision-1 id, target, metric and AP is unchanged).
 */
export const CATALOG_REVISION = 2;

export const CATEGORIES = Object.freeze({
  collection: { label: "Pokémon Collection", emoji: "📚", order: 1 },
  shiny: { label: "Shiny Hunting", emoji: "✨", order: 2 },
  evolution: { label: "Evolution", emoji: "💎", order: 3 },
  battle: { label: "Battles", emoji: "⚔️", order: 4 },
  training: { label: "Training", emoji: "📈", order: 5 },
  economy: { label: "Economy", emoji: "💰", order: 6 },
  activity: { label: "Daily & Weekly", emoji: "📅", order: 7 },
  special: { label: "Special Milestones", emoji: "🏅", order: 8 },
});

/** Supported Pokédex (pokemonData.json, national dex 1–649). */
export const SUPPORTED_SPECIES = 649;
/** Legendary / Mythic species in the supported dataset (tier field). */
export const TIER_SPECIES = Object.freeze({ legendary: 48, mythic: 21 });
/** Evolution families with 2+ members (connected components of evolvesTo/evolvesFrom). */
export const MULTI_MEMBER_FAMILIES = 225;
/** "Type Encyclopedia": this many species of every type (every type has 27+). */
export const TYPE_MASTERY_MIN = 15;

export const TIER_NAMES = Object.freeze({ 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum", 5: "Master" });

// Region sizes (national dex 1–649), verified against pokemonData.json.
export const REGIONS = Object.freeze({ Kanto: 151, Johto: 100, Hoenn: 135, Sinnoh: 107, Unova: 156 });

const entries = [];
/** Catalog revision that introduced the entry (1 = Release C, 2 = Mastery expansion). */
let SINCE = 1;
const add = (o) =>
  entries.push(
    Object.freeze({
      tier: 1,
      hidden: false,
      reward: null,
      rewardStatus: o.reward ? "pending_approval" : "none",
      since: SINCE,
      ...o,
    })
  );
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ---------------- Collection (state; retro full) ----------------
add({ id: "col_first", name: "First Partner", description: "Own a Pokémon.", category: "collection", metric: { kind: "state", key: "uniqueSpecies" }, target: 1, tier: 1, ap: 5, reward: { cc: 500 }, retro: "full" });
for (const [n, name, tier, ap, reward] of [
  [25, "Field Notes", 1, 10, { cc: 1000, items: { ball_voucher_poke: 1 } }],
  [100, "Researcher", 2, 25, { cc: 3000, items: { evolution_stone: 1 } }],
  [250, "Professor's Aide", 3, 50, { cc: 6000, title: "Professor's Aide" }],
  [500, "Living Pokédex", 4, 100, { cc: 10000, cosmetic: "frame_pokedex_gold" }],
]) {
  add({ id: `col_species_${n}`, name, description: `Own ${n} different Pokémon at the same time.`, category: "collection", metric: { kind: "state", key: "uniqueSpecies" }, target: n, tier, ap, reward, retro: "full" });
}
for (const [region, size] of Object.entries(REGIONS)) {
  const half = Math.ceil(size / 2);
  add({ id: `col_region_${slug(region)}_half`, name: `${region} Explorer`, description: `Own ${half} of the ${size} Pokémon from ${region}.`, category: "collection", metric: { kind: "state", key: `region:${region}` }, target: half, tier: 2, ap: 15, reward: { cc: 2000 }, retro: "full" });
  add({ id: `col_region_${slug(region)}_full`, name: `${region} Pokédex Complete`, description: `Own every one of the ${size} Pokémon from ${region}.`, category: "collection", metric: { kind: "state", key: `region:${region}` }, target: size, tier: 5, ap: 75, reward: { badge: `badge_${slug(region)}`, title: `${region} Master` }, retro: "full" });
}
for (const [typeId, typeName] of Object.entries(TYPE_ID_TO_NAME)) {
  add({ id: `col_type_${slug(typeName)}`, name: `${typeName} Specialist`, description: `Own 15 different ${typeName}-type Pokémon.`, category: "collection", metric: { kind: "state", key: `type:${typeId}` }, target: 15, tier: 2, ap: 10, reward: { cc: 500 }, retro: "full" });
}
add({ id: "col_legendary", name: "Legend Seeker", description: "Own a Legendary Pokémon.", category: "collection", metric: { kind: "state", key: "tier:legendary" }, target: 1, tier: 3, ap: 20, reward: { badge: "badge_legend_seeker" }, retro: "full" });
add({ id: "col_mythic", name: "Myth Made Real", description: "Own a Mythic Pokémon.", category: "collection", metric: { kind: "state", key: "tier:mythic" }, target: 1, tier: 4, ap: 40, reward: { badge: "badge_myth" }, retro: "full", hidden: true });

// ---------------- Shiny ----------------
add({ id: "shiny_first", name: "Something Sparkles", description: "Own a shiny Pokémon.", category: "shiny", metric: { kind: "state", key: "shinyCopies" }, target: 1, tier: 1, ap: 10, reward: { cc: 1000 }, retro: "full" });
for (const [n, roman, ap, dust, tier] of [[10, "I", 20, 10, 2], [25, "II", 40, 20, 3], [50, "III", 75, 40, 4], [100, "IV", 150, 60, 5]]) {
  add({ id: `shiny_${n}`, name: `Shiny Hunter ${roman}`, description: `Obtain ${n} shiny Pokémon (counted since tracking began; your current shinies count as a starting point).`, category: "shiny", metric: { kind: "counter", key: "shinyObtained" }, target: n, tier, ap, reward: n === 100 ? { items: { shiny_dust: dust }, title: "Shiny Hunter" } : { items: { shiny_dust: dust } }, retro: "baseline" });
}
for (const [n, roman, ap, dust, tier] of [[10, "I", 20, 10, 2], [25, "II", 40, 20, 3], [50, "III", 80, 30, 4]]) {
  add({ id: `shiny_species_${n}`, name: `Prismatic Pokédex ${roman}`, description: `Own ${n} different shiny Pokémon.`, category: "shiny", metric: { kind: "state", key: "shinySpecies" }, target: n, tier, ap, reward: { items: { shiny_dust: dust } }, retro: "full" });
}

// ---------------- Evolution (counter; new tracking) ----------------
for (const [n, roman, ap, reward, tier] of [[1, "I", 5, null, 1], [10, "II", 10, { items: { evolution_stone: 1 } }, 2], [50, "III", 25, { items: { evolution_stone: 2 } }, 3], [100, "IV", 50, { title: "Evolution Expert" }, 4]]) {
  add({ id: `evo_${n}`, name: `Evolution ${roman}`, description: `Evolve ${n} Pokémon (counted from this release on).`, category: "evolution", metric: { kind: "counter", key: "evolutions" }, target: n, tier, ap, reward, retro: "none" });
}

// ---------------- Battles (state from user.battle; retro full for the battle era) ----------------
add({ id: "bat_first_win", name: "First Victory", description: "Win a battle.", category: "battle", metric: { kind: "state", key: "battleWins" }, target: 1, tier: 1, ap: 5, reward: { cc: 500 }, retro: "full" });
for (const [n, roman, ap, reward, tier] of [[10, "I", 10, { cc: 1000 }, 1], [50, "II", 25, { cc: 2500 }, 2], [100, "III", 50, { cc: 5000 }, 3], [500, "IV", 100, { title: "Ace Trainer" }, 4]]) {
  add({ id: `bat_wins_${n}`, name: `Battler ${roman}`, description: `Win ${n} battles.`, category: "battle", metric: { kind: "state", key: "battleWins" }, target: n, tier, ap, reward, retro: "full" });
}
for (const [n, name, ap, tier] of [[1200, "Rising Star", 15, 2], [1400, "Contender", 30, 3], [1600, "Elite", 60, 4]]) {
  add({ id: `bat_rating_${n}`, name, description: `Reach a Battle rating of ${n}.`, category: "battle", metric: { kind: "state", key: "battleRating" }, target: n, tier, ap, reward: { badge: `badge_rating_${n}` }, retro: "full" });
}

// ---------------- Training (rank from TP, levels, trainers; state) ----------------
getRankTiers().forEach((t, i) => {
  add({ id: `rank_${slug(t.roleName)}`, name: t.roleName, description: `Reach the ${t.roleName} rank (${t.tp.toLocaleString("en-US")} TP).`, category: "training", metric: { kind: "state", key: "tp" }, target: t.tp, tier: Math.min(5, 1 + Math.floor(i / 3)), ap: [5, 5, 10, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100][i] ?? 10, reward: i >= 9 ? { title: t.roleName } : null, retro: "full" });
});
add({ id: "lvl_50", name: "Seasoned", description: "Raise a Pokémon to Level 50.", category: "training", metric: { kind: "state", key: "maxLevel" }, target: 50, tier: 3, ap: 20, reward: { items: { lucky_egg: 1 } }, retro: "full" });
add({ id: "lvl_100", name: "Peak Condition", description: "Raise a Pokémon to Level 100.", category: "training", metric: { kind: "state", key: "maxLevel" }, target: 100, tier: 5, ap: 60, reward: null, retro: "full" });
for (const [n, roman, ap, cc, tier] of [[10, "I", 10, 1000, 1], [50, "II", 20, 2500, 2], [100, "III", 40, 5000, 3], [250, "IV", 80, 10000, 4]]) {
  add({ id: `trainer_${n}`, name: `Trainer Collector ${roman}`, description: `Own ${n} trainers.`, category: "training", metric: { kind: "state", key: "trainers" }, target: n, tier, ap, reward: { cc }, retro: "full" });
}

// ---------------- Economy (counters; new tracking) ----------------
for (const [n, roman, ap, dust, tier] of [[1, "I", 5, 2, 1], [100, "II", 15, 5, 2], [1000, "III", 40, 10, 3], [5000, "IV", 80, 20, 4]]) {
  add({ id: `don_${n}`, name: `Kind Heart ${roman}`, description: `Donate ${n} Pokémon (counted from this release on).`, category: "economy", metric: { kind: "counter", key: "donated" }, target: n, tier, ap, reward: { items: { shiny_dust: dust } }, retro: "none" });
}
for (const [n, name, ap, reward, tier] of [[1, "Customer", 5, null, 1], [25, "Regular", 15, null, 2], [100, "Patron", 30, { cosmetic: "bg_patron" }, 3]]) {
  add({ id: `econ_buy_${n}`, name, description: `Make ${n} shop purchase${n === 1 ? "" : "s"} (Poké Balls and Evolution Stones; counted from this release on).`, category: "economy", metric: { kind: "counter", key: "purchases" }, target: n, tier, ap, reward, retro: "none" });
}

// ==========================================================
// Revision 2 — Mastery expansion. Ownership semantics: the game keeps no
// Pokédex discovery history, so every collection/family/shiny-species
// achievement means "own at the same time" and says so.
// ==========================================================

SINCE = 2;
// ---- Pokédex mastery (state; retro full) ----
add({ id: "col_species_649", name: "Pokédex Complete", description: `Own all ${SUPPORTED_SPECIES} supported Pokémon at the same time.`, category: "collection", metric: { kind: "state", key: "uniqueSpecies" }, target: SUPPORTED_SPECIES, tier: 5, ap: 150, retro: "full" });
for (const [region, size] of Object.entries(REGIONS)) {
  const n = Math.ceil(size * 0.75);
  add({ id: `col_region_${slug(region)}_75`, name: `${region} Cartographer`, description: `Own ${n} of the ${size} Pokémon from ${region} at the same time.`, category: "collection", metric: { kind: "state", key: `region:${region}` }, target: n, tier: 3, ap: 30, retro: "full" });
}
add({ id: "col_world_traveler", name: "World Traveler", description: "Own a Pokémon from each of the 5 regions.", category: "collection", metric: { kind: "state", key: "regions" }, target: Object.keys(REGIONS).length, tier: 1, ap: 5, retro: "full" });
add({ id: "col_legendary_10", name: "Legend Collector", description: "Own 10 different Legendary Pokémon.", category: "collection", metric: { kind: "state", key: "tier:legendary" }, target: 10, tier: 3, ap: 30, retro: "full" });
add({ id: "col_legendary_25", name: "Legend Keeper", description: "Own 25 different Legendary Pokémon.", category: "collection", metric: { kind: "state", key: "tier:legendary" }, target: 25, tier: 4, ap: 60, retro: "full" });
add({ id: "col_legendary_all", name: "Hall of Legends", description: `Own all ${TIER_SPECIES.legendary} Legendary Pokémon at the same time.`, category: "collection", metric: { kind: "state", key: "tier:legendary" }, target: TIER_SPECIES.legendary, tier: 5, ap: 100, retro: "full" });
add({ id: "col_mythic_all", name: "Mythic Archive", description: `Own all ${TIER_SPECIES.mythic} Mythic Pokémon at the same time.`, category: "collection", metric: { kind: "state", key: "tier:mythic" }, target: TIER_SPECIES.mythic, tier: 5, ap: 100, retro: "full", hidden: true });
add({ id: "col_type_all", name: "Type Encyclopedia", description: `Own ${TYPE_MASTERY_MIN} different Pokémon of every one of the ${Object.keys(TYPE_ID_TO_NAME).length} types.`, category: "collection", metric: { kind: "state", key: "typeMastery" }, target: Object.keys(TYPE_ID_TO_NAME).length, tier: 4, ap: 60, retro: "full" });

// ---- Shiny mastery ----
for (const [n, roman, ap] of [[100, "IV", 120], [150, "V", 150], [250, "VI", 200]]) {
  add({ id: `shiny_species_${n}`, name: `Prismatic Pokédex ${roman}`, description: `Own ${n} different shiny Pokémon at the same time.`, category: "shiny", metric: { kind: "state", key: "shinySpecies" }, target: n, tier: 5, ap, retro: "full" });
}
add({ id: "shiny_legendary", name: "Gleaming Legend", description: "Own a shiny Legendary Pokémon.", category: "shiny", metric: { kind: "state", key: "shinyTier:legendary" }, target: 1, tier: 4, ap: 40, retro: "full" });
add({ id: "shiny_mythic", name: "Mirage", description: "Own a shiny Mythic Pokémon.", category: "shiny", metric: { kind: "state", key: "shinyTier:mythic" }, target: 1, tier: 5, ap: 60, retro: "full", hidden: true });
add({ id: "shiny_globetrotter", name: "Shiny Globetrotter", description: "Own a shiny Pokémon from each of the 5 regions.", category: "shiny", metric: { kind: "state", key: "shinyRegions" }, target: Object.keys(REGIONS).length, tier: 3, ap: 25, retro: "full" });
for (const [n, roman, ap] of [[250, "V", 175], [500, "VI", 225]]) {
  add({ id: `shiny_${n}`, name: `Shiny Hunter ${roman}`, description: `Obtain ${n} shiny Pokémon (counted since tracking began; your current shinies count as a starting point).`, category: "shiny", metric: { kind: "counter", key: "shinyObtained" }, target: n, tier: 5, ap, retro: "baseline" });
}

// ---- Evolution mastery ----
for (const [n, roman, ap] of [[250, "V", 80], [500, "VI", 120]]) {
  add({ id: `evo_${n}`, name: `Evolution ${roman}`, description: `Evolve ${n} Pokémon (counted from this release on).`, category: "evolution", metric: { kind: "counter", key: "evolutions" }, target: n, tier: 5, ap, retro: "none" });
}
for (const [n, roman, ap, tier] of [[10, "I", 10, 2], [25, "II", 25, 3], [50, "III", 50, 4], [100, "IV", 90, 5]]) {
  add({ id: `evo_species_${n}`, name: `Evolution Scholar ${roman}`, description: `Evolve into ${n} different species (counted from this expansion on).`, category: "evolution", metric: { kind: "counter", key: "evolvedSpecies" }, target: n, tier, ap, retro: "none" });
}
add({ id: "evo_shiny_1", name: "Radiant Evolution", description: "Evolve a shiny Pokémon (counted from this expansion on).", category: "evolution", metric: { kind: "counter", key: "shinyEvolutions" }, target: 1, tier: 2, ap: 10, retro: "none" });
add({ id: "evo_shiny_25", name: "Radiant Evolution II", description: "Evolve 25 shiny Pokémon (counted from this expansion on).", category: "evolution", metric: { kind: "counter", key: "shinyEvolutions" }, target: 25, tier: 4, ap: 50, retro: "none" });
for (const [n, name, ap, tier] of [[1, "Family Reunion", 5, 1], [10, "Family Album I", 15, 2], [25, "Family Album II", 30, 3], [50, "Family Album III", 60, 4], [100, "Family Album IV", 100, 5], [MULTI_MEMBER_FAMILIES, "Complete Family Tree", 150, 5]]) {
  const id = n === MULTI_MEMBER_FAMILIES ? "evo_family_all" : `evo_family_${n}`;
  const what = n === MULTI_MEMBER_FAMILIES ? `every one of the ${n} evolution families` : n === 1 ? "every member of an evolution family" : `every member of ${n} evolution families`;
  add({ id, name, description: `Own ${what} at the same time (families with 2+ members).`, category: "evolution", metric: { kind: "state", key: "familiesComplete" }, target: n, tier, ap, retro: "full" });
}
add({ id: "evo_family_eevee", name: "Eeveelution Gallery", description: "Own Eevee and all 7 of its evolutions at the same time.", category: "evolution", metric: { kind: "state", key: "family:133" }, target: 8, tier: 4, ap: 40, retro: "full", hidden: true });

// ---- Battle mastery ----
for (const [n, roman, ap] of [[1000, "V", 150], [2500, "VI", 200]]) {
  add({ id: `bat_wins_${n}`, name: `Battler ${roman}`, description: `Win ${n} battles.`, category: "battle", metric: { kind: "state", key: "battleWins" }, target: n, tier: 5, ap, retro: "full" });
}
for (const [n, name, ap, tier] of [[3, "Hot Streak", 10, 2], [5, "On Fire", 20, 3], [10, "Unstoppable", 40, 4], [20, "Legendary Run", 80, 5]]) {
  add({ id: `bat_streak_${n}`, name, description: `Win ${n} battles in a row (counted from this expansion on).`, category: "battle", metric: { kind: "counter", key: "bestWinStreak" }, target: n, tier, ap, retro: "none" });
}
add({ id: "bat_upset", name: "Giant Slayer", description: "Win a battle against an opponent rated at least 200 higher than you.", category: "battle", metric: { kind: "counter", key: "upsetWins" }, target: 1, tier: 3, ap: 25, retro: "none", hidden: true });

// ---- Trainer collection mastery (745 trainers in trainerSprites.json) ----
for (const [n, roman, ap] of [[500, "V", 120], [700, "VI", 160]]) {
  add({ id: `trainer_${n}`, name: `Trainer Collector ${roman}`, description: `Own ${n} trainers.`, category: "training", metric: { kind: "state", key: "trainers" }, target: n, tier: 5, ap, retro: "full" });
}
add({ id: "trainer_legendary_10", name: "Legendary Recruiter", description: "Own 10 Legendary-tier trainers.", category: "training", metric: { kind: "state", key: "trainerTier:legendary" }, target: 10, tier: 3, ap: 25, retro: "full" });
add({ id: "trainer_mythic_1", name: "Mythic Recruiter", description: "Own a Mythic-tier trainer.", category: "training", metric: { kind: "state", key: "trainerTier:mythic" }, target: 1, tier: 3, ap: 20, retro: "full" });
add({ id: "trainer_mythic_10", name: "Mythic Circle", description: "Own 10 Mythic-tier trainers.", category: "training", metric: { kind: "state", key: "trainerTier:mythic" }, target: 10, tier: 4, ap: 50, retro: "full" });

// ---- Daily & weekly activity (counters; counted from this expansion on) ----
for (const [n, name, ap, tier] of [[7, "Regular Visitor", 5, 1], [30, "Dedicated", 15, 2], [100, "Devoted", 40, 4], [365, "Year of Dailies", 100, 5]]) {
  add({ id: `daily_${n}`, name, description: `Claim /daily ${n} times (counted from this expansion on).`, category: "activity", metric: { kind: "counter", key: "dailyClaims" }, target: n, tier, ap, retro: "none" });
}
for (const [n, name, ap, tier] of [[7, "Week Streak", 10, 2], [30, "Month Streak", 40, 4], [100, "Centurion Streak", 120, 5]]) {
  add({ id: `daily_streak_${n}`, name, description: `Claim /daily on ${n} consecutive UTC days (counted from this expansion on).`, category: "activity", metric: { kind: "counter", key: "bestDailyStreak" }, target: n, tier, ap, retro: "none" });
}
for (const [n, name, ap, tier] of [[5, "Weekly Regular", 10, 2], [25, "Weekly Devotee", 30, 3], [52, "A Year of Packs", 60, 5]]) {
  add({ id: `weekly_${n}`, name, description: `Claim the weekly pack ${n} times (counted from this expansion on).`, category: "activity", metric: { kind: "counter", key: "weeklyClaims" }, target: n, tier, ap, retro: "none" });
}

SINCE = 1;
// ---------------- Special (meta; AP total; 0 AP so there is no loop) ----------------
for (const [n, roman, reward, tier] of [[100, "I", { cosmetic: "frame_decorated" }, 2], [500, "II", { cosmetic: "bg_decorated" }, 3], [1500, "III", { title: "Decorated" }, 5]]) {
  add({ id: `meta_ap_${n}`, name: `Decorated ${roman}`, description: `Earn ${n} Achievement Points.`, category: "special", metric: { kind: "state", key: "ap" }, target: n, tier, ap: 0, reward, retro: "full" });
}
// Revision 2: the expanded catalog is worth 6,375 AP, so one higher milestone.
SINCE = 2;
add({ id: "meta_ap_3000", name: "Decorated IV", description: "Earn 3000 Achievement Points.", category: "special", metric: { kind: "state", key: "ap" }, target: 3000, tier: 5, ap: 0, retro: "full" });

const BY_ID = new Map(entries.map((e) => [e.id, e]));
export const ACHIEVEMENT_ID_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

export const listAchievements = () => entries;
export function getAchievement(id) {
  if (typeof id !== "string" || !ACHIEVEMENT_ID_PATTERN.test(id)) return null;
  return BY_ID.get(id) ?? null;
}

/** Metric key → achievements that use it (targeted evaluation). */
export const BY_METRIC = (() => {
  const m = new Map();
  for (const e of entries) {
    const k = `${e.metric.kind}:${e.metric.key}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return m;
})();
