// Derive today's result shape ({winner, turns, snapshots, knockouts, log, endedBy}) from a Showdown Battle driven synchronously.
// Requires each set.name = `s<slot>` so log idents map back to team slots (Showdown reorders side.pokemon on switch).
import { stripLog } from './lib.mjs';
const slotOf = (ident) => +/ s(\d+)$/.exec(ident.replace(/^p\d[a-z]?: /, ' ') )?.[1];
const parseId = (s) => { const m = /^p([12])[a-z]?: s(\d+)$/.exec(s); return m ? { side: +m[1] - 1, slot: +m[2] } : null; };
export const snapshotOf = (b) => b.sides.map((s) => { const a = []; for (const p of s.pokemon) a[+p.name.slice(1)] = p.hp / p.maxhp; return a; });

export function extract(b, snapshots, { turnCap = null } = {}) {
  const lines = stripLog(b).filter((l, i, arr) => !l.startsWith('|split|') && l !== arr[i - 1]); // each secret/public pair collapses
  const knockouts = [], turns = []; let turn = 0, cur = null, events = [];
  const lastHit = {}, statusBy = {}, hazardBy = {}, fsBy = {}, perishBy = {}; let weatherBy = null; const causes = {};
  const key = (p) => `${p.side}:${p.slot}`;
  const active = [null, null];
  for (const l of lines) {
    const f = l.split('|'); const t = f[1];
    if (t === 'turn') { turns.push(events); events = []; turn = +f[2]; continue; }
    if (t === 'switch' || t === 'drag') { const p = parseId(f[2]); if (p) active[p.side] = p; events.push({ type: 'switch', ...p }); continue; }
    if (t === 'move') { const p = parseId(f[2]); cur = p; if (p) events.push({ type: 'move', ...p, move: f[3], miss: l.includes('[miss]') }); if (/^(Future Sight|Doom Desire)$/.test(f[3]) && p) fsBy[1 - p.side] = p; continue; }
    if (t === '-status') { const p = parseId(f[2]); if (p) statusBy[key(p)] = (cur && cur.side !== p.side) ? cur : (hazardBy[p.side] ?? null); continue; }
    if (t === '-sidestart') { const side = +/^p(\d)/.exec(f[2])[1] - 1; hazardBy[side] = cur; continue; }
    if (t === '-weather' && !l.includes('[upkeep]')) { weatherBy = cur; continue; }
    if (t === '-start' && /perish3|perish[0-9]/.test(f[3] ?? '') ) { const p = parseId(f[2]); if (p && cur && f[3] === 'perish3') perishBy[key(p)] = cur; continue; }
    if (t === '-damage') {
      const p = parseId(f[2]); if (!p) continue;
      const from = (f.find(x => x.startsWith('[from]')) ?? '').slice(7), of = (f.find(x => x.startsWith('[of]')) ?? '').slice(5);
      const dealt = f[3]; events.push({ type: 'damage', ...p, hp: dealt, from: from || undefined, of: of || undefined });
      if (!from) { if (cur && cur.side !== p.side) lastHit[key(p)] = cur; else if (fsBy[p.side] && !cur) lastHit[key(p)] = fsBy[p.side]; }
      else if (of && parseId(of)) lastHit[key(p)] = parseId(of);
      if (from) lastHit[`from:${key(p)}`] = from;
      continue;
    }
    if (t === 'faint') {
      const p = parseId(f[2]); if (!p) continue;
      // find the damage line right before (the cause)
      let cause = 'move', by = lastHit[key(p)] ?? null; const from = lastHit[`from:${key(p)}`];
      const prev = events.at(-1);
      const fromNow = prev?.type === 'damage' && prev.slot === p.slot && prev.side === p.side ? prev.from : undefined;
      if (fromNow) {
        if (/^(psn|brn)$/.test(fromNow)) { cause = fromNow; by = statusBy[key(p)] ?? by; }
        else if (/Stealth Rock|Spikes|Toxic Spikes|Stone Axe|Ceaseless/.test(fromNow)) { cause = 'hazard'; by = hazardBy[p.side] ?? by; }
        else if (/Sandstorm|Hail|Snow/.test(fromNow)) { cause = 'weather'; by = weatherBy ?? by; }
        else if (/Recoil|recoil|Life Orb|confusion|Struggle|Crash|Substitute|Curse/i.test(fromNow)) { cause = 'self:' + fromNow; by = lastHit[key(p)] ?? (active[1 - p.side] ?? null); }
        else if (/Leech Seed|ability:|item:/.test(fromNow)) { cause = fromNow; by = parseId(prev.of ?? '') ?? by; }
        else cause = 'other:' + fromNow;
      } else if (cur && cur.side === p.side && cur.slot === p.slot) { cause = 'self-KO move'; by = active[1 - p.side]; }
      else if (perishBy[key(p)]) { cause = 'perish'; by = perishBy[key(p)]; }
      else if (prev?.type !== 'damage' && lines.some(x => x.includes('Destiny Bond') && x.includes('-activate'))) { cause = 'destinybond?'; by = active[1 - p.side]; }
      by ??= active[1 - p.side]; // fallback = whoever is on the other side
      causes[cause] = (causes[cause] ?? 0) + 1;
      knockouts.push({ turn: turn || 1, side: p.side, slot: p.slot, bySide: by?.side, bySlot: by?.slot, cause });
      events.push({ type: 'faint', ...p, cause });
      continue;
    }
    if (['-heal', '-crit', '-supereffective', '-resisted', '-immune', '-miss', '-boost', '-unboost', '-fail', '-activate', '-ability', '-item', '-enditem', '-weather', '-fieldstart', '-sidestart', '-sideend', '-start', '-end', '-singlemove', '-singleturn', 'cant', '-message', '-hitcount', '-curestatus', '-transform', '-mega', '-formechange', 'detailschange', '-terastallize'].includes(t)) events.push({ type: t.replace(/^-/, ''), raw: l });
  }
  turns.push(events);
  const tie = b.winner === '';
  return { winner: tie ? null : b.winner === 'A' ? 0 : 1, tie, turns: b.turn, endedBy: tie ? 'tie' : 'knockout', snapshots, knockouts, log: turns.slice(1), turnOneSetup: turns[0], causes };
}
