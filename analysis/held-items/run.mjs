// ==========================================================
// analysis/held-items/run.mjs — held-item balance simulations (audit only).
//
// Usage: node analysis/held-items/run.mjs <snapshotDir> [N=2000]
// Reads <snapshotDir>/trainerData.json READ-ONLY into memory and writes
// aggregates only (win rates, turn counts) to analysis/held-items/out/.
// No player id, name or per-player row is written.
// ==========================================================

import fs from "fs";
import path from "path";
import { simulateBattle } from "../../utils/battle/sim.js";
import { teamPower, rollSurge, pokemonPower } from "../../utils/battle/power.js";
import { createRng } from "../../utils/battle/rng.js";
import { getSpecies } from "../../utils/battle/data.js";
import { computeStats } from "../../utils/battle/stats.js";
import { buildTeam } from "../../utils/battle/runBattle.js";
import { getTraining } from "../../utils/training.js";
import { getRank } from "../../utils/rankSystem.js";
import { acquirablePokemon } from "../../utils/speciesCatalog.js";
import { simulateItemBattle, ITEMS, TYPE_BOOSTER_FOR, isNFE } from "./itemSim.mjs";

const dir = process.argv[2];
const N = Number(process.argv[3] ?? 2000);
const outDir = new URL("./out/", import.meta.url);
fs.mkdirSync(outDir, { recursive: true });
const pokemonData = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(dir, "trainerData.json"), "utf8"));
const rng = createRng(20261110);
const log = [];
const say = (s = "") => { log.push(s); console.log(s); };
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const wilson = (k, n) => {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
};
const fmt = (k, n) => { const [lo, hi] = wilson(k, n); return `${pct(k / n)} (${pct(lo)}–${pct(hi)})`; };
const tierOf = (id) => String(pokemonData[id]?.tier ?? "common").toLowerCase();

// ---------- production rosters (in memory only) ----------
function owned(u) {
  const out = [];
  for (const [id, c] of Object.entries(u.pokemon ?? {})) {
    if (!getSpecies(Number(id))) continue;
    for (const v of ["normal", "shiny"]) if ((c?.[v] ?? 0) > 0) out.push({ speciesId: Number(id), variant: v, level: getTraining(u, Number(id), v).level });
  }
  return out;
}
// Ranked legality: Lv 50, at most one mythic-tier, 6 distinct species, best Power at Lv 50.
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
const players = Object.values(data).map((u) => {
  const roster = owned(u);
  return { tp: u.tp ?? 0, rank: getRank(u.tp ?? 0) ?? "Unranked", cur: buildTeam(u).map((m) => ({ speciesId: m.speciesId, variant: "normal", level: m.level, ...(m.moves ? { moves: m.moves } : {}) })), ranked: rankedTeam(roster), rosterSize: roster.length };
});
const casualPool = players.filter((p) => p.cur.length > 0);
const rankedPool = players.filter((p) => p.ranked.length === 6);
say(`Production: ${Object.keys(data).length} records; ${casualPool.length} with a Display team; ${rankedPool.length} can field a full legal Lv 50 team.`);

// ---------- item assignment ----------
const statsAt = (m) => computeStats(getSpecies(m.speciesId).baseStats, m.level);
const LAUNCH = ["life_orb", "choice_band", "choice_specs", "choice_scarf", "leftovers", "focus_sash", "sitrus_berry", "eviolite", "expert_belt", "rocky_helmet", "muscle_band", "wise_glasses", "quick_claw", "shell_bell", "black_sludge"];
/**
 * A reasonable player's loadout (greedy by role). clause=true → every item
 * different (VGC Item Clause); type boosters are distinct items per type.
 */
