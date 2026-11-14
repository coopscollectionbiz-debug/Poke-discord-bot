import { newBattle, drive, mkSet, stripLog } from './lib.mjs';
const FMT = 'gen9customgame@@@!teampreview,sleepclausemod,ohkoclause,evasionclause,endlessbattleclause';
// 1. Sleep Clause Mod is enforced in-battle: p1 uses Spore twice into a 2-mon bench.
{
  const b = newBattle({ format: FMT, seed: 1, teams: [[mkSet('Breloom', ['spore'], { level: 50 })], [mkSet('Snorlax', ['splash'], { level: 50 }), mkSet('Eevee', ['splash'])]] });
  let msgs = [];
  const sw = (r) => r.forceSwitch ? 'switch 2' : 'move 1';
  b.sides[0].choose('move 1'); b.sides[1].choose('switch 2'); b.commitChoices(); // Eevee in, spore it
  const L = stripLog(b);
  b.sides[0].choose('move 1'); b.sides[1].choose('switch 2'); b.commitChoices(); // Snorlax in, spore again -> clause
  console.log('Sleep clause lines:', stripLog(b).filter(l => /Sleep Clause|-status.*slp/.test(l)).join(' ; '));
  console.log('rule lines:', stripLog(b).filter(l => l.startsWith('|rule|')).join(' ; '));
}
// 2. OHKO / Evasion clauses are ValidatorRules (team validation only): moves still work in-battle.
{
  const b = newBattle({ format: FMT, seed: 2, teams: [[mkSet('Golem', ['fissure', 'minimize', 'doubleteam'], { level: 50 })], [mkSet('Snorlax', ['splash'], { level: 50 })]] });
  for (let i = 0; i < 12 && !b.ended; i++) { b.sides[0].choose('move 1'); b.sides[1].choose('move 1'); b.commitChoices(); }
  console.log('Fissure usable w/ ohkoclause rule on (in-battle, unvalidated):', stripLog(b).some(l => l.startsWith('|move|p1a: Golem|Fissure')), '| ended', b.ended);
  let hasMinimize = (() => { const b2 = newBattle({ format: FMT, seed: 2, teams: [[mkSet('Golem', ['minimize'], { level: 50 })], [mkSet('Snorlax', ['splash'], { level: 50 })]] }); b2.sides[0].choose('move 1'); b2.sides[1].choose('move 1'); b2.commitChoices(); return stripLog(b2).some(l => /Minimize/.test(l)); })();
  console.log('Minimize usable under evasionclause:', hasMinimize);
}
// 3. Stall: two Blissey that only heal -> engine tie at turn 1000 (and Endless Battle Clause staleness not triggered by pure heal)
{
  const b = newBattle({ format: FMT, seed: 3, teams: [[mkSet('Blissey', ['softboiled'], { level: 50 })], [mkSet('Blissey', ['softboiled'], { level: 50 })]] });
  b.sides.forEach(sd => sd.pokemon.forEach(p => p.moveSlots.forEach(m => { m.pp = m.maxpp = 99999; }))); // PP is real in Showdown: 2 softboiled-only mons hit Struggle after ~10 turns; lift PP to see the engine's own stall handling
  const t0 = performance.now(); drive(b, [() => 'move 1', () => 'move 1'], { maxTurns: 5000 });
  console.log('stall: ended', b.ended, 'turn', b.turn, 'winner', JSON.stringify(b.winner), 'last log:', stripLog(b).slice(-3).join(' / '), 'ms', (performance.now() - t0).toFixed(0));
}
// 4. Gen-5 rule "both out simultaneously": last Pokemon to faint's side wins. Explosion tie: p1 Electrode faster explodes vs 1 mon each.
{
  const b = newBattle({ format: FMT, seed: 4, teams: [[mkSet('Electrode', ['explosion'], { level: 100 })], [mkSet('Magikarp', ['splash'], { level: 1 })]] });
  drive(b, [() => 'move 1', () => 'move 1']);
  console.log('Explosion KO both: winner', JSON.stringify(b.winner), '(sides: A=p1, B=p2)', stripLog(b).filter(l=>/faint|win|tie/.test(l)).join(' ; '));
}
