import { newBattleHooked, drive, stripLog, installRules } from './lib.mjs';
import { randomTeam, rng } from './teams.mjs';
import { extract, snapshotOf } from './extract.mjs';
// Drive a battle recording an HP snapshot after every turn, extract, and show shape + KO-cause statistics over N battles.
const N = +(process.env.N ?? 300);
import { nextSlotSwitch } from './lib.mjs';
const first = (r) => r.forceSwitch ? nextSlotSwitch(r) : null;
function greedy(r, b) { const f = first(r); if (f) return f; let best = -1, bp = -1; r.active[0].moves.forEach((m, k) => { if (m.disabled) return; const x = b.dex.moves.get(m.id).basePower; if (x > bp) { bp = x; best = k; } }); return `move ${best < 0 ? 1 : best + 1}`; }
function play(seed) {
  const r = rng(seed); const teams = [randomTeam(r), randomTeam(r)];
  const b = newBattleHooked({ teams, seed, beforeStart: (bt) => installRules(bt) });
  const snaps = [snapshotOf(b)]; let lastTurn = b.turn;
  while (!b.ended && b.turn <= 300) {
    for (let i = 0; i < 2; i++) { const rq = b.sides[i].activeRequest; if (rq && !rq.wait) b.sides[i].choose(greedy(rq, b)); }
    b.commitChoices();
    if (b.turn !== lastTurn || b.ended) { snaps.push(snapshotOf(b)); lastTurn = b.turn; } // the ending turn does not advance b.turn, so snapshot on b.ended too (=> turns + 1 snapshots, like today)
  }
  return { b, res: extract(b, snaps) };
}
const total = {}; let ko = 0, ties = 0, unk = 0, over = 0;
for (let s = 1; s <= N; s++) { const { b, res } = play(s); if (res.tie) ties++; if (!b.ended) over++; for (const [k, v] of Object.entries(res.causes)) { total[k] = (total[k] ?? 0) + v; ko += v; } }
console.log({ battles: N, ties, hitOurTurnCapUnended: over, knockouts: ko }); console.log('KO causes:', total);
const { res } = play(1);
console.log('\nsample result keys:', Object.keys(res));
console.log({ winner: res.winner, turns: res.turns, snapshotsLen: res.snapshots.length, expectTurnsPlus1: res.turns + 1, snapTurn1: JSON.stringify(res.snapshots[1].map(a => a.map(x => +x.toFixed(2)))), firstKOs: res.knockouts.slice(0, 3), turn1Events: res.log[0].slice(0, 6) });