function smartItems(team, { clause = true, pool = null } = {}) {
  const used = new Set();
  const allowed = (id) => (!pool || pool.includes(id) || (pool.includes("type_boosters") && Object.values(TYPE_BOOSTER_FOR).includes(id)));
  const take = (prefs) => {
    for (const id of prefs) if (id && allowed(id) && ITEMS[id] && (!clause || !used.has(id))) { used.add(id); return id; }
    return null;
  };
  const scored = team.map((m) => {
    const s = statsAt(m), sp = getSpecies(m.speciesId);
    const phys = s.atk >= s.spa;
    const bulk = s.hp * (s.def + s.spd);
    const offence = Math.max(s.atk, s.spa);
    return { m, s, sp, phys, bulk, offence };
  });
  const medSpe = [...scored].map((x) => x.s.spe).sort((a, b) => a - b)[Math.floor(scored.length / 2)];
  const medBulk = [...scored].map((x) => x.bulk).sort((a, b) => a - b)[Math.floor(scored.length / 2)];
  // Strongest attackers pick first.
  const order = [...scored].sort((a, b) => b.offence - a.offence);
  const pick = new Map();
  for (const x of order) {
    const booster = TYPE_BOOSTER_FOR[x.sp.types[0]];
    let prefs;
    if (isNFE(x.m.speciesId)) prefs = ["eviolite", "leftovers", "sitrus_berry", "focus_sash", booster];
    else if (x.bulk > medBulk && x.offence < x.bulk ** 0.5 / 4) prefs = ["leftovers", "sitrus_berry", "rocky_helmet", "shell_bell", booster];
    else if (x.s.spe >= medSpe) prefs = [x.phys ? "choice_band" : "choice_specs", "life_orb", "expert_belt", booster, "focus_sash", x.phys ? "muscle_band" : "wise_glasses"];
    else prefs = ["choice_scarf", "life_orb", "expert_belt", booster, "sitrus_berry", "quick_claw"];
    pick.set(x.m, take(prefs) ?? take(LAUNCH));
  }
  return team.map((m) => ({ ...m, item: pick.get(m) ?? undefined }));
}
const uniform = (team, item) => team.map((m) => ({ ...m, item: item === "eviolite" && !isNFE(m.speciesId) ? undefined : item }));
const none = (team) => team.map(({ item, ...m }) => m);

// ---------- battle ----------
function fight(A, B, { surge = false, engine = simulateItemBattle } = {}) {
  const swap = rng.int(2); // randomize Challenger/Defender: turn-cap ties go to side 1
  const sides = swap ? [B, A] : [A, B];
  const seed = rng.int(2 ** 31);
  const s = surge ? rollSurge(sides.map(teamPower), seed) : null;
  const r = engine({ sides: sides.map((members) => ({ members })), seed: seed + 1, surge: s });
  return { aWon: (r.winner === 0) !== !!swap, turns: r.turns, cap: r.endedBy === "turnCap", stats: r.stats };
}
function series(n, mk, opts) {
  let wins = 0, turns = 0, caps = 0;
  const agg = {};
  for (let i = 0; i < n; i++) {
    const [A, B] = mk(i);
    const r = fight(A, B, opts);
    wins += r.aWon; turns += r.turns; caps += r.cap;
    for (const [k, v] of Object.entries(r.stats ?? {})) agg[k] = (agg[k] ?? 0) + v;
  }
  return { wins, n, turns: turns / n, capRate: caps / n, agg };
}
const pickFrom = (arr) => arr[rng.int(arr.length)];
const results = {};

// ---------- 0. Parity: no items → identical to the live engine ----------
{
  let diff = 0;
  const P = 3000;
  for (let i = 0; i < P; i++) {
    const a = pickFrom(casualPool).cur, b = pickFrom(casualPool).cur;
    const seed = rng.int(2 ** 31);
    const s = rollSurge([teamPower(a), teamPower(b)], seed);
    const live = simulateBattle({ sides: [{ members: a }, { members: b }], seed: seed + 1, surge: s });
    const mine = simulateItemBattle({ sides: [{ members: a }, { members: b }], seed: seed + 1, surge: s });
    if (live.winner !== mine.winner || live.turns !== mine.turns || live.endedBy !== mine.endedBy) diff++;
  }
  for (let i = 0; i < P; i++) {
    const a = pickFrom(rankedPool).ranked, b = pickFrom(rankedPool).ranked;
    const seed = rng.int(2 ** 31);
    const live = simulateBattle({ sides: [{ members: a }, { members: b }], seed, surge: null });
    const mine = simulateItemBattle({ sides: [{ members: a }, { members: b }], seed, surge: null });
    if (live.winner !== mine.winner || live.turns !== mine.turns || live.endedBy !== mine.endedBy) diff++;
  }
  results.parity = { battles: 2 * P, differences: diff };
  say(`\n## 0. Parity with utils/battle/sim.js (no items): ${diff} differences in ${2 * P} battles`);
  if (diff) throw new Error("Prototype engine does not match the live engine; results would be invalid.");
}

