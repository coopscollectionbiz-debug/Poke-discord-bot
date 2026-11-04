// ==========================================================
// tools/generate-battle-data.mjs
// One-shot generator: Pokémon Showdown's Gen 5 data (via the dev-only
// @pkmn/dex + @pkmn/data packages, MIT) → battleData.json.
// The bot never imports @pkmn at runtime; only this script does.
//
// Run: npm run generate:battle-data
// ==========================================================

import fs from "fs";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";

const OUT = new URL("../battleData.json", import.meta.url);
const TYPES = ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost",
  "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark"];

// Moves that only work under a condition the sim doesn't model
// (sleeping target, not being hit first, first turn only, etc.).
const EXCLUDED_MOVES = new Set(["dreameater", "snore", "focuspunch", "fakeout", "lastresort",
  "synchronoise", "futuresight", "doomdesire", "skydrop", "struggle"]);

// Battle-usable: a plain damaging move. basePower > 1 also drops fixed-damage
// and variable-power moves (Night Shade, Seismic Toss, Flail, Low Kick…), and
// OHKO, self-KO, two-turn and recharge moves are left out because the sim has
// no effects to balance them.
function isBattleUsable(m) {
  return m.category !== "Status" && m.basePower > 1 && !m.ohko && !m.selfdestruct &&
    !m.flags.charge && !m.flags.recharge && !EXCLUDED_MOVES.has(m.id);
}

const g5 = new Generations(Dex).get(5);

const moves = {};
for (const m of g5.moves) {
  if (!isBattleUsable(m)) continue;
  moves[m.id] = {
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

const species = {};
for (const s of g5.species) {
  if (s.forme) continue;
  const learnset = (await g5.learnsets.get(s.name))?.learnset ?? {};
  const levelMoves = [];
  for (const [moveId, sources] of Object.entries(learnset)) {
    if (!moves[moveId]) continue;
    for (const src of sources) {
      const lvl = /^5L(\d+)$/.exec(src);
      if (lvl) levelMoves.push([Number(lvl[1]), moveId]);
    }
  }
  levelMoves.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  species[s.num] = { name: s.name, types: s.types, baseStats: s.baseStats, levelMoves };
}

const typeChart = {};
for (const atk of TYPES) {
  for (const def of TYPES) {
    const mult = g5.types.totalEffectiveness(atk, [def]);
    if (mult !== 1) (typeChart[atk] ??= {})[def] = mult;
  }
}

const fallbackByType = {};
for (const t of TYPES) {
  const [id] = Object.entries(moves)
    .filter(([, m]) => m.type === t && m.power >= 20)
    .sort(([a, ma], [b, mb]) => ma.power - mb.power || a.localeCompare(b))[0];
  fallbackByType[t] = id;
}

const data = { source: { package: "@pkmn/dex@0.10.12", gen: 5 }, species, moves, typeChart, fallbackByType };
const json = JSON.stringify(data);
fs.writeFileSync(OUT, json);
console.log(`species ${Object.keys(species).length}, moves ${Object.keys(moves).length}, ${json.length} bytes`);
