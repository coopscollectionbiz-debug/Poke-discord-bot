import { Battle, newBattleHooked, installRules, stripLog } from './lib.mjs';
import { randomTeam, rng } from './teams.mjs';
const r = rng(5); const b = newBattleHooked({ teams: [randomTeam(r), randomTeam(r)], seed: 5, beforeStart: (bt) => installRules(bt) });
const t0 = performance.now(); const j = b.toJSON(); const c = Battle.fromJSON(JSON.parse(JSON.stringify(j))); const ms = performance.now() - t0;
console.log('clone ms', ms.toFixed(2), '| json KB', (JSON.stringify(j).length / 1024).toFixed(0), '| clone has requests:', !!c.sides[0].activeRequest, '| same PRNG state:', c.prng.getSeed() === b.prng.getSeed());
const seedBefore = b.prng.getSeed();
installRules(c); c.sides[0].choose('move 1'); c.sides[1].choose('move 1'); c.commitChoices();
console.log('real PRNG untouched by clone play:', b.prng.getSeed() === seedBefore, '| real turn', b.turn, 'clone turn', c.turn);
// same state, same PRNG, same choices -> same outcome (deterministic clone)? and clone matches continuing the real battle?
const c2 = Battle.fromJSON(JSON.parse(JSON.stringify(j))); installRules(c2); c2.sides[0].choose('move 1'); c2.sides[1].choose('move 1'); c2.commitChoices();
b.sides[0].choose('move 1'); b.sides[1].choose('move 1'); b.commitChoices();
console.log('clone == clone:', stripLog(c).join() === stripLog(c2).join(), '| clone == real continuation:', stripLog(c).slice(-12).join() === stripLog(b).slice(-12).join());
