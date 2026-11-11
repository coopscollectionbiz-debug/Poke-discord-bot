// ==========================================================
// catalog/items.js — the single authoritative item catalog (Release B)
//
// Every item the bot knows about is defined here, with a STABLE id that is
// never reused or renamed (ids are keys in saved player data: user.items).
//
// `status` separates "defined" from "obtainable":
//   "active"  – exists in the game today; may be held/granted/consumed
//   "defined" – designed for a future release; NOT obtainable, NOT shown in
//               any shop, and the inventory service refuses to grant it.
//
// `storage` says where ownership lives:
//   "inventory"      – counted in user.items[id] (non-negative integer)
//   "instant"        – bought and used in one step, never stored
//                      (today's Poké Ball rolls on the dashboard)
//   "purchase_flag"  – a one-time purchase recorded in user.purchases
//
// Prices: existing shop code stays authoritative (Release B changes no
// prices). `legacyPrice` documents what the live code charges today, for
// display only; nothing reads it to charge players.
// ==========================================================

import fs from "fs";
import { tmItemDefinitions } from "./tms.js";

export const CATEGORIES = Object.freeze({
  capture: { label: "Capture", emoji: "🎯", order: 1 },
  evolution: { label: "Evolution", emoji: "💎", order: 2 },
  consumable: { label: "Consumables", emoji: "🍬", order: 3 },
  held: { label: "Held items", emoji: "🧿", order: 4 },
  trainer_equipment: { label: "Trainer equipment", emoji: "🎒", order: 5 },
  cosmetic: { label: "Cosmetics", emoji: "🖼️", order: 6 },
  quest: { label: "Quest items", emoji: "📜", order: 7 },
  special: { label: "Special", emoji: "🎁", order: 8 },
  tm: { label: "Technical Machines", emoji: "💿", order: 9 },
});

export const RARITIES = Object.freeze(["common", "uncommon", "rare", "epic", "legendary", "mythic"]);
export const STATUSES = Object.freeze(["active", "defined"]);
export const STORAGES = Object.freeze(["inventory", "instant", "purchase_flag"]);

/** Hard upper bound for any stack (well inside Number.MAX_SAFE_INTEGER). */
export const ABSOLUTE_MAX_STACK = 1_000_000_000;

const item = (o) =>
  Object.freeze({
    rarity: "common",
    stackable: true,
    maxStack: ABSOLUTE_MAX_STACK,
    tradable: false, // trading is Pokémon-only, and not built yet
    consumable: false,
    equip: null, // { slot: "pokemon" | "trainer" | "frame" | ... } for future releases
    visible: true,
    shop: null, // { eligible, channel, legacyPrice }
    sources: [],
    sinceRelease: "B",
    ...o,
  });

const ITEMS = [
  // ---------------- ACTIVE: existing items (behavior unchanged) ----------------
  item({
    id: "evolution_stone",
    name: "Evolution Stone",
    description: "Used to evolve a Pokémon on the dashboard. The number needed depends on the rarity step.",
    category: "evolution",
    rarity: "rare",
    consumable: true,
    status: "active",
    storage: "inventory",
    icon: "items/evolution_stone.png",
    shop: { eligible: true, channel: "dashboard + admin /shop", legacyPrice: { cc: 5000, adminShopCc: 3500 } },
    sources: ["daily", "shop", "admin"],
    sinceRelease: "legacy",
  }),
  item({
    id: "shiny_dust",
    name: "Shiny Dust",
    description: "Earned by donating Pokémon. Spent to convert a Pokémon to shiny or to evolve a shiny Pokémon.",
    category: "evolution",
    rarity: "epic",
    consumable: true,
    status: "active",
    storage: "inventory",
    icon: "items/shiny_dust.png",
    sources: ["donation", "admin"],
    sinceRelease: "legacy",
  }),
  item({
    id: "pokeball",
    name: "Poké Ball",
    description: "Bought on the dashboard and thrown immediately for a random Pokémon. Never kept in the bag.",
    category: "capture",
    rarity: "common",
    consumable: true,
    status: "active",
    storage: "instant",
    icon: "items/pokeball.png",
    shop: { eligible: true, channel: "dashboard", legacyPrice: { cc: 1000 } },
    sources: ["shop"],
    sinceRelease: "legacy",
  }),
  item({
    id: "greatball",
    name: "Great Ball",
    description: "Bought on the dashboard and thrown immediately, with better odds than a Poké Ball. Never kept in the bag.",
    category: "capture",
    rarity: "uncommon",
    consumable: true,
    status: "active",
    storage: "instant",
    icon: "items/greatball.png",
    shop: { eligible: true, channel: "dashboard", legacyPrice: { cc: 2000 } },
    sources: ["shop"],
    sinceRelease: "legacy",
  }),
  item({
    id: "ultraball",
    name: "Ultra Ball",
    description: "Bought on the dashboard and thrown immediately, with the best odds. Never kept in the bag.",
    category: "capture",
    rarity: "rare",
    consumable: true,
    status: "active",
    storage: "instant",
    icon: "items/ultraball.png",
    shop: { eligible: true, channel: "dashboard", legacyPrice: { cc: 4000 } },
    sources: ["shop"],
    sinceRelease: "legacy",
  }),
  item({
    id: "starter_pack",
    name: "Starter Pack",
    description: "A one-time bundle of 3 Pokémon and 1 rare trainer. Recorded as a purchase, not kept in the bag.",
    category: "special",
    rarity: "rare",
    stackable: false,
    maxStack: 1,
    status: "active",
    storage: "purchase_flag",
    icon: "items/starter_pack.png",
    shop: { eligible: true, channel: "admin /shop", legacyPrice: { cc: 0 } },
    sources: ["shop"],
    sinceRelease: "legacy",
  }),

  // ---------------- DEFINED: future releases (NOT obtainable) ----------------
  item({
    id: "ball_voucher_poke",
    name: "Poké Ball Voucher",
    description: "Open for a free Poké Ball roll.",
    category: "capture",
    rarity: "common",
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: ["quest", "achievement"],
    sinceRelease: "D",
  }),
  item({
    id: "rare_candy",
    name: "Rare Candy",
    description: "Raises one owned Pokémon by one level (below level 50).",
    category: "consumable",
    rarity: "rare",
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: ["shop", "achievement"],
    sinceRelease: "E",
  }),
  item({
    id: "charcoal",
    name: "Charcoal",
    description: "Held item: Fire-type moves hit harder.",
    category: "held",
    rarity: "uncommon",
    equip: { slot: "pokemon" },
    status: "defined",
    storage: "inventory",
    sources: ["shop"],
    sinceRelease: "E",
  }),
  item({
    id: "pokedex_scanner",
    name: "Pokédex Scanner",
    description: "Trainer gear: marks newly caught species.",
    category: "trainer_equipment",
    rarity: "uncommon",
    stackable: false,
    maxStack: 1,
    equip: { slot: "trainer" },
    status: "defined",
    storage: "inventory",
    sources: ["shop"],
    sinceRelease: "E",
  }),
  item({
    id: "frame_bronze",
    name: "Bronze Card Frame",
    description: "Cosmetic: a bronze border on your trainer card.",
    category: "cosmetic",
    rarity: "common",
    stackable: false,
    maxStack: 1,
    equip: { slot: "frame" },
    status: "defined",
    storage: "inventory",
    sources: ["shop"],
    sinceRelease: "E",
  }),
  item({
    id: "quest_reroll",
    name: "Quest Reroll Ticket",
    description: "Reroll one incomplete quest.",
    category: "quest",
    rarity: "common",
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: ["shop", "achievement"],
    sinceRelease: "D",
  }),
];

