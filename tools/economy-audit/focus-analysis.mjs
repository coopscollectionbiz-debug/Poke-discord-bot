#!/usr/bin/env node
// ==========================================================
// tools/economy-audit/focus-analysis.mjs: how Focus (type or region) can be
// gamed, with exact probabilities (no sampling). Code-only, no player data.
//
//   POKEMON_GENERATIONS=6 node tools/economy-audit/focus-analysis.mjs > docs/audits/economy-2026-11/focus-analysis.json
//
// The rule analysed is the one built in utils/weightedRandom.js
// selectFocusedPokemon: the ball's Tier odds are kept; Common..Legendary
// picks come from the Focus pool (a Tier the pool lacks is re-rolled among
// the pool's other non-Mythic Tiers); a Mythic ignores the Focus and the
// surcharge is refunded.
//
// For every Focus (18 types, 6 regions) x ball x Rank it reports:
//   profit      donation value of a throw / what it costs (shiny 5x included),
//               also at the 30% maximum ball sale (D2)
//   chase       how much cheaper per CC one specific species gets vs a plain
//               throw of the same ball; the worst species overall and the
//               worst Legendary
//   dex         CC to register every non-Mythic species of a region,
//               plain vs region Focus (coupon collector, exact integral)
//   boost       the chase advantage when a Live event Catch boost x3 sits on
//               that same species (worst case stacking)
//   capShare    the surcharge (share of the ball's list price) that would
//               hold the worst Legendary chase advantage to CAP
// ==========================================================

process.env.POKEMON_GENERATIONS ??= "6";
const root = new URL("../../", import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const { rollRows } = await imp("utils/weightedRandom.js");
const { acquirablePokemon } = await imp("utils/speciesCatalog.js");
const { DONATION_CC_BY_TIER } = await imp("utils/economyRules.js");
const { BALL_COST } = await imp("services/gameplay.js");
const { TYPE_ID_TO_NAME } = await imp("utils/battle/data.js");
const { getShinyOdds } = await imp("shinyOdds.js");
const { NO_EFFECTS, boostedWeights } = await imp("utils/liveEventRules.js");
const pokemonData = (await import(new URL("pokemonData.json", root).href, { with: { type: "json" } })).default;

const POOL = acquirablePokemon(Object.values(pokemonData));
const BALLS = ["pokeball", "greatball", "ultraball"];
const RANKS = { Master: 25_000, Legend: 250_000 };
const TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const CAP = 4; // the most we'd let Focus cheapen one specific Legendary, per CC
const SHARES = { flat50: 0.5 };
const r2 = (n) => Math.round(n * 100) / 100;

const FOCI = [
  ...Object.entries(TYPE_ID_TO_NAME).map(([id, name]) => ({ kind: "type", name, test: (p) => (p.types ?? []).map(Number).includes(Number(id)) })),
  ...[...new Set(POOL.map((p) => p.region))].map((name) => ({ kind: "region", name, test: (p) => p.region === name })),
];

/** Exact per-species chance of one throw: Map id -> { p, tier, sp }, plus mythic mass. */
function distribution(ball, tp, focus = null, fx = NO_EFFECTS, { mythicFocus = false } = {}) {
  const user = { tp };
  const rows = fx === NO_EFFECTS ? rollRows(POOL, user, ball) : (() => {
    const base = rollRows(POOL, user, ball); // ball-filtered, rank weights
    return boostedWeights(base.map((r) => r.item), fx, (p) => base.find((b) => b.item === p).w);
  })();
  const W = rows.reduce((s, r) => s + r.w, 0);
  const tierW = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const r of rows) tierW[r.item.tier] += r.w;
  const out = new Map();
  if (!focus) {
    for (const r of rows) out.set(r.item.id, { p: r.w / W, tier: r.item.tier, sp: r.item });
    return { out, pMythic: tierW.mythic / W };
  }
  const fW = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const r of rows) if (focus.test(r.item)) fW[r.item.tier] += r.w;
  const focusTiers = mythicFocus ? TIERS : TIERS.filter((t) => t !== "mythic");
  const have = focusTiers.filter((t) => fW[t] > 0 && tierW[t] > 0);
  if (!have.length) return null;
  const missing = focusTiers.filter((t) => !have.includes(t)).reduce((s, t) => s + tierW[t], 0) / W;
  const haveW = have.reduce((s, t) => s + tierW[t], 0);
  const pTier = (t) => tierW[t] / W + missing * (tierW[t] / haveW);
  for (const r of rows) {
    const t = r.item.tier;
    if (t === "mythic" && !mythicFocus) out.set(r.item.id, { p: (tierW.mythic / W) * (r.w / tierW.mythic), tier: t, sp: r.item });
    else if (focus.test(r.item) && have.includes(t)) out.set(r.item.id, { p: pTier(t) * (r.w / fW[t]), tier: t, sp: r.item });
  }
  return { out, pMythic: tierW.mythic / W };
}

