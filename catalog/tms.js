// ==========================================================
// catalog/tms.js — Technical Machine catalog entries and prices (TM T3).
//
// One item per catalog move in data/battle/tm-data.json (generated, T2):
//   id "tm_<moveId>", category "tm", inventory stack, consumed only when a
//   TM is successfully taught (phase T4).
//   • launch moves → status "active" (obtainable)
//   • held moves   → status "defined" (grantItem refuses them; not sold)
//
// Prices (owner decision D-T6, 2026-11-11): by strategic tier, not rarity.
//   Basic 1,500 · Standard 3,000 · Power 5,000 · Premium 6,000 · Elite 7,500
// Elite = 120 power with 100% accuracy (Double-Edge, Flare Blitz, Brave
// Bird; Close Combat, Superpower and Outrage once their engine fixes land).
// The tier of every move is listed explicitly below (from the owner-approved
// TM audit catalog) so a data regeneration can never silently re-price one.
// ==========================================================

import fs from "fs";

const TM_DATA = JSON.parse(fs.readFileSync(new URL("../data/battle/tm-data.json", import.meta.url), "utf8"));
const BATTLE = JSON.parse(fs.readFileSync(new URL("../battleData.json", import.meta.url), "utf8"));

export const TM_PRICE_BY_TIER = Object.freeze({ basic: 1500, standard: 3000, power: 5000, premium: 6000, elite: 7500 });
const TIER_RARITY = Object.freeze({ basic: "common", standard: "uncommon", power: "rare", premium: "epic", elite: "legendary" });

const TIERS = {
  basic: "acidspray acrobatics aerialace aircutter assurance avalanche breakingswipe brine brutalswing bugbite bulldoze chargebeam chillingwater cut disarmingvoice dragontail drainingkiss echoedvoice electroweb falseswipe firefang firespin flamecharge flipturn frostbreath grassknot grassyglide gyroball icefang icywind incinerate infestation knockoff leechlife lowsweep magicalleaf metalclaw mudshot mudslap payback pinmissile pluck poisontail pounce poweruppunch psybeam revenge rocksmash rocktomb round sandtomb smackdown snarl strugglebug swift thief thunderfang trailblaze tripleaxel vacuumwave venoshock waterpulse whirlpool",
  standard: "airslash alluringvoice blazekick bodypress bodyslam brickbreak bulletseed burningjealousy crosspoison crunch darkestlariat darkpulse dazzlinggleam dragonclaw drainpunch drillrun dualwingbeat energyball expandingforce facade firepunch flashcannon gigadrain headbutt icepunch icespinner iciclespear ironhead irontail lashout liquidation lunge megapunch mysticalfire poisonjab powergem psychicfangs psychicnoise psychocut psyshock razorshell retaliate rockblast rockslide scald scaleshot scorchingsands seedbomb shadowball shadowclaw skittersmack smartstrike steelwing stompingtantrum strength tailslap temperflare terablast throatchop thunderpunch triattack uturn voltswitch waterfall xscissor zenheadbutt",
  power: "blizzard fireblast focusblast gunkshot hurricane hydropump megahorn megakick overheat powerwhip thunder",
  premium: "aurasphere bugbuzz dracometeor dragonpulse earthpower earthquake flamethrower foulplay heatwave highhorsepower hypervoice icebeam leafblade leafstorm muddywater petalblizzard playrough pollenpuff psychic sludgebomb sludgewave stoneedge supercellslam surf takedown thunderbolt uproar wildcharge",
  elite: "bravebird closecombat doubleedge flareblitz outrage superpower",
};
const TIER_OF = new Map(Object.entries(TIERS).flatMap(([tier, list]) => list.split(" ").map((id) => [id, tier])));

/** The price tier of a catalog move ("basic"…"elite"), or null. */
export const tmTierOf = (moveId) => TIER_OF.get(moveId) ?? null;

/**
 * Catalog item definitions for every TM (consumed by catalog/items.js).
 * Throws at load time if a catalog move has no tier, so nothing can be
 * sold without an approved price.
 */
export function tmItemDefinitions() {
  const out = [];
  for (const [moveId, m] of Object.entries(TM_DATA.moves)) {
    const tier = tmTierOf(moveId);
    if (!tier) throw new Error(`catalog/tms.js: no price tier for TM move "${moveId}"`);
    const mv = BATTLE.moves[moveId];
    const label = m.tm ? `${m.tm} ${mv.name}` : `TM ${mv.name}`;
    out.push({
      id: `tm_${moveId}`,
      name: label,
      description: `Teaches ${mv.name} (${mv.type}, ${mv.category}, ${mv.power} power) to one compatible Pokémon. Used up when taught.`,
      category: "tm",
      rarity: TIER_RARITY[tier],
      consumable: true,
      status: m.status === "launch" ? "active" : "defined",
      storage: "inventory",
      shop: { eligible: m.status === "launch", channel: "dashboard", price: { cc: TM_PRICE_BY_TIER[tier] }, tier },
      sources: ["shop"],
      tm: Object.freeze({ move: moveId, number: m.tm, type: mv.type, category: mv.category, power: mv.power, accuracy: mv.accuracy, ...(m.holdReason && { holdReason: m.holdReason }) }),
      sinceRelease: "TM",
    });
  }
  return out;
}
