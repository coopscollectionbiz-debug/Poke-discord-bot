// ==========================================================
// analysis/held-items/runImplemented.mjs — balance validation against the
// IMPLEMENTED engine (utils/battle/sim.js → effects.js + items.js), not the
// audit prototype. Read-only: the snapshot is loaded into memory; only
// aggregates are written to analysis/held-items/out/implemented.*.
//
// Usage: node analysis/held-items/runImplemented.mjs <snapshotDir> [N=2000] [masterRepo]
//   masterRepo (optional): a checkout of master; its simulateBattle is
//   compared with this branch's on battles without items (parity).
// ==========================================================

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { simulateBattle } from "../../utils/battle/sim.js";
import { teamPower, rollSurge, pokemonPower } from "../../utils/battle/power.js";
import { createRng } from "../../utils/battle/rng.js";
import { getSpecies } from "../../utils/battle/data.js";
import { computeStats } from "../../utils/battle/stats.js";
import { buildTeam } from "../../utils/battle/runBattle.js";
import { teamExp } from "../../utils/battle/rewards.js";
import { getTraining } from "../../utils/training.js";
import { getRank } from "../../utils/rankSystem.js";
import { acquirablePokemon } from "../../utils/speciesCatalog.js";
import { megaBattleProfile, allMegas } from "../../utils/megas.js";
import { canEvolve } from "../../utils/battle/items.js";
import { HELD_ITEM_DEFS, STARTER_HELD_ITEMS } from "../../catalog/heldItems.js";

const dir = process.argv[2];
const N = Number(process.argv[3] ?? 2000);
const masterRepo = process.argv[4] ?? null;
const outDir = new URL("./out/", import.meta.url);
fs.mkdirSync(outDir, { recursive: true });
const pokemonData = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(dir, "trainerData.json"), "utf8"));
const rng = createRng(20261111);
const log = [];
const say = (s = "") => { log.push(s); console.log(s); };
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const fmt = (k, n) => { const [lo, hi] = wilson(k, n); return `${pct(k / n)} (${pct(lo)}–${pct(hi)})`; };
const tierOf = (id) => String(pokemonData[id]?.tier ?? "common").toLowerCase();
const pickFrom = (arr) => arr[rng.int(arr.length)];
const results = {};

// ---------- production rosters (in memory only) ----------
function owned(u) {
  const out = [];
  for (const [id, c] of Object.entries(u.pokemon ?? {})) {
    if (!getSpecies(Number(id))) continue;
    for (const v of ["normal", "shiny"]) if ((c?.[v] ?? 0) > 0) out.push({ speciesId: Number(id), level: getTraining(u, Number(id), v).level });
  }
  return out;
}
function rankedTeam(roster) {
  const sorted = [...roster].sort((a, b) => (pokemonPower(b.speciesId, 50) ?? 0) - (pokemonPower(a.speciesId, 50) ?? 0));
  const out = []; let myth = 0;
  for (const m of sorted) {
    if (out.length >= 6) break;
    if (out.some((x) => x.speciesId === m.speciesId)) continue;
    if (tierOf(m.speciesId) === "mythic") { if (myth) continue; myth++; }
    out.push({ speciesId: m.speciesId, variant: "normal", level: 50, realLevel: m.level });
  }
  return out;
}
const players = Object.values(data).map((u) => ({
  rank: getRank(u.tp ?? 0) ?? "Unranked",
  cur: buildTeam(u, { env: {} }).map((m) => ({ speciesId: m.speciesId, variant: "normal", level: m.level, ...(m.moves ? { moves: m.moves } : {}) })),
  ranked: rankedTeam(owned(u)),
}));
const casualPool = players.filter((p) => p.cur.length > 0);
const rankedPool = players.filter((p) => p.ranked.length === 6);
say(`Production copy: ${Object.keys(data).length} records; ${casualPool.length} Display teams; ${rankedPool.length} full legal Lv 50 teams.`);