const donateEV = (dist, tp) => {
  const shiny = getShinyOdds(tp);
  let ev = 0;
  for (const { p, tier } of dist.out.values()) ev += p * DONATION_CC_BY_TIER[tier] * (1 + 4 * shiny);
  return ev;
};

// Expected throws to see every species in `ids` once: integral of
// 1 - prod(1 - e^{-p t}) over t (Poissonised coupon collector, exact).
function collectThrows(ps) {
  const f = (t) => 1 - ps.reduce((acc, p) => acc * (1 - Math.exp(-p * t)), 1);
  const pmin = Math.min(...ps);
  let hi = 1;
  while (f(hi) > 1e-6) hi *= 2;
  const n = 4000, h = hi / n;
  let s = (f(0) + f(hi)) / 2;
  for (let i = 1; i < n; i++) s += f(i * h);
  return s * h || 1 / pmin;
}

const results = [];
for (const [rank, tp] of Object.entries(RANKS)) {
  for (const ball of BALLS) {
    const list = BALL_COST[ball];
    const plain = distribution(ball, tp);
    const plainEV = donateEV(plain, tp);
    for (const focus of FOCI) {
      const d = distribution(ball, tp, focus);
      if (!d) { results.push({ rank, ball, focus: focus.name, kind: focus.kind, empty: true }); continue; }
      const pool = [...d.out.values()].filter((x) => x.tier !== "mythic");
      const ev = donateEV(d, tp);
      const row = { rank, ball, focus: focus.name, kind: focus.kind, poolSpecies: pool.length, donateEV: Math.round(ev), plainDonateEV: Math.round(plainEV), pMythic: r2(d.pMythic * 100) };
      // per share of the list price
      for (const [label, share] of Object.entries(SHARES)) {
        const s = list * share;
        const cost = list + s - d.pMythic * s; // expected, refund on a Mythic
        const costSale = list * 0.7 + s - d.pMythic * s;
        row[label] = { cost: Math.round(cost), profit: r2(ev / cost), profitAtSale: r2(ev / costSale) };
      }
      // chase: worst species and worst Legendary, advantage per CC at flat 50%
      const costF = list * 1.5, costP = list;
      let worst = { adv: 0 }, worstLeg = { adv: 0 };
      for (const x of pool) {
        const pp = plain.out.get(x.sp.id)?.p ?? 0;
        if (!pp) continue;
        const advRaw = x.p / pp; // chance multiplier
        const adv = advRaw * (costP / costF);
        if (adv > worst.adv) worst = { adv: r2(adv), species: x.sp.name, tier: x.tier, chanceX: r2(advRaw) };
        if (x.tier === "legendary" && adv > worstLeg.adv) worstLeg = { adv: r2(adv), species: x.sp.name, chanceX: r2(advRaw), ccToGetFocused: Math.round(costF / x.p), ccToGetPlain: Math.round(costP / pp) };
      }
      row.chase = { worst, worstLegendary: worstLeg.adv ? worstLeg : null };
      // share needed so the worst Legendary chase is at most CAP times cheaper per CC
      if (worstLeg.adv) row.capShare = r2(Math.max(0, worstLeg.chanceX / CAP - 1));
      // stacking: a Catch boost x3 on that Legendary
      if (worstLeg.adv) {
        const fx = { ...NO_EFFECTS, boosts: [{ value: 3, match: { species: [pool.find((x) => x.sp.name === worstLeg.species).sp.id] } }] };
        const db = distribution(ball, tp, focus, fx), pb = distribution(ball, tp, null, fx);
        const id = pool.find((x) => x.sp.name === worstLeg.species).sp.id;
        row.boostedLegendaryChanceX = r2((db.out.get(id)?.p ?? 0) / (pb.out.get(id)?.p ?? 1));
      }
      results.push(row);
    }
  }
}