// ---------------- DEFINED: Mega Evolution (Phase M0, NOT obtainable) ----------------
// 92 Mega Stones from data/pokedex/megas.json, plus Mega Shards and vouchers.
// All "defined": grantItem refuses them, no shop lists them, nothing drops them.
// A stone is consumed once to unlock a Mega form on one species+variant line
// (D-1); battle use never consumes anything. Category "evolution" for now, so
// the /inventory and bag category menus stay unchanged until activation.
const MEGA_DATA = JSON.parse(fs.readFileSync(new URL("../data/pokedex/megas.json", import.meta.url), "utf8"));
const MEGA_FORM_NAMES = Object.fromEntries(MEGA_DATA.forms.map((f) => [f.id, f.name]));
export const MEGA_STONE_IDS = Object.freeze(MEGA_DATA.stones.map((s) => s.id));
for (const s of MEGA_DATA.stones) {
  const special = s.acquisition !== "random-pool";
  ITEMS.push(item({
    id: s.id,
    name: s.name,
    description: `Use on one of your ${s.baseSpecies} to permanently unlock ${s.forms.map((f) => MEGA_FORM_NAMES[f]).join(" / ")} for that Pokémon.`,
    category: "evolution",
    rarity: special ? "legendary" : "epic",
    maxStack: 99,
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: special ? ["milestone_voucher", "event"] : ["quest_rare", "daily_rare", "achievement", "event", "shard_exchange"],
    mega: Object.freeze({ species: s.species, forms: Object.freeze([...s.forms]), officialStatus: s.officialStatus, acquisition: s.acquisition }),
    sinceRelease: "M",
  }));
}
ITEMS.push(
  item({
    id: "mega_shard",
    name: "Mega Shard",
    description: "Fragments of Mega energy. Exchange 25 for any regular Mega Stone.",
    category: "evolution",
    rarity: "rare",
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: ["mega_drop", "mega_duplicate", "achievement"],
    sinceRelease: "M",
  }),
  item({
    id: "mega_stone_voucher",
    name: "Mega Stone Voucher",
    description: "Exchange for any regular Mega Stone of your choice.",
    category: "evolution",
    rarity: "epic",
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: ["achievement", "event"],
    sinceRelease: "M",
  }),
  item({
    id: "mega_stone_voucher_legendary",
    name: "Legendary Mega Stone Voucher",
    description: "Exchange for any Mega Stone, including Legendary and Mythical ones.",
    category: "evolution",
    rarity: "legendary",
    consumable: true,
    status: "defined",
    storage: "inventory",
    sources: ["milestone", "event"],
    sinceRelease: "M",
  }),
);

// ---------------- Technical Machines (TM system phase T3) ----------------
// 156 launch TMs "active", 16 held TMs "defined" (catalog/tms.js).
for (const def of tmItemDefinitions()) ITEMS.push(item(def));

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Valid item id shape: lowercase snake_case, 1–64 chars. */
export const ITEM_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** All catalog entries (frozen). */
export const listCatalog = () => ITEMS;

/** The entry for an id, or null. Never resolves prototype keys. */
export function getCatalogItem(id) {
  if (typeof id !== "string" || !ITEM_ID_PATTERN.test(id)) return null;
  return BY_ID.get(id) ?? null;
}

/** Defined AND obtainable today. */
export const isActive = (entry) => !!entry && entry.status === "active";

/** Can this id be held in user.items (active, inventory-stored)? */
export function isHoldable(id) {
  const e = getCatalogItem(id);
  return !!e && e.status === "active" && e.storage === "inventory";
}