// ---------- loadouts ----------
const S = (m) => computeStats(getSpecies(m.speciesId).baseStats, m.level);
const BOOSTER = Object.fromEntries(HELD_ITEM_DEFS.filter((d) => d.boostsType).map((d) => [d.boostsType, d.id]));
const ALL = HELD_ITEM_DEFS.map((d) => d.id);
/** A reasonable player's loadout from `pool` (Item Clause: all different). */
function loadout(team, pool = ALL) {
  const used = new Set();
  const take = (prefs) => { for (const id of prefs) if (id && pool.includes(id) && !used.has(id)) { used.add(id); return id; } return null; };
  const x = team.map((m) => { const s = S(m); return { m, s, phys: s.atk >= s.spa, bulk: s.hp * (s.def + s.spd), off: Math.max(s.atk, s.spa), types: getSpecies(m.speciesId).types }; });
  const medSpe = x.map((y) => y.s.spe).sort((a, b) => a - b)[Math.floor(x.length / 2)];
  const medBulk = x.map((y) => y.bulk).sort((a, b) => a - b)[Math.floor(x.length / 2)];
  const out = new Map();
  for (const y of [...x].sort((a, b) => b.off - a.off)) {
    const id = y.m.speciesId;
    let prefs;
    if (id === 25) prefs = ["light_ball"];
    else if (id === 104 || id === 105) prefs = ["thick_club"];
    else prefs = [];
    if (canEvolve(id)) prefs.push("eviolite", "leftovers", "sitrus_berry", "focus_sash");
    if (y.bulk >= medBulk) prefs.push("leftovers", "sitrus_berry", "shell_bell", "bright_powder", "focus_band");
    if (y.s.spe >= medSpe) prefs.push("expert_belt", BOOSTER[y.types[0]], y.phys ? "muscle_band" : "wise_glasses", "focus_sash");
    else prefs.push("quick_claw", "expert_belt", BOOSTER[y.types[0]], "sitrus_berry");
    prefs.push("focus_sash", "bright_powder", "focus_band", "shell_bell", ...ALL.filter((i) => i !== "lucky_egg"));
    out.set(y.m, take(prefs));
  }
  return team.map((m) => ({ ...m, ...(out.get(m) ? { item: out.get(m) } : {}) }));
}
const starterLoadout = (t) => loadout(t, STARTER_HELD_ITEMS.filter((i) => i !== "lucky_egg"));
const none = (t) => t.map(({ item, ...m }) => m);
const lead = (t, item) => t.map((m, i) => (i === 0 ? { ...m, item } : m));

// ---------- battle helpers ----------
const notesOf = (r) => JSON.stringify([r.log, r.turnNotes ?? []]);
function fight(A, B, { surge = false } = {}) {
  const swap = rng.int(2);
  const sides = swap ? [B, A] : [A, B];
  const seed = rng.int(2 ** 31);
  const s = surge ? rollSurge(sides.map(teamPower), seed) : null;
  const r = simulateBattle({ sides: sides.map((members) => ({ members })), seed: seed + 1, surge: s });
  return { aWon: (r.winner === 0) !== !!swap, r };
}
function series(n, mk, opts) {
  let w = 0, turns = 0, cap = 0;
  const act = {};
  for (let i = 0; i < n; i++) {
    const [A, B] = mk();
    const { aWon, r } = fight(A, B, opts);
    w += aWon; turns += r.turns; cap += r.endedBy === "turnCap";
    const t = notesOf(r);
    for (const [k, re] of Object.entries(ACTIVATIONS)) act[k] = (act[k] ?? 0) + (t.match(re)?.length ?? 0);
  }
  return { w, n, turns: turns / n, cap: cap / n, act };
}
const ACTIVATIONS = {
  focusBand: /using its Focus Band/g, focusSash: /using its Focus Sash/g, quickClaw: /Quick Claw let it move first/g,
  leftovers: /using its Leftovers/g, sitrus: /Sitrus Berry/g, shellBell: /using its Shell Bell/g, missed: /"missed":true/g,
};

