// Exact stat control via fake EV/IV (native: no mutation). Compares engine stats to OUR formula incl. statMult, over all species/levels.
import { newBattle, mkSet, bd, Dex } from './lib.mjs';
const IV = 15;
const core = (b, L) => Math.floor(((2 * b + IV) * L) / 100);
const ours = (bs, L, k) => ({ hp: Math.round((core(bs.hp, L) + L + 10) * k), ...Object.fromEntries(['atk','def','spa','spd','spe'].map(s => [s, Math.round((core(bs[s], L) + 5) * k)])) });
// Solve EV/IV so Showdown's formula returns target t (uses OUR base stats, so data shift in stats is neutralised too).
function fit(sdBase, t, L, hp) {
  const off = hp ? L + 10 : 5;
  const need = Math.ceil(((t - off) * 100) / L); // smallest X = 2B+iv+ev/4 with floor(X*L/100)=t-off
  const e4 = need - 2 * sdBase - IV;
  return e4 >= 0 ? { iv: IV, ev: e4 * 4 } : { iv: need - 2 * sdBase, ev: 0 };
}
const stats = ['hp','atk','def','spa','spd','spe'];
let n = 0, bad = 0, ex = null;
const ks = [1, 1.1, 1.37, 2.9];
for (const [id, sp] of Object.entries(bd.species)) {
  if (+id > 1025) continue;
  const L = [5, 37, 50, 100][+id % 4], k = ks[+id % 4];
  const t = ours(sp.baseStats, L, k);
  const sd = Dex.species.get(sp.name);
  if (!sd.exists) continue;
  const evs = {}, ivs = {};
  for (const s of stats) { const f = fit(sd.baseStats[s], t[s], L, s === 'hp'); evs[s] = f.ev; ivs[s] = f.iv; }
  // evaluate the engine's own formula: build a real battle and read stats back from the request
  const set = { ...mkSet(sd.name, ['tackle'], { level: L }), evs, ivs };
  const b = newBattle({ teams: [[set], [mkSet('Pikachu', ['tackle'])]], seed: 1 });
  const p = b.sides[0].pokemon[0];
  const got = { hp: p.maxhp, atk: p.storedStats.atk, def: p.storedStats.def, spa: p.storedStats.spa, spd: p.storedStats.spd, spe: p.storedStats.spe };
  n++;
  if (stats.some(s => got[s] !== t[s])) { bad++; ex ??= { id, name: sp.name, L, k, t, got }; }
}
console.log({ checked: n, mismatches: bad, firstMismatch: ex });
