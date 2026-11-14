// usage: node --expose-gc tools/spike-showdown/p5_perf.mjs <greedy|random|random70> [N=1000]
const mode = process.argv[2] ?? 'greedy', N = +(process.argv[3] ?? 1000);
const mb = () => { global.gc?.(); return +(process.memoryUsage().rss / 1048576).toFixed(0); };
const rssStart = mb();
const lib = await import('./lib.mjs');            // imports @pkmn/sim + battleData.json
const { randomTeam, rng } = await import('./teams.mjs'); // builds the Dex-derived move pools
const rssImport = mb();
const { newBattleHooked, installRules } = lib;
const teams = []; { const r = rng(12345); for (let i = 0; i < N; i++) teams.push([randomTeam(r), randomTeam(r)]); }
const forced = (r) => r.forceSwitch ? lib.nextSlotSwitch(r) : null;
const greedy = (r, b) => { const f = forced(r); if (f) return f; let best = -1, bp = -1; r.active[0].moves.forEach((m, k) => { if (m.disabled) return; const x = b.dex.moves.get(m.id).basePower; if (x > bp) { bp = x; best = k; } }); return `move ${best < 0 ? 1 : best + 1}`; };
const pr = rng(777);
const randomPick = (pMove) => (r) => {
  if (r.forceSwitch) { const c = r.side.pokemon.map((p, i) => [p, i + 1]).filter(([p]) => !p.active && !p.condition.endsWith(' fnt')); return `switch ${c[Math.floor(pr() * c.length)][1]}`; }
  const bench = r.side.pokemon.map((p, i) => [p, i + 1]).filter(([p]) => !p.active && !p.condition.endsWith(' fnt'));
  const mv = r.active[0].moves.map((m, i) => [m, i + 1]).filter(([m]) => !m.disabled);
  if (bench.length && !r.active[0].trapped && (!mv.length || pr() > pMove)) return `switch ${bench[Math.floor(pr() * bench.length)][1]}`;
  return `move ${mv[Math.floor(pr() * mv.length)][1]}`;
};
const choose = mode === 'greedy' ? greedy : mode === 'random' ? randomPick(1.0) : randomPick(0.7);
const ms = [], turns = []; let badChoices = 0, ties = 0, over300 = 0, rss1 = null;
const t00 = performance.now();
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const b = newBattleHooked({ teams: teams[i], seed: i + 1, beforeStart: (bt) => installRules(bt) });
  while (!b.ended) { for (let s = 0; s < 2; s++) { const rq = b.sides[s].activeRequest; if (rq && !rq.wait && !b.sides[s].choose(choose(rq, b))) { badChoices++; b.sides[s].choose('default'); } } b.commitChoices(); }
  ms.push(performance.now() - t0); turns.push(b.turn); if (b.winner === '') ties++; if (b.turn > 300) over300++;
  if (i === 0) rss1 = mb();
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(JSON.stringify({ mode, N, totalS: +((performance.now() - t00) / 1000).toFixed(1),
  msP50: +q(ms, .5).toFixed(1), msP99: +q(ms, .99).toFixed(1), msMax: +Math.max(...ms).toFixed(0), msMean: +(ms.reduce((a, b) => a + b) / N).toFixed(1),
  turnsP50: q(turns, .5), turnsP99: q(turns, .99), turnsMax: Math.max(...turns), ties, over300, badChoices,
  rssMB: { start: rssStart, afterImport: rssImport, afterFirstBattle: rss1, afterRun: mb() } }));
