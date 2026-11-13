import { Battle, Teams, Dex } from '@pkmn/sim';
import fs from 'fs';
export { Battle, Teams, Dex };
export const bd = JSON.parse(fs.readFileSync(new URL('../../battleData.json', import.meta.url), 'utf8'));
export const FORMAT = 'gen9customgame@@@!teampreview';
export const seedOf = (n) => [n & 0xffff, (n >>> 16) & 0xffff, 0x1234, 0x5678];

// set: Showdown PokemonSet-ish object. IV 15 (our fixed IV), EV 0, neutral nature.
export const mkSet = (species, moves, o = {}) => ({
  name: o.name ?? species, species, item: o.item ?? '', ability: o.ability ?? '', moves, nature: 'Hardy', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 },
  level: o.level ?? 50, ...o.extra,
});

export function newBattle({ teams, seed = 1, format = FORMAT, opts = {} }) {
  const b = new Battle({ formatid: format, seed: seedOf(seed), ...opts });
  b.setPlayer('p1', { name: 'A', team: Teams.pack(teams[0]) });
  b.setPlayer('p2', { name: 'B', team: Teams.pack(teams[1]) });
  return b;
}

// Synchronous driver. choosers[i](request, battle) -> choice string
export function drive(b, choosers, { maxTurns = 1000 } = {}) {
  let guard = 0;
  while (!b.ended && guard++ < 5000) {
    if (b.turn > maxTurns) break;
    const reqs = b.sides.map((s) => s.activeRequest);
    for (let i = 0; i < 2; i++) {
      const r = reqs[i];
      if (!r || r.wait) continue;
      const c = choosers[i](r, b, i);
      if (!b.sides[i].choose(c)) throw new Error(`bad choice ${c} : ${b.sides[i].choice.error}`);
    }
    if (b.allChoicesDone()) b.commitChoices(); else throw new Error('stuck: choices not done');
  }
  return b;
}
export const stripLog = (b) => b.log.filter((l) => !l.startsWith('|t:|'));

// greedy: highest base-power usable move else first legal; forced switch -> first switch-in
export const greedy = (r, b, i) => {
  if (r.forceSwitch) {
    const idx = r.side.pokemon.findIndex((p, k) => !p.active && !p.condition.endsWith(' fnt'));
    return `switch ${idx + 1}`;
  }
  const mv = r.active[0].moves;
  let best = -1, bp = -1;
  mv.forEach((m, k) => {
    if (m.disabled) return;
    const bpow = b.dex.moves.get(m.id).basePower;
    if (bpow > bp) { bp = bpow; best = k; }
  });
  return best < 0 ? 'move 1' : `move ${best + 1}`;
};

// Per-member stat multiplier, applied inside the engine's own stat calc so it survives forme changes.
// set.statMult (number) multiplies every stat incl. HP and rounds, exactly like utils/battle/sim.js buildMon.
export function installStatMult(b) {
  const orig = b.statModify.bind(b);
  b.statModify = (base, set, stat) => { const v = orig(set.baseStats && base === b.dex.species.get(set.species).baseStats ? set.baseStats : base, set, stat); return set.statMult ? Math.round(v * set.statMult) : v; };
}
// Build a battle with hooks installed BEFORE sides exist, optionally mutate pokemon BEFORE start() so the log is clean.
export function newBattleHooked({ teams, seed = 1, format = FORMAT, opts = {}, beforeStart }) {
  const b = new Battle({ formatid: format, seed: seedOf(seed), ...opts });
  installStatMult(b);
  b.start = () => {}; // defer start so we can mutate Pokemon before the first |switch| lines are logged
  b.setPlayer('p1', { name: 'A', team: teams[0] });
  b.setPlayer('p2', { name: 'B', team: teams[1] });
  delete b.start; // restore prototype start
  beforeStart?.(b);
  b.start();
  return b;
}

// Our randomness, installed as instance overrides (no package edit):
//  - damage roll: uniform 80..100 % (tuning.js DAMAGE_ROLL_MIN = 0.8) instead of 85..100
//  - stage-0 crit 1/12 instead of gen9's 1/24 (the only randomChance(1,24) caller is the crit roll; 1/8 high-crit already matches)
//  - Roar/Whirlwind/Dragon Tail/Red Card drag: first switchable in slot order, not random
export function installRules(b, { dmgMin = 80, crit = 12, dragFirst = true, critMult = 2 } = {}) {
  // gen9 crit damage is x1.5 (move.critModifier ?? 1.5); ours is CRIT_MULT = 2. The active move object is a per-use copy, so setting it here is safe.
  const gd = b.actions.getDamage.bind(b.actions);
  b.actions.getDamage = (src, tgt, mv, bp) => { if (mv && typeof mv === 'object') mv.critModifier ??= critMult; return gd(src, tgt, mv, bp); };
  b.randomizer = (base) => Math.trunc((base * (dmgMin + b.random(101 - dmgMin))) / 100);
  const rc = b.randomChance.bind(b);
  b.randomChance = (n, d) => rc(n, n === 1 && d === 24 ? crit : d);
  // side.pokemon is reordered by every switch, so 'slot order' must come from the original slot kept in the nickname (s<N>), not array order
  if (dragFirst) b.getRandomSwitchable = (side) => side.pokemon.filter((p) => !p.fainted && !p.isActive).sort((a, c) => slotNum(a.name) - slotNum(c.name))[0] ?? null;
}

export const slotNum = (name) => (/^s(\d+)$/.test(name) ? +name.slice(1) : 99);
// Forced-switch choice by ORIGINAL team slot (request idents look like 'p1: s3'); returns 'switch <engine index>'.
export const nextSlotSwitch = (r) => {
  const c = r.side.pokemon.map((p, i) => ({ i: i + 1, slot: slotNum(p.ident.split(': ')[1]), ok: !p.active && !p.condition.endsWith(' fnt') })).filter((x) => x.ok).sort((a, b) => a.slot - b.slot);
  return `switch ${c[0].i}`;
};
