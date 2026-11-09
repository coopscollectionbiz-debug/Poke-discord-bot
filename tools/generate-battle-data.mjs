// ==========================================================
// tools/generate-battle-data.mjs
// Generator: Pokémon Showdown data (via the dev-only @pkmn/dex +
// @pkmn/data packages, MIT) → battleData.json.
// The bot never imports @pkmn at runtime; only this script does.
//
// Layout (Gen 6–9 expansion):
//   • #1–649 keep their Gen 5 base stats, Gen 5 level-up moves and every
//     Gen 5 move value, so unaffected Pokémon battle as before.
//   • Typing is modern for every species (Fairy is the 18th type). The 22
//     Gen 1–5 species retyped to Fairy also learn the Fairy-type damaging
//     moves they learn by level-up in their latest game, so their new type
//     has moves to match. Nothing else is added to Gen 1–5 learnsets.
//   • #650–1025 use base stats and level-up moves from the latest
//     generation that contains the species (9, else 8, else 7).
//   • Moves introduced after Gen 5 are added with their latest values.
//   • The type chart is the modern 18-type chart (Gen 6+: Fairy added,
//     Steel no longer resists Ghost or Dark).
//   • Fallback moves for the 17 original types are kept; Fairy gets one.
//
// Run: npm run generate:battle-data
// ==========================================================

import fs from "fs";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";

const OUT = new URL("../battleData.json", import.meta.url);
const POKEMON_DATA = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const LEGACY_TYPES = ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost",
  "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark"];
const TYPES = [...LEGACY_TYPES, "Fairy"];
// The Gen 5 fallbacks, frozen so new low-power moves never change an existing species' fallback.
const LEGACY_FALLBACKS = {
  Normal: "rage", Fighting: "doublekick", Flying: "peck", Poison: "smog", Ground: "mudslap", Rock: "rockblast",
  Bug: "furycutter", Ghost: "lick", Steel: "bulletpunch", Fire: "incinerate", Water: "bubble", Grass: "absorb",
  Electric: "thundershock", Psychic: "storedpower", Ice: "iciclespear", Dragon: "dualchop", Dark: "knockoff",
};
const LAST_GEN5_MOVE = 559; // V-create

// Moves that only work under a condition the sim doesn't model
// (sleeping target, not being hit first, first turn only, etc.).
const EXCLUDED_MOVES = new Set(["dreameater", "snore", "focuspunch", "fakeout", "lastresort",
  "synchronoise", "futuresight", "doomdesire", "skydrop", "struggle",
  // Gen 6+: first-turn-only, item/terrain/condition-dependent, form-dependent or
  // self-damaging moves the sim can't model faithfully.
  "firstimpression", "belch", "steelroller", "upperhand", "poltergeist", "mindblown", "steelbeam", "chloroblast",
  "hyperspacefury", "aurawheel", "ivycudgel", "terastarstorm", "ragingbull", "revelationdance", "multiattack",
  "burnup", "doubleshock", "shelltrap", "beakblast", "fishiousrend", "boltbeak"]);

// Battle-usable: a plain damaging move. basePower > 1 also drops fixed-damage
// and variable-power moves (Night Shade, Seismic Toss, Flail, Low Kick…), and
// OHKO, self-KO, two-turn and recharge moves are left out because the sim has
// no effects to balance them. Z-Moves and Max Moves are never learnable.
function isBattleUsable(m) {
  return m.category !== "Status" && m.basePower > 1 && !m.ohko && !m.selfdestruct &&
    !m.flags.charge && !m.flags.recharge && !EXCLUDED_MOVES.has(m.id) && !m.isZ && !m.isMax;
}

const G = new Generations(Dex);
const g5 = G.get(5);
const MODERN = [9, 8, 7, 6].map((n) => G.get(n));

function moveRecord(m) {
  return {
    name: m.name,
    type: m.type,
    category: m.category,
    power: m.basePower,
    accuracy: m.accuracy,
    critRatio: m.critRatio ?? 1,
    // Effects the sim models, stored only on the moves that have them.
    ...(m.drain && { drain: m.drain }),
    ...(m.recoil && { recoil: m.recoil }),
    ...(m.hasCrashDamage && { crash: true }),
    ...(m.multihit && { multihit: m.multihit }),
    ...(m.multiaccuracy && { multiaccuracy: true }),
    // Triple Kick's 10, 20, then 30 power is a Showdown callback, not data.
    ...(m.id === "triplekick" && { risingPower: true }),
    ...(m.priority && { priority: m.priority }),
  };
}

