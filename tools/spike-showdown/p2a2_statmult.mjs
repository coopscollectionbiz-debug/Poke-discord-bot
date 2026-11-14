import { newBattleHooked, mkSet, bd, Dex } from './lib.mjs';
const IV = 15, core = (b, L) => Math.floor(((2 * b + IV) * L) / 100);
const ours = (bs, L, k) => ({ hp: Math.round((core(bs.hp, L) + L + 10) * k), ...Object.fromEntries(['atk','def','spa','spd','spe'].map(s => [s, Math.round((core(bs[s], L) + 5) * k)])) });
const ks = [1, 1.1, 1.37, 2.9, 7.5];
let n = 0, bad = 0, ex = null, baseDiff = 0;
for (const [id, sp] of Object.entries(bd.species)) {
  if (+id > 1025) continue;
  const sd = Dex.species.get(sp.name); if (!sd.exists) continue;
  const L = [5, 37, 50, 100][+id % 4], k = ks[+id % 5];
  const set = { ...mkSet(sd.name, ['tackle'], { level: L }), statMult: k };
  const b = newBattleHooked({ teams: [[set], [mkSet('Pikachu', ['tackle'])]] });
  const p = b.sides[0].pokemon[0];
  const got = { hp: p.maxhp, atk: p.storedStats.atk, def: p.storedStats.def, spa: p.storedStats.spa, spd: p.storedStats.spd, spe: p.storedStats.spe };
  const want = ours(sd.baseStats, L, k); // OUR formula on SHOWDOWN base stats: isolates the mechanism
  n++; if (Object.keys(want).some(s => got[s] !== want[s])) { bad++; ex ??= { id, got, want }; }
}
console.log({ speciesChecked: n, mismatchVsOurFormula: bad, ex });
