// Does the effect-aware engine (effects.js) reproduce the legacy loop when no battler has an ability?
import { simulateBattle, buildMon, memberMoves } from "../../utils/battle/sim.js";
import { simulateBattleFx, prepareBattler } from "../../utils/battle/effects.js";
import { createRng } from "../../utils/battle/rng.js";
import { getSpecies } from "../../utils/battle/data.js";
const rng = createRng(7);
const ids = Array.from({ length: 1025 }, (_, i) => i + 1).filter((id) => getSpecies(id) && id !== 292);
const team = () => Array.from({ length: 6 }, () => ({ speciesId: ids[rng.int(ids.length)], level: 50 }));
let diff = 0, n = 3000;
for (let i = 0; i < n; i++) {
  const sides = [{ members: team() }, { members: team() }];
  const seed = rng.int(2 ** 31);
  const a = simulateBattle({ sides, seed, surge: null });
  const teams = sides.map((s) => s.members.map((m) => prepareBattler(buildMon(m), memberMoves(m), `#${m.speciesId}`)));
  const b = simulateBattleFx({ teams, rng: createRng(seed) });
  if (a.winner !== b.winner || a.turns !== b.turns) diff++;
}
console.log(`fx engine vs legacy, no abilities: ${diff} differences in ${n}`);