// Pokédex: CC to register every non-Mythic species of each region (Poké Ball, Master Rank).
const dex = [];
for (const focus of FOCI.filter((f) => f.kind === "region")) {
  for (const ball of BALLS) {
    const plain = distribution(ball, RANKS.Master);
    const foc = distribution(ball, RANKS.Master, focus);
    const ids = [...foc.out.values()].filter((x) => x.tier !== "mythic").map((x) => x.sp.id);
    const pp = ids.map((id) => plain.out.get(id)?.p ?? 0).filter((p) => p > 0);
    const pf = ids.map((id) => foc.out.get(id).p);
    const plainCC = pp.length === ids.length ? Math.round(collectThrows(pp) * BALL_COST[ball]) : null;
    const focusCC = Math.round(collectThrows(pf) * BALL_COST[ball] * 1.5);
    dex.push({ region: focus.name, ball, species: ids.length, plainCC, focusCC, speedup: plainCC ? r2(plainCC / focusCC) : null });
  }
}

// Chasing one specific Legendary or Mythic with the Focus applying at every Tier
// (owner, 2026-11-13: "let players chase specific legendaries and mythics").
// Ultra Ball, Master Rank, flat +50%. INCOME = gross CC per active player per
// day in the live window (REPORT.md 1.2: 438,410 / 116.6 player-days).
const INCOME = 3760;
const chase = [];
{
  const ball = "ultraball", tp = RANKS.Master, costF = BALL_COST[ball] * 1.5, costP = BALL_COST[ball];
  const plain = distribution(ball, tp);
  for (const focus of FOCI) {
    const d = distribution(ball, tp, focus, NO_EFFECTS, { mythicFocus: true });
    if (!d) continue;
    for (const x of d.out.values()) {
      if (x.tier !== "legendary" && x.tier !== "mythic") continue;
      const pp = plain.out.get(x.sp.id).p;
      chase.push({ focus: focus.name, kind: focus.kind, species: x.sp.name, tier: x.tier, chanceX: r2(x.p / pp), ccFocused: Math.round(costF / x.p), ccPlain: Math.round(costP / pp), daysOfIncome: Math.round(costF / x.p / INCOME) });
    }
  }
}
// Best (cheapest) Focus for each Legendary/Mythic species.
const bestPerSpecies = Object.values(chase.reduce((m, c) => { if (!m[c.species] || c.ccFocused < m[c.species].ccFocused) m[c.species] = c; return m; }, {}));
const chaseSummary = ["legendary", "mythic"].map((tier) => {
  const xs = bestPerSpecies.filter((c) => c.tier === tier).sort((a, b) => a.ccFocused - b.ccFocused);
  const med = xs[Math.floor(xs.length / 2)];
  return { tier, species: xs.length, cheapest: xs.slice(0, 5), median: med, priciest: xs.at(-1) };
});

const summary = {
  chaseWithMythicFocus: chaseSummary,
  worstProfit: results.filter((r) => !r.empty).sort((a, b) => b.flat50.profitAtSale - a.flat50.profitAtSale).slice(0, 5).map((r) => ({ rank: r.rank, ball: r.ball, focus: r.focus, profit: r.flat50.profit, profitAtSale: r.flat50.profitAtSale })),
  worstLegendaryChase: results.filter((r) => r.chase?.worstLegendary).sort((a, b) => b.chase.worstLegendary.adv - a.chase.worstLegendary.adv).slice(0, 10).map((r) => ({ rank: r.rank, ball: r.ball, focus: r.focus, ...r.chase.worstLegendary, capShare: r.capShare, boostedChanceX: r.boostedLegendaryChanceX })),
};
process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), cap: CAP, summary, dex, results }, null, 2) + "\n");
