import { Dex, bd, newBattle, drive, mkSet, stripLog } from './lib.mjs';
const dex = Dex.forFormat('gen9customgame');
const S = ['hp','atk','def','spa','spd','spe'];
// --- species ---
let n = 0, stat = 0, type = 0, either = 0, missing = 0, past = 0; const statEx = [], typeEx = [];
for (let id = 1; id <= 649; id++) {
  const o = bd.species[id]; const sd = dex.species.get(o.name);
  if (!sd.exists || sd.num !== id) { missing++; continue; }
  n++; if (sd.isNonstandard === 'Past') past++;
  const sdiff = S.some(s => o.baseStats[s] !== sd.baseStats[s]), tdiff = o.types.join() !== sd.types.join();
  if (sdiff) { stat++; if (statEx.length < 6) statEx.push(`${o.name} ${S.map(s=>o.baseStats[s]+'>'+sd.baseStats[s]).join(' ')}`); }
  if (tdiff) { type++; if (typeEx.length < 6) typeEx.push(`${o.name} ${o.types}>${sd.types}`); }
  if (sdiff || tdiff) either++;
}
console.log({ speciesChecked: n, nameOrNumMismatch: missing, baseStatsDiffer: stat, typesDiffer: type, either, speciesIsNonstandardPast: past }); console.log(statEx, typeEx);
// species #650+ sanity
let n2 = 0, d2 = 0; for (let id = 650; id <= 1025; id++) { const o = bd.species[id]; if (!o) continue; const sd = dex.species.get(o.name); if (!sd.exists) { d2++; continue; } n2++; if (S.some(s => o.baseStats[s] !== sd.baseStats[s]) || o.types.join() !== sd.types.join()) d2++; }
console.log('#650-1025 differing or missing:', d2, 'of', n2);
// --- moves ---
const mids = Object.keys(bd.moves); let mm = 0, mmiss = 0, anyCount = 0; const diffs = { power: 0, accuracy: 0, type: 0, category: 0 }; const mex = [];
for (const id of mids) {
  const o = bd.moves[id], m = dex.moves.get(id);
  if (!m.exists) { mmiss++; continue; }
  mm++; let any = false;
  if ((o.power ?? 0) !== m.basePower) { diffs.power++; any = true; }
  if (o.accuracy !== m.accuracy) { diffs.accuracy++; any = true; }
  if (o.type !== m.type) { diffs.type++; any = true; }
  if (o.category !== m.category) { diffs.category++; any = true; }
  if (any) anyCount++; if (any && mex.length < 6) mex.push(`${o.name}: ${o.power}/${o.accuracy}/${o.type}/${o.category} > ${m.basePower}/${m.accuracy}/${m.type}/${m.category}`);
}
console.log({ movesInBattleData: mids.length, missingInShowdown: mmiss, compared: mm, differingFields: diffs, movesWithAnyDiff: anyCount }, mex);
const pastMoves = mids.filter(id => dex.moves.get(id).isNonstandard === 'Past').length;
console.log('battleData moves flagged isNonstandard Past in gen9:', pastMoves);
// --- Past species/moves actually working in one battle ---
const pastSpecies = [...dex.species.all()].filter(s => s.isNonstandard === 'Past' && s.num <= 649 && !s.forme).slice(0, 3).map(s => s.name);
console.log('Past species picked:', pastSpecies);
const b = newBattle({ seed: 11, teams: [
  [mkSet('Butterfree', ['pursuit', 'return', 'hiddenpowerfire', 'frustration'], { level: 100 })],
  [mkSet('Blissey', ['splash', 'uturn'], { level: 100 }), mkSet('Chansey', ['splash'], { level: 100 })]] });
for (let t = 0; t < 4; t++) { b.sides[0].choose(`move ${t + 1}`); b.sides[1].choose(t === 1 ? 'switch 2' : 'move 1'); b.commitChoices(); }
const used = stripLog(b).filter(l => l.startsWith('|move|p1a')).map(l => l.split('|')[3]);
console.log('Past species Butterfree (isNonstandard:', dex.species.get('Butterfree').isNonstandard + ') used Past moves:', used.join(', '), '| damage lines:', stripLog(b).filter(l => l.startsWith('|-damage|p2a')).length, '| error/debug lines:', stripLog(b).filter(l => /^\|(error|debug)/.test(l)).length);
console.log('Pursuit isNonstandard:', dex.moves.get('pursuit').isNonstandard, 'Return:', dex.moves.get('return').isNonstandard, 'HP:', dex.moves.get('hiddenpowerfire').isNonstandard);

// Keeping OUR Gen-5 base stats: set.baseStats override inside statModify (Pikachu Gen5 def 30 / Showdown 40)
{
  const { newBattleHooked } = await import('./lib.mjs');
  const mk = (o) => newBattleHooked({ teams: [[{ ...mkSet('Pikachu', ['tackle'], { level: 50 }), ...o }], [mkSet('Eevee', ['tackle'])]] }).sides[0].pokemon[0].storedStats.def;
  console.log('Pikachu Lv50 Def: showdown base 40 ->', mk({}), '| with our Gen5 base 30 ->', mk({ baseStats: bd.species[25].baseStats }), '(our formula: ' + (Math.floor((2*30+15)*50/100)+5) + ')');
}