// ---------- 1. Item value in mirror matches (ranked, Lv 50) ----------
say(`\n## 1. Mirror matches, ranked rules (Lv 50, ≤1 mythic). Same team both sides; side A holds the item(s). ${N} battles per row.`);
const mirrorRows = [];
const configs = [
  ["none (control)", (t) => t],
  ...["life_orb", "choice_band", "choice_specs", "choice_scarf", "leftovers", "focus_sash", "sitrus_berry", "assault_vest", "expert_belt", "rocky_helmet", "eviolite", "muscle_band", "wise_glasses", "shell_bell", "quick_claw", "scope_lens"].map((id) => [`all 6: ${id}`, (t) => uniform(t, id)]),
  ["all 6: STAB type booster", (t) => t.map((m) => ({ ...m, item: TYPE_BOOSTER_FOR[getSpecies(m.speciesId).types[0]] }))],
  ["smart loadout, Item Clause", (t) => smartItems(t, { clause: true })],
  ["smart loadout, no clause", (t) => smartItems(t, { clause: false })],
];
for (const [label, f] of configs) {
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [f(t), none(t)]; });
  mirrorRows.push({ label, winRate: r.wins / r.n, ci: wilson(r.wins, r.n), turns: r.turns, capRate: r.capRate });
  say(`| ${label} | ${fmt(r.wins, r.n)} | turns ${r.turns.toFixed(1)} | cap ${pct(r.capRate)} |`);
}
results.mirror = mirrorRows;

// ---------- 2. Does an item help strong or weak teams more? (synthetic tiers, Lv 50) ----------
say(`\n## 2. Item uplift by species tier (mirror, Lv 50; 6 random species of one tier). ${N} battles per cell.`);
const pool = acquirablePokemon(Object.values(pokemonData)).filter((p) => getSpecies(Number(p.id)));
const byTier = (t) => pool.filter((p) => String(p.tier).toLowerCase() === t).map((p) => Number(p.id));
const tierTeam = (t) => { const ids = new Set(); const arr = byTier(t); while (ids.size < 6) ids.add(pickFrom(arr)); return [...ids].map((id) => ({ speciesId: id, variant: "normal", level: 50 })); };
const tierRows = [];
for (const tier of ["common", "uncommon", "rare", "epic", "legendary"]) {
  const row = { tier };
  for (const [label, f] of [["life_orb", (t) => uniform(t, "life_orb")], ["leftovers", (t) => uniform(t, "leftovers")], ["focus_sash", (t) => uniform(t, "focus_sash")], ["eviolite", (t) => uniform(t, "eviolite")], ["smart", (t) => smartItems(t)]]) {
    const r = series(N, () => { const t = tierTeam(tier); return [f(t), none(t)]; });
    row[label] = r.wins / r.n;
  }
  row.nfeShare = (() => { let n = 0, k = 0; for (let i = 0; i < 200; i++) for (const m of tierTeam(tier)) { n++; k += isNFE(m.speciesId); } return k / n; })();
  tierRows.push(row);
  say(`| ${tier} | Life Orb ${pct(row.life_orb)} | Leftovers ${pct(row.leftovers)} | Sash ${pct(row.focus_sash)} | Eviolite ${pct(row.eviolite)} (NFE share ${pct(row.nfeShare)}) | smart ${pct(row.smart)} |`);
}
results.tierUplift = tierRows;

// Cross-tier: can items close a species-quality gap? Lower tier with smart items vs higher tier without, and both with.
say(`\n## 2b. Cross-tier at Lv 50: lower tier's win rate. ${N} battles per cell.`);
const cross = [];
for (const [lo, hi] of [["common", "uncommon"], ["uncommon", "rare"], ["rare", "epic"], ["epic", "legendary"], ["common", "epic"], ["rare", "legendary"]]) {
  const base = series(N, () => [tierTeam(lo), tierTeam(hi)]);
  const both = series(N, () => [smartItems(tierTeam(lo)), smartItems(tierTeam(hi))]);
  const loOnly = series(N, () => [smartItems(tierTeam(lo)), tierTeam(hi)]);
  const hiOnly = series(N, () => [tierTeam(lo), smartItems(tierTeam(hi))]);
  const row = { lo, hi, none: base.wins / N, both: both.wins / N, underdogOnly: loOnly.wins / N, favouriteOnly: hiOnly.wins / N };
  cross.push(row);
  say(`| ${lo} vs ${hi} | none ${pct(row.none)} | both itemized ${pct(row.both)} | only ${lo} ${pct(row.underdogOnly)} | only ${hi} ${pct(row.favouriteOnly)} |`);
}
results.crossTier = cross;