// ---------- 0. Parity with master ----------
if (masterRepo) {
  const m = await import(pathToFileURL(path.join(masterRepo, "utils/battle/sim.js")).href);
  let diff = 0;
  const P = 3000;
  for (let i = 0; i < P; i++) {
    const a = (i % 2 ? pickFrom(casualPool).cur : pickFrom(rankedPool).ranked), b = (i % 2 ? pickFrom(casualPool).cur : pickFrom(rankedPool).ranked);
    const seed = rng.int(2 ** 31);
    const s = i % 2 ? rollSurge([teamPower(a), teamPower(b)], seed) : null;
    const x = simulateBattle({ sides: [{ members: a }, { members: b }], seed: seed + 1, surge: s });
    const y = m.simulateBattle({ sides: [{ members: a }, { members: b }], seed: seed + 1, surge: s });
    if (JSON.stringify(x) !== JSON.stringify(y)) diff++;
  }
  results.parity = { battles: P, differences: diff };
  say(`\n## 0. No-item parity with master's engine: ${diff} differences in ${P} battles (full result objects compared)`);
}

// ---------- 1. Each item, one holder (the lead), ranked mirrors ----------
say(`\n## 1. One holder (slot 1), ranked production mirrors (Lv 50). ${N} battles per row.`);
results.single = [];
for (const id of ALL.filter((i) => i !== "lucky_egg")) {
  if (["light_ball", "thick_club"].includes(id)) continue; // species items: §6
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [lead(t, id), t]; });
  results.single.push({ id, win: r.w / r.n });
  say(`| ${id} | ${fmt(r.w, r.n)} |`);
}

// ---------- 2. Full loadouts ----------
say(`\n## 2. Full loadouts vs the same team without items (ranked mirrors). ${N} battles per row.`);
results.loadouts = {};
for (const [label, f] of [["starter loadout (6 of the 7 combat starters)", starterLoadout], ["optimized 6-item loadout (all 33)", (t) => loadout(t)]]) {
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [f(t), t]; });
  results.loadouts[label] = { win: r.w / r.n, turns: r.turns, cap: r.cap };
  say(`| ${label} | ${fmt(r.w, r.n)} | turns ${r.turns.toFixed(1)} | turn cap ${pct(r.cap)} |`);
}
{
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [loadout(t), starterLoadout(t)]; });
  results.loadouts["optimized vs starter"] = { win: r.w / r.n };
  say(`| optimized vs starter loadout (same team) | ${fmt(r.w, r.n)} |`);
}

// ---------- 3. Tiers ----------
const pool = acquirablePokemon(Object.values(pokemonData)).filter((p) => getSpecies(Number(p.id)));
const byTier = (t) => pool.filter((p) => String(p.tier).toLowerCase() === t).map((p) => Number(p.id));
const tierTeam = (t) => { const ids = new Set(); const arr = byTier(t); while (ids.size < 6) ids.add(pickFrom(arr)); return [...ids].map((id) => ({ speciesId: id, variant: "normal", level: 50 })); };
say(`\n## 3. Lower vs higher tier at Lv 50 (lower tier's win rate). ${N} per cell.`);
results.tiers = [];
for (const [lo, hi] of [["common", "uncommon"], ["uncommon", "rare"], ["rare", "epic"], ["epic", "legendary"], ["rare", "legendary"]]) {
  const row = { lo, hi };
  for (const [k, fa, fb] of [["none", none, none], ["both", loadout, loadout], ["lowOnly", loadout, none], ["highOnly", none, loadout], ["bothStarter", starterLoadout, starterLoadout]]) {
    const r = series(N, () => [fa(tierTeam(lo)), fb(tierTeam(hi))]);
    row[k] = r.w / r.n;
  }
  results.tiers.push(row);
  say(`| ${lo} vs ${hi} | none ${pct(row.none)} | both optimized ${pct(row.both)} | both starter ${pct(row.bothStarter)} | only ${lo} ${pct(row.lowOnly)} | only ${hi} ${pct(row.highOnly)} |`);
}

