import { bd, Dex, mkSet } from './lib.mjs';
const dex = Dex.forFormat('gen9customgame');
// tiny deterministic PRNG for team generation (independent of the battle seed)
export const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const damaging = {}; const STATUS = ['toxic', 'willowisp', 'thunderwave', 'spore', 'stealthrock', 'spikes', 'toxicspikes', 'recover', 'swordsdance', 'calmmind', 'roar', 'whirlwind', 'protect', 'leechseed', 'substitute', 'reflect', 'rest', 'sleeptalk', 'destinybond', 'perishsong', 'uturn', 'voltswitch', 'dragontail', 'trick', 'rapidspin'];
for (const [id, m] of Object.entries(bd.moves)) if (m.power && m.category !== 'Status' && dex.moves.get(id).exists) (damaging[m.type] ??= []).push(id);
const ITEMS = ['Leftovers', 'Life Orb', 'Focus Sash', 'Sitrus Berry', 'Choice Band', 'Expert Belt', 'Eviolite', 'Shell Bell', 'Black Sludge', 'Quick Claw', 'Focus Band', 'Bright Powder'];
const ids = Object.keys(bd.species).map(Number).filter(n => n <= 1025 && dex.species.get(bd.species[n].name).exists);
export function randomTeam(r, { level = 50, size = 6 } = {}) {
  const team = [], used = new Set();
  while (team.length < size) {
    const id = ids[Math.floor(r() * ids.length)]; if (used.has(id)) continue; used.add(id);
    const sp = bd.species[id], sd = dex.species.get(sp.name);
    const pool = [...new Set(sp.types.flatMap(t => damaging[t] ?? []))];
    const moves = [];
    const nDmg = 2 + Math.floor(r() * 2); // 2-3 damaging, rest status
    while (moves.length < nDmg && pool.length) { const m = pool[Math.floor(r() * pool.length)]; if (!moves.includes(m)) moves.push(m); }
    while (moves.length < 4) { const m = STATUS[Math.floor(r() * STATUS.length)]; if (!moves.includes(m)) moves.push(m); }
    const ab = Object.values(sd.abilities)[0];
    team.push(mkSet(sd.name, moves, { level, item: ITEMS[Math.floor(r() * ITEMS.length)], ability: ab, name: `s${team.length}`, extra: { speciesId: id } }));
  }
  return team;
}