// ---------- 3. Power-gap bins with production ranked teams ----------
function bins(poolArr, getTeam, { surge, label }) {
  const B = [[1, 1.1], [1.1, 1.25], [1.25, 1.5], [1.5, 2], [2, 3], [3, 1e9]];
  const acc = B.map(() => ({ n: 0, none: 0, both: 0, favOnly: 0, dogOnly: 0 }));
  for (let i = 0; i < N * 6; i++) {
    let a = getTeam(pickFrom(poolArr)), b = getTeam(pickFrom(poolArr));
    let pa = teamPower(a), pb = teamPower(b);
    if (pa > pb) { [a, b] = [b, a]; [pa, pb] = [pb, pa]; } // a = underdog
    const ratio = pb / Math.max(1, pa);
    const k = B.findIndex(([l, h]) => ratio >= l && ratio < h);
    if (k < 0 || acc[k].n >= N) continue;
    const c = acc[k];
    c.n++;
    c.none += fight(a, b, { surge }).aWon;
    c.both += fight(smartItems(a), smartItems(b), { surge }).aWon;
    c.favOnly += fight(a, smartItems(b), { surge }).aWon;
    c.dogOnly += fight(smartItems(a), b, { surge }).aWon;
  }
  say(`\n## 3. ${label}: underdog win rate by Power ratio (smart loadouts, Item Clause)`);
  say("| Power ratio | pairs | no items | both itemized | only favourite | only underdog |");
  return B.map(([l, h], i) => {
    const c = acc[i];
    const row = { bin: `${l}–${h >= 1e9 ? "∞" : h}`, n: c.n, none: c.none / c.n, both: c.both / c.n, favOnly: c.favOnly / c.n, dogOnly: c.dogOnly / c.n };
    if (c.n) say(`| ${row.bin}× | ${c.n} | ${pct(row.none)} | ${pct(row.both)} | ${pct(row.favOnly)} | ${pct(row.dogOnly)} |`);
    return row;
  });
}
results.rankedBins = bins(rankedPool, (p) => p.ranked, { surge: false, label: "Ranked (production rosters at Lv 50)" });
results.casualBins = bins(casualPool, (p) => p.cur, { surge: true, label: "Casual (production Display teams, real Levels, surge on)" });

// ---------- 4. Stalling / loops ----------
say(`\n## 4. Battle length and turn-cap rate (ranked production mirrors of random pairs)`);
const lengthRows = [];
for (const [label, f] of [["no items", (t) => t], ["all Leftovers", (t) => uniform(t, "leftovers")], ["all Leftovers + Sitrus mix", (t) => t.map((m, i) => ({ ...m, item: i % 2 ? "leftovers" : "sitrus_berry" }))], ["smart (clause)", (t) => smartItems(t)], ["smart (no clause)", (t) => smartItems(t, { clause: false })], ["all Shell Bell", (t) => uniform(t, "shell_bell")]]) {
  const r = series(N, () => [f(pickFrom(rankedPool).ranked), f(pickFrom(rankedPool).ranked)]);
  lengthRows.push({ label, turns: r.turns, capRate: r.capRate, agg: r.agg });
  say(`| ${label} | mean turns ${r.turns.toFixed(1)} | turn cap ${pct(r.capRate)} | per-battle: sash ${(r.agg.sash / N).toFixed(2)}, berries ${(r.agg.berry / N).toFixed(2)}, residual heal HP ${(r.agg.residualHeal / N).toFixed(0)} |`);
}
// Worst case: two bulky walls with weak resisted moves, Leftovers on both.
const walls = [{ speciesId: 113, level: 50 }, { speciesId: 242, level: 50 }, { speciesId: 213, level: 50 }].filter((m) => getSpecies(m.speciesId));
const wr = series(Math.min(N, 500), () => [uniform(walls, "leftovers"), uniform(walls, "leftovers")]);
say(`| worst case: Chansey/Blissey/Shuckle walls, all Leftovers | mean turns ${wr.turns.toFixed(1)} | turn cap ${pct(wr.capRate)} |`);
lengthRows.push({ label: "walls + Leftovers", turns: wr.turns, capRate: wr.capRate });
results.length = lengthRows;

