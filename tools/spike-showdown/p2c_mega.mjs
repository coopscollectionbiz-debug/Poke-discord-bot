import fs from 'fs';
import { Dex, newBattleHooked, newBattle, drive, greedy, mkSet, stripLog } from './lib.mjs';
const forms = JSON.parse(fs.readFileSync(new URL('../../data/pokedex/megas.json', import.meta.url))).forms;
const dex = Dex.forFormat('gen9customgame');
let found = 0, statDiff = [], typeDiff = [], abDiff = [], missing = [];
for (const f of forms) {
  const s = dex.species.get(f.showdownName);
  if (!s.exists) { missing.push(f.id + ':' + f.showdownName); continue; }
  found++;
  if (Object.keys(f.baseStats).some(k => f.baseStats[k] !== s.baseStats[k])) statDiff.push(f.id);
  if (f.types.join() !== s.types.join()) typeDiff.push(f.id);
  if (!Object.values(s.abilities).includes(f.ability)) abDiff.push(`${f.id}:${f.ability}!=${Object.values(s.abilities)}`);
}
console.log({ forms: forms.length, foundInShowdown: found, missing, statDiff, typeDiff, abDiff });
// 1) start already Mega: species = mega forme directly
const T2 = [mkSet('Pikachu', ['tackle'])];
const b = newBattle({ teams: [[mkSet('Charizard-Mega-X', ['flamethrower', 'dragonclaw'], { ability: 'Tough Claws' })], T2], seed: 3 });
console.log('direct-Mega start:', stripLog(b).find(l => l.startsWith('|switch')), '| ability', b.sides[0].pokemon[0].ability, '| types', b.sides[0].pokemon[0].types);
// 2) Showdown's native mechanic in gen9: stone-holder, is mega offered?
const b2 = newBattle({ teams: [[mkSet('Charizard', ['flamethrower'], { item: 'Charizardite X' })], T2], seed: 3 });
console.log('native mega offered in gen9customgame request:', JSON.stringify(b2.sides[0].activeRequest.active[0].canMegaEvo));