const moves = {};
for (const m of g5.moves) if (isBattleUsable(m)) moves[m.id] = moveRecord(m);
const legacyMoveCount = Object.keys(moves).length;
// Moves new since Gen 5, with the values of the latest generation that has them.
for (const gen of MODERN) {
  for (const m of gen.moves) {
    if (moves[m.id] || m.num <= LAST_GEN5_MOVE || !isBattleUsable(m)) continue;
    moves[m.id] = moveRecord(m);
  }
}

function levelMovesFrom(learnset, genNum, filter = () => true) {
  const out = [];
  const re = new RegExp(`^${genNum}L(\\d+)$`);
  for (const [moveId, sources] of Object.entries(learnset)) {
    if (!moves[moveId] || !filter(moves[moveId])) continue;
    for (const src of sources) {
      const lvl = re.exec(src);
      if (lvl) out.push([Math.max(1, Number(lvl[1])), moveId]); // level 0 = learned on evolution
    }
  }
  return out;
}

const latestGenWith = (name) => MODERN.find((gen) => gen.species.get(name));
const baseFormeName = (num) => Dex.species.all().find((x) => x.num === num && !x.forme)?.name;

const species = {};
const notes = { retypedWithFairyMoves: {}, learnsetGeneration: {} };
for (const s of g5.species) {
  if (s.forme) continue;
  const learnset = (await g5.learnsets.get(s.name))?.learnset ?? {};
  const levelMoves = levelMovesFrom(learnset, 5);
  const modernTypes = Dex.species.get(s.name).types;
  if (modernTypes.includes("Fairy") && !s.types.includes("Fairy")) {
    const gen = latestGenWith(s.name);
    const ls = (await gen.learnsets.get(s.name))?.learnset ?? {};
    const added = levelMovesFrom(ls, gen.num, (m) => m.type === "Fairy");
    levelMoves.push(...added);
    notes.retypedWithFairyMoves[s.num] = { name: s.name, from: `gen${gen.num}`, moves: added.map(([l, m]) => `${m}@${l}`) };
  }
  levelMoves.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  species[s.num] = { name: s.name, types: modernTypes, baseStats: s.baseStats, levelMoves };
}
for (let num = 650; num <= 1025; num++) {
  const name = baseFormeName(num);
  const gen = name && latestGenWith(name);
  if (!gen) throw new Error(`no generation data for #${num} ${name}`);
  const ls = (await gen.learnsets.get(name))?.learnset ?? {};
  const levelMoves = levelMovesFrom(ls, gen.num);
  levelMoves.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  // Base stats/types: Showdown's base forme, the same source pokemonData uses.
  const latest = Dex.species.get(name);
  species[num] = { name: latest.name, types: latest.types, baseStats: latest.baseStats, levelMoves };
  notes.learnsetGeneration[num] = gen.num;
}

const g9 = G.get(9);
const typeChart = {};
for (const atk of TYPES) {
  for (const def of TYPES) {
    const mult = g9.types.totalEffectiveness(atk, [def]);
    if (mult !== 1) (typeChart[atk] ??= {})[def] = mult;
  }
}

const fallbackByType = { ...LEGACY_FALLBACKS };
for (const t of TYPES) {
  if (fallbackByType[t]) continue;
  const [id] = Object.entries(moves)
    .filter(([, m]) => m.type === t && m.power >= 20)
    .sort(([a, ma], [b, mb]) => ma.power - mb.power || a.localeCompare(b))[0];
  fallbackByType[t] = id;
}

// Every species in pokemonData must have battle data, with matching types.
const missing = Object.keys(POKEMON_DATA).filter((id) => !species[id]);
if (missing.length) throw new Error(`battle data missing for ${missing.join(", ")}`);

const data = {
  source: { package: "@pkmn/dex@0.10.12", legacyGen: 5, modernGens: [9, 8, 7], typeChartGen: 9, legacyMoves: legacyMoveCount },
  species, moves, typeChart, fallbackByType,
};
const json = JSON.stringify(data);
fs.writeFileSync(OUT, json);
fs.writeFileSync(new URL("../data/pokedex/battle-build-notes.json", import.meta.url), JSON.stringify(notes, null, 1) + "\n");
console.log(`species ${Object.keys(species).length}, moves ${Object.keys(moves).length} (${legacyMoveCount} Gen 5), ${json.length} bytes`);