// ---------- 4. Power-gap bins ----------
function bins(poolArr, get, { surge, label }) {
  const B = [[1, 1.1], [1.1, 1.25], [1.25, 1.5], [1.5, 2], [2, 3], [3, 1e9]];
  const acc = B.map(() => ({ n: 0, none: 0, both: 0, fav: 0, dog: 0 }));
  for (let i = 0; i < N * 8; i++) {
    let a = get(pickFrom(poolArr)), b = get(pickFrom(poolArr));
    let pa = teamPower(a), pb = teamPower(b);
    if (pa > pb) { [a, b] = [b, a]; [pa, pb] = [pb, pa]; }
    const k = B.findIndex(([l, h]) => pb / Math.max(1, pa) >= l && pb / Math.max(1, pa) < h);
    if (k < 0 || acc[k].n >= Math.round(N / 2)) continue;
    const c = acc[k]; c.n++;
    c.none += fight(a, b, { surge }).aWon;
    c.both += fight(loadout(a), loadout(b), { surge }).aWon;
    c.fav += fight(a, loadout(b), { surge }).aWon;
    c.dog += fight(loadout(a), b, { surge }).aWon;
  }
  say(`\n## 4. ${label}: underdog win rate by Power ratio (optimized loadouts, Item Clause)`);
  say("| Power ratio | pairs | no items | both | only favourite | only underdog |");
  return B.map(([l, h], i) => {
    const c = acc[i];
    const row = { bin: `${l}–${h >= 1e9 ? "∞" : h}`, n: c.n, none: c.none / c.n, both: c.both / c.n, fav: c.fav / c.n, dog: c.dog / c.n };
    if (c.n) say(`| ${row.bin}× | ${c.n} | ${pct(row.none)} | ${pct(row.both)} | ${pct(row.fav)} | ${pct(row.dog)} |`);
    return row;
  });
}
results.rankedBins = bins(rankedPool, (p) => p.ranked, { surge: false, label: "Ranked (Lv 50)" });
results.casualBins = bins(casualPool, (p) => p.cur, { surge: true, label: "Casual (real Levels, surge on)" });

// ---------- 5. RNG items: activation and effect ----------
say(`\n## 5. RNG-heavy items: activation frequency and outcome change (ranked mirrors; side A holds the items shown, side B the same team without items). ${N} per row.`);
results.rng = [];
for (const [label, f] of [
  ["Bright Powder on slot 1", (t) => lead(t, "bright_powder")],
  ["Focus Band on slot 1", (t) => lead(t, "focus_band")],
  ["Quick Claw on slot 1", (t) => lead(t, "quick_claw")],
  ["Bright Powder + Focus Band + Quick Claw (slots 1–3)", (t) => t.map((m, i) => (i < 3 ? { ...m, item: ["bright_powder", "focus_band", "quick_claw"][i] } : m))],
]) {
  const base = series(N, () => { const t = pickFrom(rankedPool).ranked; return [t, t]; });
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [f(t), t]; });
  const row = { label, win: r.w / r.n, perBattle: Object.fromEntries(Object.entries(r.act).map(([k, v]) => [k, v / N])), baseMisses: base.act.missed / N };
  results.rng.push(row);
  say(`| ${label} | holder side wins ${fmt(r.w, r.n)} | Focus Band saves/battle ${row.perBattle.focusBand.toFixed(3)} | Quick Claw/battle ${row.perBattle.quickClaw.toFixed(3)} | misses/battle ${row.perBattle.missed.toFixed(2)} (no items ${row.baseMisses.toFixed(2)}) |`);
}

// ---------- 6. Species items ----------
say(`\n## 6. Species items: holder vs the same Pokémon without it (1v1 at Lv 50 against random fully evolved rare/epic foes). ${N} per row.`);
results.species = [];
const foes = [...byTier("rare"), ...byTier("epic")].filter((id) => !canEvolve(id));
for (const [id, sp] of [["light_ball", 25], ["thick_club", 105]]) {
  const w = series(N, () => [[{ speciesId: sp, level: 50, item: id }], [{ speciesId: pickFrom(foes), level: 50 }]]);
  const wo = series(N, () => [[{ speciesId: sp, level: 50 }], [{ speciesId: pickFrom(foes), level: 50 }]]);
  results.species.push({ id, with: w.w / N, without: wo.w / N });
  say(`| ${id} (#${sp}) | with ${pct(w.w / N)} | without ${pct(wo.w / N)} |`);
}

