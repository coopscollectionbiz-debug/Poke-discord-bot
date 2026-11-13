// Prints one hash over the full (|t:| stripped) logs of 100 random 6v6 battles; run twice in separate processes and compare.
import crypto from 'crypto';
import { newBattleHooked, installRules, stripLog } from './lib.mjs';
import { randomTeam, rng } from './teams.mjs';
const h = crypto.createHash('sha256');
for (let i = 1; i <= 100; i++) {
  const r = rng(i); const b = newBattleHooked({ teams: [randomTeam(r), randomTeam(r)], seed: i, beforeStart: (bt) => installRules(bt) });
  while (!b.ended) { for (let s = 0; s < 2; s++) { const q = b.sides[s].activeRequest; if (q && !q.wait && !b.sides[s].choose(q.forceSwitch ? `switch ${q.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith(' fnt')) + 1}` : 'move 1')) b.sides[s].choose('default'); } b.commitChoices(); }
  h.update(stripLog(b).join('\n'));
}
console.log(h.digest('hex').slice(0, 16));