// ---------- 5. Casual: does a rich high-rank player gain more? ----------
say(`\n## 5. Casual Display teams by rank: high rank (Veteran+) vs low rank (≤ Skilled), surge on`);
const HIGH = new Set(["Veteran Trainer", "Elite Trainer", "Master Trainer", "Gym Leader", "Elite Four Member", "Champion", "Legend"]);
const LOW = new Set(["Unranked", "Novice Trainer", "Junior Trainer", "Skilled Trainer"]);
const hi = casualPool.filter((p) => HIGH.has(p.rank)), lo = casualPool.filter((p) => LOW.has(p.rank));
const rk = {};
for (const [label, fa, fb] of [["no items", none, none], ["both itemized", smartItems, smartItems], ["only high rank itemized", none, smartItems], ["only low rank itemized", smartItems, none]]) {
  const r = series(N, () => [fa(pickFrom(lo).cur), fb(pickFrom(hi).cur)], { surge: true });
  rk[label] = r.wins / r.n;
  say(`| ${label} | low rank wins ${fmt(r.wins, r.n)} |`);
}
results.rankCasual = { highN: hi.length, lowN: lo.length, ...rk };

// ---------- 6. One holder (Item Clause reality): the item on the lead only ----------
say(`\n## 6. One holder: the item on slot 1 only (ranked production mirrors). ${N} battles per row.`);
const single = [];
for (const id of ["life_orb", "choice_band", "choice_specs", "choice_scarf", "leftovers", "focus_sash", "sitrus_berry", "assault_vest", "expert_belt", "rocky_helmet", "eviolite", "shell_bell", "quick_claw", "scope_lens", "muscle_band"]) {
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [t.map((m, i) => (i === 0 ? { ...m, item: id } : m)), t]; });
  single.push({ id, winRate: r.wins / r.n });
  say(`| ${id} | ${fmt(r.wins, r.n)} |`);
}
results.singleHolder = single;

// ---------- 7. Power equivalent of a full loadout ----------
// Side B (no items) fights at Level × m; find m where the itemized side A is at ~50%.
say(`\n## 7. Level equivalent of a full smart loadout (Item Clause), ranked mirrors`);
const eq = [];
for (const m of [1, 1.03, 1.06, 1.1, 1.15]) {
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const t = pickFrom(rankedPool).ranked;
    const seed = rng.int(2 ** 31);
    const r = simulateItemBattle({ sides: [{ members: smartItems(t) }, { members: t }], seed, surge: m > 1 ? { side: 1, levelMult: m } : null });
    wins += r.winner === 0;
  }
  const powerRatio = teamPower(pickFrom(rankedPool).ranked.map((x) => ({ ...x, level: Math.round(50 * m) }))) / 1; // illustrative only
  void powerRatio;
  eq.push({ levelMult: m, itemizedWins: wins / N });
  say(`| opponent at Lv ${Math.round(50 * m)} (×${m}) | itemized side wins ${fmt(wins, N)} |`);
}
results.levelEquivalent = eq;

// ---------- 8. Tuning candidates for outliers ----------
say(`\n## 8. Tuning candidates (all-6 mirrors, ranked). ${N} battles per row.`);
const variants = [];
const save = { rh: ITEMS.rocky_helmet, sitrus: ITEMS.sitrus_berry, lo: ITEMS.life_orb };
const trial = (label, patch, item) => {
  Object.assign(ITEMS, patch);
  const r = series(N, () => { const t = pickFrom(rankedPool).ranked; return [uniform(t, item), t]; });
  Object.assign(ITEMS, { rocky_helmet: save.rh, sitrus_berry: save.sitrus, life_orb: save.lo });
  variants.push({ label, winRate: r.wins / r.n });
  say(`| ${label} | ${fmt(r.wins, r.n)} |`);
};
trial("Rocky Helmet 1/6 (mainline)", {}, "rocky_helmet");
trial("Rocky Helmet 1/8", { rocky_helmet: { onHitBy: (c) => c.contact && c.attacker.hp > 0 && c.hurtOther(c.attacker, Math.max(1, Math.floor(c.attacker.maxHp / 8))) } }, "rocky_helmet");
trial("Rocky Helmet 1/6, once per battle", { rocky_helmet: { oncePerBattle: true, onHitBy: (c) => c.contact && c.attacker.hp > 0 && c.hurtOther(c.attacker, Math.max(1, Math.floor(c.attacker.maxHp / 6))) } }, "rocky_helmet");
trial("Sitrus 1/4 (mainline)", {}, "sitrus_berry");
trial("Life Orb 1/10 per attack (mainline)", {}, "life_orb");
fs.writeFileSync(new URL("./results.json", outDir), JSON.stringify(results, null, 2));
fs.writeFileSync(new URL("./results.log", outDir), log.join("\n"));
