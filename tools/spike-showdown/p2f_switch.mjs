import { newBattleHooked, mkSet, installRules, drive, stripLog } from './lib.mjs';
// Forced slot-order switching: our chooser always picks the first non-fainted bench Pokemon; drag effects patched via getRandomSwitchable.
const first = (r) => {
  if (r.forceSwitch) return `switch ${r.side.pokemon.findIndex((p) => !p.active && !p.condition.endsWith(' fnt')) + 1}`;
  return 'move 1';
};
function run(dragFirst, seed, move) {
  const T1 = [mkSet('Gyarados', [move], { level: 50 }), mkSet('Pikachu', ['splash']), mkSet('Snorlax', ['splash']), mkSet('Gengar', ['splash']), mkSet('Mew', ['splash'])];
  const T2 = [mkSet('Skarmory', ['splash'], { level: 50 }), mkSet('Eevee', ['splash']), mkSet('Ditto', ['splash']), mkSet('Abra', ['splash']), mkSet('Ralts', ['splash'])];
  const b = newBattleHooked({ teams: [T1, T2], seed, beforeStart: (bt) => installRules(bt, { dragFirst }) });
  const seen = [];
  for (let t = 0; t < 4 && !b.ended; t++) { for (const i of [0, 1]) { const r = b.sides[i].activeRequest; if (r && !r.wait) b.sides[i].choose(first(r)); } if (b.allChoicesDone()) b.commitChoices(); else { for (const i of [0, 1]) { const r = b.sides[i].activeRequest; if (r && !r.wait && !b.sides[i].isChoiceDone()) b.sides[i].choose(first(r)); } b.commitChoices(); } }
  return stripLog(b).filter(l => l.startsWith('|drag|p2')).map(l => l.split('|')[2].split(': ')[1]);
}
for (const mv of ['roar', 'dragontail']) {
  console.log(mv, 'default random drag, 6 seeds :', [1,2,3,4,5,6].map(s => run(false, s, mv)[0] ?? 'none').join(','));
  console.log(mv, 'patched first-in-slot, 6 seeds :', [1,2,3,4,5,6].map(s => run(true, s, mv)[0] ?? 'none').join(','));
}
// U-turn / faint switch requests are explicit requests -> chooser decides
const b = newBattleHooked({ teams: [[mkSet('Scizor', ['uturn'], { level: 50 }), mkSet('Pikachu', ['splash']), mkSet('Mew', ['splash'])], [mkSet('Snorlax', ['splash'], { level: 50 }), mkSet('Eevee', ['splash'])]], seed: 9 });
b.sides[0].choose('move 1'); b.sides[1].choose('move 1'); b.commitChoices();
console.log('after U-turn, p1 request has forceSwitch:', JSON.stringify(b.sides[0].activeRequest?.forceSwitch), 'requestState', b.sides[0].requestState, '| p2 wait:', b.sides[1].activeRequest?.wait);
