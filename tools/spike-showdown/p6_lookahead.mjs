// usage: node --expose-gc tools/spike-showdown/p6_lookahead.mjs [N=500]
// Lookahead chooser: top-3 greedy-scored moves; for each, clone the Battle in-process (Battle.fromJSON(b.toJSON()) =
// State.serialize/deserialize), re-seed the clone's PRNG (so it can't peek at the real rolls and never touches the real PRNG),
// reinstall our instance overrides, play candidate vs opponent greedy reply for ONE turn, score = (own HP% - foe HP%) swing + KO bonus.
import { Battle, newBattleHooked, installRules, nextSlotSwitch, seedOf, installStatMult } from './lib.mjs';
import { PRNG } from '@pkmn/sim';
import { randomTeam, rng } from './teams.mjs';
const N = +(process.argv[2] ?? 500);
const BP = new Map();
const greedyScores = (r, b) => r.active[0].moves.map((m, k) => m.disabled ? -1 : (BP.get(m.id) ?? (BP.set(m.id, b.dex.moves.get(m.id).basePower), BP.get(m.id))));
const greedy = (r, b) => { if (r.forceSwitch) return nextSlotSwitch(r); const s = greedyScores(r, b); let k = s.indexOf(Math.max(...s)); return `move ${k < 0 || s[k] < 0 ? 1 : k + 1}`; };
const hpFrac = (side) => side.pokemon.reduce((a, p) => a + p.hp / p.maxhp, 0);
let cloneMs = 0, decisions = 0, cloneCount = 0; const cr = rng(99);
function lookahead(i, r, b) {
  if (r.forceSwitch) return nextSlotSwitch(r);
  const t0 = performance.now(); decisions++;
  const sc = greedyScores(r, b);
  const cands = sc.map((s, k) => [s, k]).filter(([s]) => s >= 0).sort((a, c) => c[0] - a[0]).slice(0, 3).map(([, k]) => k);
  if (cands.length <= 1) { cloneMs += performance.now() - t0; return `move ${(cands[0] ?? 0) + 1}`; }
  const json = b.toJSON(); // one serialization, many deserializations
  const foeReq = b.sides[1 - i].activeRequest; let best = null, bestScore = -Infinity;
  for (const k of cands) {
    const c = Battle.fromJSON(JSON.parse(JSON.stringify(json))); cloneCount++;
    installRules(c); installStatMult(c); c.prng = new PRNG(seedOf(Math.floor(cr() * 2 ** 31)));
    const before = hpFrac(c.sides[i]) - hpFrac(c.sides[1 - i]);
    const mine = c.sides[i], foe = c.sides[1 - i];
    mine.choose(`move ${k + 1}`);
    const fr = foe.activeRequest; if (fr && !fr.wait) foe.choose(greedy(fr, c));
    if (c.allChoicesDone()) c.commitChoices();
    let score = (hpFrac(mine) - hpFrac(foe)) - before;
    score += 0.5 * (foe.pokemon.filter(p => p.fainted).length - mine.pokemon.filter(p => p.fainted).length); // KO swing
    if (score > bestScore) { bestScore = score; best = k; }
  }
  cloneMs += performance.now() - t0;
  return `move ${best + 1}`;
}
const teams = []; { const r = rng(12345); for (let i = 0; i < N; i++) teams.push([randomTeam(r), randomTeam(r)]); }
function run(label, ai) { // ai: [chooser for p1, chooser for p2]
  const ms = [], wins = [0, 0], turns = []; cloneMs = 0; decisions = 0; cloneCount = 0;
  for (let g = 0; g < N; g++) {
    const t0 = performance.now();
    const b = newBattleHooked({ teams: teams[g], seed: g + 1, beforeStart: (bt) => installRules(bt) });
    while (!b.ended && b.turn <= 300) {
      for (let s = 0; s < 2; s++) { const rq = b.sides[s].activeRequest; if (rq && !rq.wait && !b.sides[s].choose(ai[s](s, rq, b))) b.sides[s].choose('default'); }
      b.commitChoices();
    }
    ms.push(performance.now() - t0); turns.push(b.turn);
    if (b.winner === 'A') wins[0]++; else if (b.winner === 'B') wins[1]++;
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  console.log(JSON.stringify({ label, N, msP50: +q(ms, .5).toFixed(1), msP99: +q(ms, .99).toFixed(1), msMean: +(ms.reduce((a, b) => a + b) / N).toFixed(1), turnsP50: q(turns, .5), winsP1: wins[0], winsP2: wins[1], decisions, msPerDecision: decisions ? +(cloneMs / decisions).toFixed(2) : null, clonesPerDecision: decisions ? +(cloneCount / decisions).toFixed(2) : null, rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
  return wins;
}
const G = (s, r, b) => greedy(r, b), L = lookahead;
run('(a) greedy vs greedy', [G, G]);
// (b) one side lookahead: run both seatings (teams fixed, sides swapped by the AI assignment) -> lookahead's win rate vs greedy
const b1 = run('(b1) p1=lookahead, p2=greedy', [L, G]);
const b2 = run('(b2) p1=greedy, p2=lookahead', [G, L]);
console.log('lookahead win rate vs greedy over', 2 * N, 'seat-balanced battles (same teams/seeds):', ((b1[0] + b2[1]) / (2 * N)).toFixed(3), '| greedy:', ((b1[1] + b2[0]) / (2 * N)).toFixed(3), '| undecided:', 2 * N - b1[0] - b1[1] - b2[0] - b2[1]);
run('(c) lookahead vs lookahead', [L, L]);
