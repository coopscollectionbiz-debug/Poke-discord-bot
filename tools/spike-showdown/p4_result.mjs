import { newBattleHooked, mkSet, stripLog, installRules } from './lib.mjs';
// For each KO cause, run a tiny scripted battle where the victim is set to 1 HP, then print the log lines that
// immediately precede |faint| so we can see what [from]/[of] gives us.
const lowHp = (side, idx, hp = 1) => (b) => { b.sides[side].pokemon[idx].hp = hp; };
function scen(name, T1, T2, script, lowAt = [1, 0]) {
  const b = newBattleHooked({ teams: [T1, T2], seed: 21, beforeStart: (bt) => lowHp(lowAt[0], lowAt[1])(bt) });
  for (const [c1, c2] of script) {
    if (b.ended) break;
    const ch = (i, c) => { const r = b.sides[i].activeRequest; if (!r || r.wait) return; b.sides[i].choose(c === 'auto' ? (r.forceSwitch ? `switch ${r.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith(' fnt')) + 1}` : 'move 1') : c); };
    ch(0, c1); ch(1, c2);
    for (const i of [0, 1]) { const r = b.sides[i].activeRequest; if (r && !r.wait && !b.sides[i].isChoiceDone()) b.sides[i].choose(r.forceSwitch ? `switch ${r.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith(' fnt')) + 1}` : 'move 1'); }
    if (b.allChoicesDone()) b.commitChoices();
  }
  const L = stripLog(b).filter(l => !l.startsWith('|split') && l !== '|');
  // drop duplicated split lines (each damage appears for both audiences)
  const dedup = L.filter((l, i) => l !== L[i - 1]);
  const fi = dedup.findIndex(l => l.startsWith('|faint'));
  console.log(`\n## ${name}\n` + (process.env.FULL ? dedup.join('\n') : dedup.slice(Math.max(0, fi - 4), fi + 1).join('\n')));
}
const idle = (extra = []) => [mkSet('Snorlax', ['splash', ...extra], { level: 50 }), mkSet('Eevee', ['splash'], { level: 50 })];
// victim = p1 slot 0 at 1 HP (lowAt [0,0]) unless stated
scen('poison (Toxic)', idle(), [mkSet('Gengar', ['toxic'], { level: 50 })], [['move 1', 'move 1'], ['move 1', 'move 1']], [0, 0]);
scen('burn (Will-O-Wisp)', idle(), [mkSet('Gengar', ['willowisp'], { level: 50 })], [['move 1', 'move 1'], ['move 1', 'move 1']], [0, 0]);
scen('Leech Seed', idle(), [mkSet('Venusaur', ['leechseed'], { level: 50 })], [['move 1', 'move 1'], ['move 1', 'move 1']], [0, 0]);
scen('Stealth Rock on switch-in', idle(), [mkSet('Skarmory', ['stealthrock'], { level: 50 })], [['move 1', 'move 1'], ['switch 2', 'move 1']], [0, 1]);
scen('Spikes', idle(), [mkSet('Skarmory', ['spikes'], { level: 50 })], [['move 1', 'move 1'], ['switch 2', 'move 1']], [0, 1]);
scen('Sandstorm', idle(), [mkSet('Tyranitar', ['splash'], { level: 50, ability: 'Sand Stream' })], [['move 1', 'move 1']], [0, 0]);
scen('Recoil (Double-Edge)', [mkSet('Snorlax', ['doubleedge'], { level: 50 }), mkSet('Eevee', ['splash'])], [mkSet('Blissey', ['splash'], { level: 50 }), mkSet('Eevee', ['splash'])], [['move 1', 'move 1']], [0, 0]);
scen('Destiny Bond', [mkSet('Gengar', ['destinybond'], { level: 50 }), mkSet('Eevee', ['splash'])], [mkSet('Snorlax', ['crunch'], { level: 100 }), mkSet('Eevee', ['splash'])], [['move 1', 'move 1']], [0, 0]);
scen('Perish Song', idle(), [mkSet('Misdreavus', ['perishsong'], { level: 50 })], [['move 1', 'move 1'], ['move 1', 'move 1'], ['move 1', 'move 1'], ['move 1', 'move 1']], [0, 0]);
scen('Rough Skin (ability, [of])', [mkSet('Snorlax', ['tackle'], { level: 50 }), mkSet('Eevee', ['splash'])], [mkSet('Garchomp', ['splash'], { level: 50, ability: 'Rough Skin' })], [['move 1', 'move 1']], [0, 0]);
scen('Life Orb (self)', [mkSet('Snorlax', ['tackle'], { level: 50, item: 'Life Orb' }), mkSet('Eevee', ['splash'])], [mkSet('Blissey', ['splash'], { level: 50 })], [['move 1', 'move 1']], [0, 0]);
scen('Explosion (self-KO)', [mkSet('Electrode', ['explosion'], { level: 50 }), mkSet('Eevee', ['splash'])], [mkSet('Snorlax', ['splash'], { level: 50 }), mkSet('Eevee', ['splash'])], [['move 1', 'move 1']], [0, 1]);
scen('Future Sight', idle(), [mkSet('Alakazam', ['futuresight'], { level: 50 })], [['move 1', 'move 1'], ['move 1', 'move 1'], ['move 1', 'move 1']], [0, 0]);
scen('Confusion self-hit', idle(), [mkSet('Gengar', ['confuseray'], { level: 50 })], [['move 1', 'move 1'], ['move 1', 'move 1'], ['move 1', 'move 1'], ['move 1', 'move 1']], [0, 0]);
