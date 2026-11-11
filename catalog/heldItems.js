// ==========================================================
// catalog/heldItems.js — the held-item launch catalog (data only).
//
// 33 items: 8 free starter unlocks + 25 shop unlocks (amendment §5,
// docs/held-items/HELD-ITEM-AMENDMENT.md). Each one is a permanent,
// account-wide unlock: user.items[id] is 0 or 1 (maxStack 1), and one unlock
// can be equipped on one Pokémon in EACH team (Item Clause per team).
//
// Battle behaviour lives in utils/battle/items.js under the same id; this
// file never contains code. `effect` is the exact player-facing rule and
// must match the registry (tests/heldItemCatalog.test.js).
//
// Deferred (NOT here, never equippable at launch): Choice Band, Choice
// Specs, Choice Scarf, Life Orb, Rocky Helmet, Assault Vest.
// ==========================================================

export const HELD_GROUPS = Object.freeze({
  offense: { label: "Offense", order: 1 },
  defense: { label: "Defense", order: 2 },
  recovery: { label: "Recovery", order: 3 },
  utility: { label: "Speed & utility", order: 4 },
  type: { label: "Type", order: 5 },
  species: { label: "Species", order: 6 },
});

/** The eight free starter unlocks (owner requirement). */
export const STARTER_HELD_ITEMS = Object.freeze([
  "leftovers", "sitrus_berry", "focus_sash", "quick_claw", "expert_belt", "bright_powder", "focus_band", "lucky_egg",
]);
/** Bump when the starter set changes: players below it get the missing items (never duplicates). */
export const STARTER_GRANT_VERSION = 1;

const T = (type, id, name, glyph) => ({
  id, name, group: "type", rarity: "uncommon", glyph, price: 3000, boostsType: type,
  effect: `${type}-type moves have 1.2× power.`,
  rule: "Always active.",
});

export const HELD_ITEM_DEFS = Object.freeze([
  // ---------------- free starter unlocks ----------------
  { id: "leftovers", name: "Leftovers", group: "recovery", rarity: "rare", glyph: "🍖", starter: true,
    effect: "Restores 1/16 of max HP at the end of every turn.", rule: "Every turn while it is battling. Never heals a fainted Pokémon." },
  { id: "sitrus_berry", name: "Sitrus Berry", group: "recovery", rarity: "rare", glyph: "🍋", starter: true,
    effect: "Restores 1/4 of max HP when its HP falls to half or less.", rule: "Once per battle; ready again next battle. Never used up from your bag." },
  { id: "focus_sash", name: "Focus Sash", group: "defense", rarity: "rare", glyph: "🎗️", starter: true,
    effect: "At full HP, survives a hit that would knock it out, with 1 HP left.", rule: "Once per battle; ready again next battle. A multi-hit move's later hits can still knock it out." },
  { id: "quick_claw", name: "Quick Claw", group: "utility", rarity: "uncommon", glyph: "🦅", starter: true,
    effect: "20% chance each turn to move first among moves of the same priority.", rule: "Rolled every turn." },
  { id: "expert_belt", name: "Expert Belt", group: "offense", rarity: "uncommon", glyph: "🥋", starter: true,
    effect: "Super-effective attacks deal 1.2× damage.", rule: "Always active." },
  { id: "bright_powder", name: "Bright Powder", group: "defense", rarity: "uncommon", glyph: "✨", starter: true,
    effect: "Moves aimed at the holder have 0.9× accuracy.", rule: "Always active. Moves that never miss are not affected." },
  { id: "focus_band", name: "Focus Band", group: "defense", rarity: "uncommon", glyph: "🎀", starter: true,
    effect: "10% chance to survive a hit that would knock it out, with 1 HP left.", rule: "Rolled on every hit that would knock it out." },
  { id: "lucky_egg", name: "Lucky Egg", group: "utility", rarity: "rare", glyph: "🥚", starter: true, combat: false,
    effect: "The holder earns 1.5× battle EXP.", rule: "Battle EXP only. No effect in combat, on Power, or on any other reward." },

  // ---------------- shop unlocks ----------------
  { id: "eviolite", name: "Eviolite", group: "defense", rarity: "rare", glyph: "💠", price: 6000,
    effect: "Defense and Sp. Def are 1.5× if the holder can still evolve.", rule: "Always active. No effect on a Pokémon that can't evolve." },
  { id: "shell_bell", name: "Shell Bell", group: "recovery", rarity: "uncommon", glyph: "🐚", price: 5000,
    effect: "Restores 1/8 of the damage its attacks deal.", rule: "After each attack that deals damage." },
  { id: "black_sludge", name: "Black Sludge", group: "recovery", rarity: "uncommon", glyph: "🫧", price: 4000,
    effect: "Poison types restore 1/16 of max HP each turn; any other holder loses 1/8.", rule: "Every turn while it is battling." },
  { id: "muscle_band", name: "Muscle Band", group: "offense", rarity: "uncommon", glyph: "💪", price: 4000,
    effect: "Physical moves have 1.1× power.", rule: "Always active." },
  { id: "wise_glasses", name: "Wise Glasses", group: "offense", rarity: "uncommon", glyph: "👓", price: 4000,
    effect: "Special moves have 1.1× power.", rule: "Always active." },
  { id: "light_ball", name: "Light Ball", group: "species", rarity: "rare", glyph: "💡", price: 5000, restrictSpecies: [25],
    effect: "Pikachu's Attack and Sp. Atk are doubled.", rule: "Pikachu only." },
  { id: "thick_club", name: "Thick Club", group: "species", rarity: "rare", glyph: "🦴", price: 5000, restrictSpecies: [104, 105],
    effect: "Cubone's and Marowak's Attack is doubled.", rule: "Cubone and Marowak only." },
  T("Fire", "charcoal", "Charcoal", "🔥"),
  T("Water", "mystic_water", "Mystic Water", "💧"),
  T("Grass", "miracle_seed", "Miracle Seed", "🌱"),
  T("Electric", "magnet", "Magnet", "🧲"),
  T("Ice", "never_melt_ice", "Never-Melt Ice", "🧊"),
  T("Fighting", "black_belt", "Black Belt", "🥊"),
  T("Poison", "poison_barb", "Poison Barb", "☠️"),
  T("Ground", "soft_sand", "Soft Sand", "⏳"),
  T("Flying", "sharp_beak", "Sharp Beak", "🪶"),
  T("Psychic", "twisted_spoon", "Twisted Spoon", "🥄"),
  T("Bug", "silver_powder", "Silver Powder", "🐛"),
  T("Rock", "hard_stone", "Hard Stone", "🪨"),
  T("Ghost", "spell_tag", "Spell Tag", "👻"),
  T("Dragon", "dragon_fang", "Dragon Fang", "🐉"),
  T("Dark", "black_glasses", "Black Glasses", "🕶️"),
  T("Steel", "metal_coat", "Metal Coat", "⚙️"),
  T("Normal", "silk_scarf", "Silk Scarf", "🧣"),
  T("Fairy", "fairy_feather", "Fairy Feather", "🪽"),
].map((d) => Object.freeze({ starter: false, combat: true, restrictSpecies: null, boostsType: null, price: null, ...d })));

export const HELD_ITEM_IDS = Object.freeze(HELD_ITEM_DEFS.map((d) => d.id));
const BY_ID = new Map(HELD_ITEM_DEFS.map((d) => [d.id, d]));
export const getHeldItemDef = (id) => (typeof id === "string" ? BY_ID.get(id) ?? null : null);
