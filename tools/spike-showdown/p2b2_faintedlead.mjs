import { newBattleHooked, mkSet, stripLog } from './lib.mjs';
const T = (n) => ['A', 'B', 'C'].slice(0, n).map((x, i) => mkSet(['Charizard', 'Blastoise', 'Venusaur'][i], ['tackle'], { name: 's' + i }));
const kill = (idxs) => (bt) => bt.sides[0].pokemon.forEach((p, j) => { if (idxs.includes(j)) { p.hp = 0; p.fainted = true; p.status = 'fnt'; } });
function attempt(label, idxs) {
  try {
    const b = newBattleHooked({ teams: [T(3), T(3)], seed: 3, beforeStart: kill(idxs) });
    b.sides[0].pokemonLeft -= idxs.length;
    const q = b.sides[0].activeRequest;
    console.log(label, '| ended', b.ended, '| winner', JSON.stringify(b.winner), '| active', b.sides[0].active[0].name, 'hp', b.sides[0].active[0].hp, '| req', q ? Object.keys(q).join(',') : null, '| log tail:', stripLog(b).slice(-3).join(' / '));
  } catch (e) { console.log(label, 'THROWS', e.message.split('\n')[0]); }
}
attempt('fainted lead (slot 0 hp=0, in place)   ', [0]);
attempt('all 3 fainted on side 0                ', [0, 1, 2]);
// recommended workaround: omit fainted members from the engine team (names keep original slot), pre-check outAtStart outside the engine
const alive = T(3).filter((_, i) => i !== 0);
const b = newBattleHooked({ teams: [alive, T(3)], seed: 3 });
console.log('omit fainted slot 0 -> engine lead is', b.sides[0].active[0].name, '(original slot s1), bench:', b.sides[0].pokemon.slice(1).map(p => p.name).join(','));
