// ==========================================================
// tools/lib/megaRules.mjs — hand-maintained Mega Evolution rules that
// the source data can't express. Build-time only (tools/generate-megas.mjs);
// the bot never imports this file. Every entry traces to an approved
// decision (docs/mega-evolution/README.md, D-1…D-17) or to the audit.
// ==========================================================

/** Legends: Z-A Mega Stones whose Mega is Mega Dimension content although the
 *  stone sits in the base game's item block (Serebii: stones found in Hyperspace;
 *  Serebii's Mega Dimension page lists Mega Heatran). */
export const MEGA_DIMENSION_OVERRIDES = new Set(["Heatran-Mega", "Darkrai-Mega", "Zeraora-Mega"]);

/** Records that are official but not supported (stable id → reasons). */
export const BLOCKED = {
  "mega-rayquaza": [
    "prerequisite-move: Mega Rayquaza needs Dragon Ascent, not a stone (D-9). The bot's movesets are automatic, and Rayquaza's Gen 5 level-up list has no Dragon Ascent, so the prerequisite can't be met yet.",
  ],
  "mega-floette": [
    "prerequisite-forme: only Floette-Eternal can Mega Evolve. The bot has only regular Floette (#670) (D-16).",
  ],
  "mega-zygarde": [
    "prerequisite-forme: only Zygarde Complete Forme can Mega Evolve. The bot has only base Zygarde (#718) (D-16).",
    "sprite: no acceptable 2D sprite (normal or shiny) in any audited source.",
  ],
  "mega-magearna-original": [
    "unsupported-variant: only the standard Magearna Mega is supported (D-8). The bot has no Original Color Magearna.",
  ],
};

/** Variant choices stored with the unlock (D-6, D-7). */
export const VARIANT_GROUPS = {
  Meowstic: { kind: "gender", byForme: { "M-Mega": "m", "F-Mega": "f" }, decision: "D-6" },
  Tatsugiri: { kind: "appearance", byForme: { "Curly-Mega": "curly", "Droopy-Mega": "droopy", "Stretchy-Mega": "stretchy" }, decision: "D-7" },
  Magearna: { kind: "color", byForme: { Mega: "standard", "Original-Mega": "original" }, decision: "D-8" },
};

/** Showdown lists two abilities for these Megas. D-11: slot 0, unverified (Legends: Z-A has no abilities in play). */
export const ABILITY_SLOT_RULE = { "Heatran-Mega": "0", "Tatsugiri-Curly-Mega": "0", "Tatsugiri-Droopy-Mega": "0", "Tatsugiri-Stretchy-Mega": "0" };

