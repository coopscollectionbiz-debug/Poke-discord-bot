// ==========================================================
// tools/generate-full-sim-data.mjs — builds data/battle/full-sim-data.json,
// the battle data the full sim uses (FULL_SIM_ENABLED; full-sim spec, "Data").
//
//   • species #1–1025: Gen 9 base stats and types, regular abilities
//     (hidden ones are never used), and the level-up learnset from the
//     latest game that teaches the species anything by level-up
//     (`learnsetGen`), status moves included
//   • moves: every real move the engine knows (no Z-, Max- or CAP moves),
//     status moves included, in battleData.json's record shape; a status
//     move also gets `roles`, what it does for the Battle plans
//     (catalog/battlePlans.js moveRoles), and a move that raises its user's
//     stats its `boosts`; an attack with a catch gets `drawback` (recharge,
//     charge, selfKO, conditional). Recommended moves read both
//     (services/battlePlans.js recommendMoves).
//   • abilityRatings: Showdown's 0–5 rating for every regular ability, which
//     utils/battle/ai/abilities.js picks from
//   • typeChart and fallbackByType: copied from battleData.json (already
//     the modern 18-type chart)
//
// battleData.json is never touched: it stays the legacy engines' data.
// Source: Pokémon Showdown's data (MIT) via the dev dependencies @pkmn/dex
// and @pkmn/data, the same versions @pkmn/sim pins, and @pkmn/sim itself
// for ability ratings.
//
// Usage: npm run generate:full-sim-data
// ==========================================================

import fs from "fs";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";
import { Dex as SimDex } from "@pkmn/sim"; // @pkmn/dex leaves out ability ratings

const OUT = new URL("../data/battle/full-sim-data.json", import.meta.url);
const LEGACY = JSON.parse(fs.readFileSync(new URL("../battleData.json", import.meta.url), "utf8"));
const G = new Generations(Dex, () => true); // keep species and moves that left Gen 9 ("Past")
const NEWEST_FIRST = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => G.get(n));
const NOT_MOVES = new Set(["CAP", "LGPE", "Custom", "Future"]);

// What a status move does for the plans, from the engine's own move data,
// so every move counts for the plans it helps without hand-kept lists.
const HAZARDS = new Set(["stealthrock", "spikes", "toxicspikes", "stickyweb"]);
const SCREENS = new Set(["reflect", "lightscreen", "auroraveil"]);
const STALL_VOLATILES = new Set(["leechseed", "yawn"]);
function statusRoles(m) {
  const roles = [];
  const raises = m.target === "self" && m.boosts && (m.boosts.atk > 0 || m.boosts.spa > 0 || m.boosts.spe > 0);
  if (raises) roles.push("setup");
  if (m.status || STALL_VOLATILES.has(m.volatileStatus)) roles.push("status");
  if (HAZARDS.has(m.sideCondition)) roles.push("hazard");
  if (SCREENS.has(m.sideCondition)) roles.push("screen");
  if (m.weather) roles.push("weather");
  if (m.pseudoWeather === "trickroom" || m.sideCondition === "tailwind") roles.push("speed");
  if (m.target === "self" && (m.heal || m.flags.heal)) roles.push("recovery");
  if (m.stallingMove) roles.push("protect");
  return roles;
}

// An attack's catch, for recommended moves: it must recharge, charges a turn
// first, faints its user, or fails unless something else is true. The engine
// flags the first three. The last is kept by hand: the engine's hooks that
// make these fail also sit on ordinary moves (Sucker Punch, Round, Pursuit).
const CONDITIONAL = new Set([
  "belch", "bide", "burnup", "comeuppance", "counter", "doomdesire", "doubleshock", "dreameater", "endeavor", "fakeout",
  "firstimpression", "fling", "focuspunch", "futuresight", "hyperspacefury", "lastresort", "metalburst", "mirrorcoat",
  "naturalgift", "poltergeist", "shelltrap", "snore", "spitup", "steelroller", "synchronoise",
]);
function drawback(m) {
  if (m.category === "Status") return null;
  if (m.flags.recharge) return "recharge";
  if (m.flags.charge) return "charge";
  if (m.selfdestruct) return "selfKO";
  return CONDITIONAL.has(m.id) ? "conditional" : null;
}

function moveRecord(m) {
  return {
    name: m.name,
    type: m.type,
    category: m.category,
    power: m.basePower,
    accuracy: m.accuracy,
    critRatio: m.critRatio ?? 1,
    target: m.target,
    ...(m.drain && { drain: m.drain }),
    ...(m.recoil && { recoil: m.recoil }),
    ...(m.hasCrashDamage && { crash: true }),
    ...(m.multihit && { multihit: m.multihit }),
    ...(m.priority && { priority: m.priority }),
    ...(m.category === "Status" && { roles: statusRoles(m) }),
    ...(m.category === "Status" && m.target === "self" && m.boosts && { boosts: m.boosts }),
    ...(drawback(m) && { drawback: drawback(m) }),
  };
}

const moves = {};
for (const m of Dex.moves.all()) {
  if (!m.exists || m.num <= 0 || m.isZ || m.isMax || NOT_MOVES.has(m.isNonstandard)) continue;
  moves[m.id] = moveRecord(m);
}

async function latestLevelMoves(name) {
  for (const gen of NEWEST_FIRST) {
    const learnset = (await gen.learnsets.get(name))?.learnset ?? {};
    const re = new RegExp(`^${gen.num}L(\\d+)$`);
    const out = [];
    for (const [moveId, sources] of Object.entries(learnset)) {
      if (!moves[moveId]) continue;
      for (const src of sources) {
        const lvl = re.exec(src);
        if (lvl) out.push([Math.max(1, Number(lvl[1])), moveId]); // level 0 = learned on evolution
      }
    }
    if (out.length) return { gen: gen.num, levelMoves: out.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])) };
  }
  return { gen: null, levelMoves: [] };
}

const species = {};
for (let num = 1; num <= 1025; num++) {
  const s = Dex.species.all().find((x) => x.num === num && !x.forme);
  if (!s) throw new Error(`no base species for #${num}`);
  const { gen, levelMoves } = await latestLevelMoves(s.name);
  species[num] = {
    name: s.name,
    types: s.types,
    baseStats: s.baseStats,
    abilities: [s.abilities["0"], s.abilities["1"]].filter(Boolean),
    learnsetGen: gen,
    levelMoves,
  };
}

const abilityRatings = {};
for (const s of Object.values(species)) {
  for (const name of s.abilities) {
    const a = SimDex.abilities.get(name);
    abilityRatings[a.id] = a.rating ?? 0;
  }
}

const data = {
  source: { package: "@pkmn/dex@0.10.12", rule: "Gen 9 stats, types and moves; each species' latest-game level-up learnset; regular abilities" },
  species,
  moves,
  abilityRatings,
  typeChart: LEGACY.typeChart,
  fallbackByType: LEGACY.fallbackByType,
};
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`full-sim-data.json: ${Object.keys(species).length} species, ${Object.keys(moves).length} moves, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