// ---------- 7. Megas and abilities ----------
const megaForms = allMegas().filter((f) => f.battleProfile?.verified && f.species <= 721).map((f) => f.id).filter((id) => { try { return !!megaBattleProfile(id); } catch { return false; } });
say(`\n## 7. Mega + abilities (${megaForms.length} verified Mega profiles): a Mega in slot 1 (no regular item, as buildTeam enforces); team-mates itemized vs not. ${N} per row.`);
{
  const withMega = (t) => [{ speciesId: 0, ...(() => { const p = megaBattleProfile(pickFrom(megaForms)); return { speciesId: p.species, level: 50, battleProfile: p }; })() }, ...t.slice(1)];
  const a = series(N, () => { const t = withMega(pickFrom(rankedPool).ranked); return [[t[0], ...loadout(t.slice(1))], t]; });
  const b = series(N, () => { const t = withMega(pickFrom(rankedPool).ranked); return [t, t]; });
  results.mega = { itemized: a.w / N, control: b.w / N, turns: a.turns, cap: a.cap };
  say(`| Mega lead, team-mates itemized vs same team without items | ${fmt(a.w, N)} | control (no items) ${pct(b.w / N)} | turn cap ${pct(a.cap)} |`);
}

// ---------- 8. Stall ----------
say(`\n## 8. Defensive stall (both sides the same configuration). ${N} per row.`);
results.stall = [];
const walls = [113, 242, 213, 143, 131, 289].filter((id) => getSpecies(id)).map((id) => ({ speciesId: id, variant: "normal", level: 50 }));
for (const [label, mk] of [
  ["no items (production pairs)", () => [pickFrom(rankedPool).ranked, pickFrom(rankedPool).ranked]],
  ["optimized (production pairs)", () => [loadout(pickFrom(rankedPool).ranked), loadout(pickFrom(rankedPool).ranked)]],
  ["walls: Leftovers / Sitrus / Shell Bell / Bright Powder / Focus Band / Eviolite", () => { const t = walls.map((m, i) => ({ ...m, item: ["leftovers", "sitrus_berry", "shell_bell", "bright_powder", "focus_band", "eviolite"][i] })); return [t, t]; }],
]) {
  const r = series(Math.min(N, 1000), mk);
  results.stall.push({ label, turns: r.turns, cap: r.cap, perBattle: Object.fromEntries(Object.entries(r.act).map(([k, v]) => [k, v / Math.min(N, 1000)])) });
  say(`| ${label} | mean turns ${r.turns.toFixed(1)} | turn cap ${pct(r.cap)} | Leftovers heals/battle ${(r.act.leftovers / Math.min(N, 1000)).toFixed(1)} |`);
}

// ---------- 9. Determinism ----------
{
  let same = 0;
  for (let i = 0; i < 500; i++) {
    const a = loadout(pickFrom(rankedPool).ranked), b = loadout(pickFrom(rankedPool).ranked);
    const seed = rng.int(2 ** 31);
    const x = simulateBattle({ sides: [{ members: a }, { members: b }], seed, surge: null });
    const y = simulateBattle({ sides: [{ members: a }, { members: b }], seed, surge: null });
    if (JSON.stringify(x) === JSON.stringify(y)) same++;
  }
  results.replay = { battles: 500, identical: same };
  say(`\n## 9. Seeded replays with items: ${same}/500 identical (full result + log)`);
}

// ---------- 10. Lucky Egg (progression, not combat) ----------
{
  const gains = [];
  for (let i = 0; i < N; i++) {
    const a = pickFrom(casualPool).cur, b = pickFrom(casualPool).cur;
    const { r } = fight(a, b);
    const ko = r.knockouts.filter((k) => k.bySide === 0).map((k) => b[k.slot]);
    gains.push(teamExp({ members: a, knockedOut: ko, won: r.winner === 0 })[0]);
  }
  const mean = gains.reduce((x, y) => x + y, 0) / gains.length;
  const egg = gains.reduce((x, y) => x + Math.floor(y * 1.5), 0) / gains.length;
  results.luckyEgg = { meanBaseExpSlot1: mean, meanWithEgg: egg, ratio: egg / mean };
  say(`\n## 10. Lucky Egg: slot-1 battle EXP per casual battle (production pairs) ${mean.toFixed(1)} → ${egg.toFixed(1)} with the egg (×${(egg / mean).toFixed(3)}; floor rounding). Combat unchanged (it is not a combat item).`);
}

fs.writeFileSync(new URL("./implemented.json", outDir), JSON.stringify(results, null, 2));
fs.writeFileSync(new URL("./implemented.log", outDir), log.join("\n"));
