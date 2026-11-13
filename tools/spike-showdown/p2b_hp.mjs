import { newBattleHooked, drive, greedy, mkSet, stripLog } from './lib.mjs';
const T = () => [[mkSet('Charizard',['flamethrower']), mkSet('Blastoise',['surf']), mkSet('Venusaur',['gigadrain']), mkSet('Snorlax',['bodyslam'])],
                 [mkSet('Dragonite',['outrage']), mkSet('Tyranitar',['crunch']), mkSet('Machamp',['closecombat'])]];
// hpFraction semantics copied from sim.js buildMon: undefined=full, <=0 fainted, else max(1, round(max*f))
const frac = [[0.5, 1, 0, 0.001], [undefined, 0, 1]];
const b = newBattleHooked({ teams: T(), seed: 7, beforeStart: (bt) => bt.sides.forEach((s, i) => s.pokemon.forEach((p, j) => {
  const f = frac[i][j]; if (f === undefined) return;
  if (f <= 0) { p.hp = 0; p.fainted = true; p.status = 'fnt'; }
  else p.hp = Math.max(1, Math.round(p.maxhp * f));
})) });
// start() resets side.pokemonLeft = team size, so fainted starters are subtracted AFTER start
b.sides.forEach((s,i)=>s.pokemon.forEach((p,j)=>{ if (frac[i][j]!==undefined && frac[i][j]<=0) s.pokemonLeft--; }));
console.log(stripLog(b).filter(l=>l.startsWith('|switch')).slice(0,4).join('\n'));
console.log('p1 req condition:', b.sides[0].activeRequest.side.pokemon.map(p=>p.condition).join(' | '));
console.log('p2 req condition:', b.sides[1].activeRequest.side.pokemon.map(p=>p.condition).join(' | '));
// Lead fainted case? (lead must be alive; we reorder outside engine)
try { drive(b, [greedy, greedy]); } catch (e) { console.log(stripLog(b).filter(l=>/faint|switch\|/.test(l)).join(" ; ")); console.log("ERR", e.message, "turn", b.turn, "left", b.sides.map(s=>s.pokemonLeft), JSON.stringify(b.sides[0].pokemon.map(p=>[p.name,p.hp,p.fainted])), b.sides.map(s=>[s.requestState, s.active[0].name, s.active[0].hp, s.active[0].fainted]), stripLog(b).slice(-12).join("\n")); }
console.log('ended', b.ended, 'winner', b.winner, 'turns', b.turn);
// any |switch| into a fainted slot?
console.log('switch lines:', stripLog(b).filter(l=>l.startsWith('|switch')).map(l=>l.split('|')[2]).join(', '));
