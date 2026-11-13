import { newBattleHooked, mkSet, installRules } from './lib.mjs';
// Crit rate and damage-roll range, measured on Body Slam into a 100000-HP Magikarp (HP reset every turn).
// 900 samples per Battle (the engine force-ties at turn 1000), 10 Battles.
function sample(rules) {
  let n = 0, crit = 0; const dmgs = new Map(); const critD = [];
  for (let g = 0; g < 10; g++) {
    const b = newBattleHooked({ teams: [[mkSet('Snorlax', ['bodyslam'], { level: 100 })], [mkSet('Magikarp', ['splash'], { level: 100 })]], seed: 100 + g,
      beforeStart: (bt) => { if (rules) installRules(bt, rules); } });
    const atk = b.sides[0].pokemon[0], def = b.sides[1].pokemon[0]; def.maxhp = def.baseMaxhp = 100000;
    for (let i = 0; i < 900; i++) {
      [atk, def].forEach(p => p.moveSlots.forEach(m => { m.pp = 99; })); def.hp = def.maxhp; b.log.length = 0;
      b.sides[0].choose('move 1'); b.sides[1].choose('move 1'); b.commitChoices();
      const d = def.maxhp - def.hp, c = b.log.some(l => l.startsWith('|-crit'));
      n++; if (c) { crit++; critD.push(d); } else dmgs.set(d, (dmgs.get(d) ?? 0) + 1);
    }
  }
  const k = [...dmgs.keys()].sort((a, b) => a - b), max = k.at(-1);
  return { n, critRate: +(crit / n).toFixed(4), minNonCrit: k[0], maxNonCrit: max, minOverMax: +(k[0] / max).toFixed(3), critMaxOverNonCritMax: +(Math.max(...critD) / max).toFixed(2) };
}
console.log('Showdown default (expect crit 1/24=0.0417, roll 0.85):', sample(null));
console.log('Our overrides    (expect crit 1/12=0.0833, roll 0.80):', sample({ dmgMin: 80, crit: 12 }));
