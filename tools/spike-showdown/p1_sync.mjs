import { newBattle, drive, greedy, mkSet, stripLog } from './lib.mjs';
const T = () => [[
  mkSet('Charizard',['flamethrower','airslash','roost','toxic'],{item:'Leftovers',ability:'Blaze'}),
  mkSet('Blastoise',['hydropump','icebeam','rapidspin','toxic'],{item:'Leftovers',ability:'Torrent'}),
  mkSet('Venusaur',['gigadrain','sludgebomb','sleeppowder','synthesis'],{ability:'Overgrow'}),
  mkSet('Pikachu',['thunderbolt','voltswitch','surf','irontail'],{ability:'Static'}),
  mkSet('Snorlax',['bodyslam','earthquake','rest','curse'],{ability:'Immunity'}),
  mkSet('Gengar',['shadowball','sludgebomb','willowisp','destinybond'],{ability:'Cursed Body'}),
],[
  mkSet('Dragonite',['outrage','extremespeed','roost','thunderwave'],{ability:'Inner Focus'}),
  mkSet('Tyranitar',['crunch','stoneedge','stealthrock','pursuit'],{ability:'Sand Stream'}),
  mkSet('Alakazam',['psychic','shadowball','recover','calmmind'],{ability:'Synchronize'}),
  mkSet('Machamp',['closecombat','knockoff','bulkup','payback'],{ability:'No Guard'}),
  mkSet('Gyarados',['waterfall','dragondance','earthquake','roar'],{ability:'Intimidate'}),
  mkSet('Skarmory',['bravebird','spikes','whirlwind','roost'],{ability:'Sturdy'}),
]];
const run = () => { const b = newBattle({teams:T(), seed:42}); const t0=performance.now(); drive(b,[greedy,greedy]); return {b, ms: performance.now()-t0}; };
const a = run(), c = run();
console.log('ended', a.b.ended, 'winner', a.b.winner, 'turns', a.b.turn, 'log lines', a.b.log.length, 'ms', a.ms.toFixed(1));
console.log('first request type before any choice (teamPreview?):');
const b0 = newBattle({teams:T(), seed:42}); console.log(' turn', b0.turn, 'req keys', Object.keys(b0.sides[0].activeRequest), 'teamPreview' in b0.sides[0].activeRequest);
console.log('deterministic (log minus |t:|):', JSON.stringify(stripLog(a.b))===JSON.stringify(stripLog(c.b)));
const d = (()=>{const b=newBattle({teams:T(), seed:43}); drive(b,[greedy,greedy]); return JSON.stringify(stripLog(b))!==JSON.stringify(stripLog(a.b));})();
console.log('different seed differs:', d);
// with team preview on
const bp = newBattle({teams:T(), seed:42, format:'gen9customgame'}); console.log('with teampreview req:', JSON.stringify(bp.sides[0].activeRequest).slice(0,120));
console.log(stripLog(a.b).slice(0,25).join('\n'));