// ----------------------------------------------------------
// Ability implementation manifest (D-5: every battle-relevant ability must
// work before gameplay launches). Categories:
//   supported      – already modelled by utils/battle/sim.js
//   current-engine – can be modelled with damage/accuracy/immunity rules in
//                    the existing sim (may need move flags in battleData)
//   new-system     – needs a new battle subsystem (listed in `requires`)
//   no-effect      – nothing in this battle format can trigger it
// ----------------------------------------------------------
const CE = "current-engine", NS = "new-system", NE = "no-effect";
export const ABILITY_RULES = {
  "Adaptability": { category: CE, rule: "STAB multiplier 2 instead of 1.5." },
  "Aerilate": { category: CE, rule: "Normal-type moves become Flying-type and get ×1.2 power." },
  "Pixilate": { category: CE, rule: "Normal-type moves become Fairy-type and get ×1.2 power." },
  "Refrigerate": { category: CE, rule: "Normal-type moves become Ice-type and get ×1.2 power." },
  "Dragonize": { category: CE, rule: "Normal-type moves become Dragon-type and get ×1.2 power (Showdown, Future)." },
  "Aura Break": { category: CE, rule: "Reverses Fairy Aura/Dark Aura (only matters against Mega Floette, which is blocked)." },
  "Aura Guard": { category: CE, rule: "Contact damage taken ×0.5 (Showdown, Future).", moveFlags: ["contact"] },
  "Bulletproof": { category: CE, rule: "Immune to ball and bomb moves.", moveFlags: ["bullet"] },
  "Fairy Aura": { category: CE, rule: "Fairy-type moves of both battlers ×4/3." },
  "Filter": { category: CE, rule: "Super-effective damage taken ×0.75." },
  "Fire Mane": { category: CE, rule: "Attacking stat ×1.5 for Fire-type moves (Showdown, Future)." },
  "Flash Fire": { category: CE, rule: "Fire immunity; after absorbing one, own Fire moves ×1.5 (per-battler flag, no stat stages)." },
  "Huge Power": { category: CE, rule: "Attack ×2." },
  "Pure Power": { category: CE, rule: "Attack ×2." },
  "Innards Out": { category: CE, rule: "When KO'd by a move, the attacker loses HP equal to the damage taken." },
  "Iron Fist": { category: CE, rule: "Punching moves ×1.2.", moveFlags: ["punch"] },
  "Levitate": { category: CE, rule: "Immune to Ground-type moves." },
  "Mega Launcher": { category: CE, rule: "Pulse moves ×1.5.", moveFlags: ["pulse"] },
  "Mega Sol": { category: CE, rule: "Own moves act as in harsh sunlight: Fire ×1.5, Water ×0.5 (Showdown, Future)." },
  "Mold Breaker": { category: CE, rule: "Ignores the target's ability (only relevant against another battler with an ability)." },
  "Multiscale": { category: CE, rule: "Damage taken ×0.5 while at full HP." },
  "No Guard": { category: CE, rule: "Every move used by or against this battler hits." },
  "Parental Bond": { category: CE, rule: "Single-hit damaging moves hit a second time at ×0.25." },
  "Protean": { category: CE, rule: "Before attacking, its type becomes the move's type (always STAB; defensive type changes).", requires: ["mutable battler types"] },
  "Scrappy": { category: CE, rule: "Normal- and Fighting-type moves hit Ghost-types." },
  "Sharpness": { category: CE, rule: "Slicing moves ×1.5.", moveFlags: ["slicing"] },
  "Sheer Force": { category: CE, rule: "Moves with secondary effects ×1.3 (secondary effects are not simulated anyway).", moveFlags: ["secondary"] },
  "Shell Armor": { category: CE, rule: "Can't be hit by critical hits." },
  "Skill Link": { category: CE, rule: "Multi-hit moves always hit the maximum number of times." },
  "Strong Jaw": { category: CE, rule: "Biting moves ×1.5.", moveFlags: ["bite"] },
  "Technician": { category: CE, rule: "Moves with power ≤ 60 get ×1.5." },
  "Thick Fat": { category: CE, rule: "Fire- and Ice-type damage taken ×0.5." },
  "Tough Claws": { category: CE, rule: "Contact moves ×1.3.", moveFlags: ["contact"] },
  "Volt Absorb": { category: CE, rule: "Electric immunity; heals 1/4 max HP when hit by an Electric move." },

  "Speed Boost": { category: NS, requires: ["stat stages", "end-of-turn effects"], rule: "+1 Speed at the end of each turn." },
  "Intimidate": { category: NS, requires: ["stat stages", "switch-in effects"], rule: "On entry, lowers the opponent's Attack by 1." },
  "Contrary": { category: NS, requires: ["stat stages"], rule: "Stat changes are inverted (only matters once moves or abilities change stats)." },
  "Defiant": { category: NS, requires: ["stat stages", "switch-in effects"], rule: "+2 Attack when an opponent lowers its stats (e.g. Intimidate)." },
  "Berserk": { category: NS, requires: ["stat stages"], rule: "+1 Sp. Atk when an attack drops it below half HP." },
  "Soul-Heart": { category: NS, requires: ["stat stages"], rule: "+1 Sp. Atk whenever any battler faints." },
  "Thermal Exchange": { category: NS, requires: ["stat stages", "status: burn"], rule: "+1 Attack when hit by a Fire move; can't be burned." },
  "Eelevate": { category: NS, requires: ["stat stages"], rule: "Ground immunity, plus +1 to its highest stat after a KO (Showdown, Future)." },
  "Lightning Rod": { category: NS, requires: ["stat stages"], rule: "Electric immunity, plus +1 Sp. Atk when hit by one." },
  "Storm Drain": { category: NS, requires: ["stat stages"], rule: "Water immunity, plus +1 Sp. Atk when hit by one." },
  "Drought": { category: NS, requires: ["weather", "switch-in effects"], rule: "Sets harsh sunlight on entry." },
  "Sand Stream": { category: NS, requires: ["weather", "switch-in effects", "end-of-turn effects"], rule: "Sets a sandstorm on entry." },
  "Snow Warning": { category: NS, requires: ["weather", "switch-in effects"], rule: "Sets snow on entry." },
  "Delta Stream": { category: NS, requires: ["weather", "switch-in effects"], rule: "Sets strong winds (removes Flying weaknesses)." },
  "Electric Surge": { category: NS, requires: ["terrain", "switch-in effects"], rule: "Sets Electric Terrain on entry." },
  "Sand Force": { category: NS, requires: ["weather"], rule: "Rock/Ground/Steel moves ×1.3 in a sandstorm; immune to sand damage." },
  "Solar Power": { category: NS, requires: ["weather", "end-of-turn effects"], rule: "Sp. Atk ×1.5 in sun, loses 1/8 HP each turn." },
  "Swift Swim": { category: NS, requires: ["weather"], rule: "Speed ×2 in rain." },
  "Spicy Spray": { category: NS, requires: ["status: burn"], rule: "Burns any attacker that hits it (Showdown, Future)." },
  "Flame Body": { category: NS, requires: ["status: burn"], rule: "30% chance to burn an attacker on contact." },

  "Unseen Fist": { category: NE, rule: "Ignores protection; no protecting moves are simulated." },
  "Piercing Drill": { category: NE, rule: "Hits through protection; no protecting moves are simulated." },
  "Stalwart": { category: NE, rule: "Ignores redirection; singles battles have none." },
  "Infiltrator": { category: NE, rule: "Ignores screens and substitutes; none are simulated." },
  "Regenerator": { category: NE, rule: "Heals on switching out; there is no voluntary switching." },
  "Insomnia": { category: NE, rule: "Prevents sleep; status is not simulated." },
  "Inner Focus": { category: NS, requires: ["stat stages", "switch-in effects"], rule: "Blocks Intimidate (Gen 8+), implemented with Intimidate in Phase M2. Flinching isn't simulated." },
  "Steadfast": { category: NE, rule: "Speed up on flinch; flinching is not simulated." },
  "Prankster": { category: NE, rule: "Priority for status moves; movesets contain only damaging moves." },
  "Magic Bounce": { category: NE, rule: "Reflects status moves; movesets contain only damaging moves." },
  "Trace": { category: CE, rule: "Copies the opposing battler's ability on entry (Phase M2); ordinary battlers have none, so it only matters against another Mega." },
  "Shadow Tag": { category: NE, rule: "Prevents switching; there is no voluntary switching." },
  "Healer": { category: NE, rule: "Cures an ally's status in doubles; no doubles or status." },
  "Commander": { category: NE, rule: "Doubles-only interaction with Dondozo." },
  "Bad Dreams": { category: NE, rule: "Damages sleeping foes; status is not simulated." },
};

/** Engine work needed for each new-system requirement (docs/mega-evolution/MEGA-ABILITY-MANIFEST.md). */
export const ENGINE_REQUIREMENTS = {
  "stat stages": "Per-battler stages −6…+6 for atk/def/spa/spd/spe with multipliers (2+n)/2 and 2/(2−n), applied in computeStats-derived values at damage and turn-order time; reset when the battler faints.",
  "switch-in effects": "A hook when a battler enters (battle start and after a faint), ordered by Speed, logged for playback.",
  "end-of-turn effects": "A phase after both moves resolve each turn (weather damage, Speed Boost, Solar Power), with KO handling and logging.",
  weather: "A battle-wide field (sun, rain, sand, snow, strong winds) with a duration (5 turns for abilities as of Gen 6+; strong winds until the setter leaves), damage modifiers, sand chip damage and immunities.",
  terrain: "A battle-wide terrain field (Electric Terrain: grounded Electric moves ×1.3, 5 turns).",
  "status: burn": "A non-volatile status on the battler: burn halves physical damage dealt and deals 1/16 max HP at end of turn; Fire-types are immune.",
  "mutable battler types": "Battler types become per-battle state (already a field on the battler; must stay out of the species data).",
};
