#!/usr/bin/env node
// ==========================================================
// tools/economy-audit/aggregate.mjs
// Read-only, aggregate-only economy numbers from production data.
//
//   node aggregate.mjs <trainerData.json> <events.ndjson> [--prev <older trainerData.json>] [--days 7]
//
// Prints one JSON object of totals, medians, percentiles and counts.
// It never prints a Discord id, a name, or any per-player row. It has no
// imports outside Node's standard library, so it can be copied to the
// server on its own, run with `sudo node`, and deleted.
//
// Prize and price constants below are copies of the code values on
// master b198f60d, with the source file named next to each, because the
// event log records some of them only as a flag (challenge `prize: true`).
// ==========================================================

import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const [dataPath, eventsPath] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const prevPath = flag("--prev", null);
const DAYS = Number(flag("--days", 7));
if (!dataPath || !eventsPath) {
  console.error("usage: node aggregate.mjs <trainerData.json> <events.ndjson> [--prev <older trainerData.json>] [--days 7]");
  process.exit(2);
}

// utils/challenge/roster.js:31-79 — prize(cc, stones, dust)
const CHALLENGE_PRIZE = {
  brock: [2500, 1, 5], misty: [3000, 1, 5], surge: [4000, 1, 10], erika: [5000, 1, 10],
  koga: [6000, 2, 15], sabrina: [7500, 2, 15], blaine: [9000, 2, 20], giovanni: [12000, 3, 25],
  elite4: [30000, 4, 40], blue: [50000, 5, 60], red: [100000, 6, 120],
};
const TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const DAY = 86_400_000;

// ---------- helpers (aggregates only) ----------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function pct(arr, ps = [10, 25, 50, 75, 90, 95, 99]) {
  const s = [...arr].sort((a, b) => a - b);
  const out = { n: s.length };
  if (!s.length) return out;
  for (const p of ps) out[`p${p}`] = s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  out.max = s.at(-1);
  out.sum = s.reduce((a, b) => a + b, 0);
  out.mean = Math.round(out.sum / s.length);
  return out;
}
const round = (n, to = 1) => Math.round(n / to) * to;
// The top of a small population can point at one player: p95, p99 and max are
// rounded (CC and TP to 5,000, other counts to 5) before anything is printed.
const coarse = (o, to) => (o && o.n ? { ...o, p95: round(o.p95, to), p99: round(o.p99, to), max: round(o.max, to) } : o);
const bucket = (arr, edges) => {
  const out = {};
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i], hi = edges[i + 1];
    out[hi == null ? `>=${lo}` : `${lo}-${hi - 1}`] = arr.filter((v) => v >= lo && (hi == null || v < hi)).length;
  }
  return out;
};
const tsOf = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

// ---------- players ----------
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const users = Object.entries(data).filter(([, u]) => u && typeof u === "object" && !Array.isArray(u));
const now = Date.now();

// Last active: lastActiveAt, else the latest daily / quest / recruit / weekly claim (CONTEXT.md "Last active").
const lastActive = (u) => Math.max(tsOf(u.lastActiveAt), tsOf(u.lastDaily), tsOf(u.lastQuest), tsOf(u.lastRecruit), tsOf(u.lastWeeklyPack));
const activeWithin = (days) => users.filter(([, u]) => now - lastActive(u) <= days * DAY);
const active7 = new Set(activeWithin(7).map(([k]) => k));
const active1 = new Set(activeWithin(1).map(([k]) => k));
const active30 = new Set(activeWithin(30).map(([k]) => k));

const itemQty = (u, id) => {
  const v = u.items?.[id];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return num(v.qty ?? v.quantity ?? v.count);
  return 0;
};
const tmCount = (u) => Object.entries(u.items ?? {}).filter(([k]) => k.startsWith("tm_")).reduce((t, [, v]) => t + (typeof v === "number" ? v : num(v?.qty ?? v?.quantity)), 0);
const copiesOf = (u) => {
  if (u.box && typeof u.box === "object") return Object.values(u.box);
  return [];
};
const legacyCount = (u) => Object.values(u.pokemon ?? {}).reduce((t, p) => t + num(p?.normal) + num(p?.shiny), 0);

function holdings(set) {
  const rows = users.filter(([k]) => set.has(k)).map(([, u]) => u);
  return {
    players: rows.length,
    cc: coarse(pct(rows.map((u) => num(u.cc))), 5000),
    ccBuckets: bucket(rows.map((u) => num(u.cc)), [0, 1000, 5000, 25000, 100000, 250000, 1000000]),
    tp: coarse(pct(rows.map((u) => num(u.tp))), 5000),
    evolutionStones: coarse(pct(rows.map((u) => itemQty(u, "evolution_stone"))), 5),
    shinyDust: coarse(pct(rows.map((u) => itemQty(u, "shiny_dust"))), 5),
    megaShards: pct(rows.map((u) => itemQty(u, "mega_shard"))),
    tms: pct(rows.map(tmCount)),
    trainersOwned: coarse(pct(rows.map((u) => (Array.isArray(u.trainers) ? u.trainers.length : Object.keys(u.trainers ?? {}).length))), 5),
    aurasOwned: pct(rows.map((u) => Object.keys(u.auras?.owned ?? {}).length)),
    copies: coarse(pct(rows.map((u) => copiesOf(u).length || legacyCount(u))), 5),
  };
}

// Supply: every player's CC, all players.
const supply = users.reduce((t, [, u]) => t + num(u.cc), 0);

// Owned copies by Tier needs species tiers; read pokemonData.json next to the repo if present.
let tierOf = null;
for (const p of [new URL("../../pokemonData.json", import.meta.url), "pokemonData.json"]) {
  try {
    const pd = JSON.parse(fs.readFileSync(p, "utf8"));
    tierOf = (id) => String(pd[id]?.tier ?? "common").toLowerCase();
    break;
  } catch {}
}
function ownedByTier(set) {
  if (!tierOf) return null;
  const out = Object.fromEntries(TIERS.map((t) => [t, { normal: 0, shiny: 0 }]));
  for (const [k, u] of users) {
    if (!set.has(k)) continue;
    const copies = copiesOf(u);
    if (copies.length) {
      for (const c of copies) {
        const t = tierOf(c.id ?? c.speciesId);
        if (out[t]) out[t][c.shiny || c.variant === "shiny" ? "shiny" : "normal"]++;
      }
    } else {
      for (const [id, p] of Object.entries(u.pokemon ?? {})) {
        const t = tierOf(id);
        if (out[t]) { out[t].normal += num(p?.normal); out[t].shiny += num(p?.shiny); }
      }
    }
  }
  return out;
}

// ---------- snapshot delta (chat TP / chat CC estimate) ----------
let delta = null;
if (prevPath) {
  const prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
  const prevSupply = Object.values(prev).reduce((t, u) => t + num(u?.cc), 0);
  let tpGain = 0;
  const tpGains = [];
  for (const [k, u] of users) {
    const g = num(u.tp) - num(prev[k]?.tp);
    if (g > 0) { tpGain += g; tpGains.push(g); }
  }
  const prevMtime = fs.statSync(prevPath).mtimeMs;
  const curMtime = fs.statSync(dataPath).mtimeMs;
  delta = { prevSupply, supply, change: supply - prevSupply, spanHours: round((curMtime - prevMtime) / 3_600_000, 0.1), prevMtime: new Date(prevMtime).toISOString(), curMtime: new Date(curMtime).toISOString(), tpGainTotal: tpGain, tpGainPerPlayer: coarse(pct(tpGains), 50), newPlayers: users.filter(([k]) => !prev[k]).length };
}

// ---------- events ----------
const since = now - DAYS * DAY;
const flows = {}; // type -> { n, ccIn, ccOut, ... }
const add = (key, field, v = 1) => { (flows[key] ??= { n: 0 }); flows[key][field] = (flows[key][field] ?? 0) + v; };
const actors = {}; // type -> Set (count only)
const perActorCC = new Map(); // internal only: summed to percentiles, never printed
const catchTiers = { daily: {}, weekly: {}, roll: {}, chat: {} };
const shiny = { daily: [0, 0], roll: [0, 0], weekly: [0, 0] };
const ballCounts = {};
const battleModes = {};
const wagerStakes = [];
const challengeByKey = {};
let firstEvent = Infinity, lastEvent = 0, linesRead = 0, linesBad = 0;
const allTypes = {};

const rl = readline.createInterface({ input: fs.createReadStream(eventsPath, "utf8"), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  linesRead++;
  let ev;
  try { ev = JSON.parse(line); } catch { linesBad++; continue; }
  const t = tsOf(ev.timestamp);
  allTypes[ev.type] = (allTypes[ev.type] ?? 0) + 1;
  if (t < since) continue;
  firstEvent = Math.min(firstEvent, t);
  lastEvent = Math.max(lastEvent, t);
  const d = ev.data ?? {};
  const type = ev.type;
  (actors[type] ??= new Set()).add(ev.userId);
  add(type, "n");
  const ccDelta = (v) => perActorCC.set(ev.userId, (perActorCC.get(ev.userId) ?? 0) + v);
  switch (type) {
    case "daily_claim":
      add(type, "ccIn", num(d.ccAwarded)); ccDelta(num(d.ccAwarded));
      add(type, "stones", d.stoneAwarded ? 1 : 0);
      add(type, "megaShards", num(d.megaShardsAwarded));
      for (const p of d.pokemon ?? []) { const tr = String(p.tier ?? "?").toLowerCase(); catchTiers.daily[tr] = (catchTiers.daily[tr] ?? 0) + 1; shiny.daily[0]++; if (p.shiny) shiny.daily[1]++; }
      break;
    case "weekly_claim":
      for (const p of d.rewards ?? []) { const tr = String(p.tier ?? "?").toLowerCase(); catchTiers.weekly[tr] = (catchTiers.weekly[tr] ?? 0) + 1; shiny.weekly[0]++; if (p.shiny) shiny.weekly[1]++; }
      break;
    case "roll": {
      add(type, "ccOut", num(d.cost)); ccDelta(-num(d.cost));
      ballCounts[d.ball] = (ballCounts[d.ball] ?? 0) + 1;
      const tr = String(d.tier ?? "?").toLowerCase();
      catchTiers.roll[`${d.ball}:${tr}`] = (catchTiers.roll[`${d.ball}:${tr}`] ?? 0) + 1;
      shiny.roll[0]++; if (d.shiny) shiny.roll[1]++;
      break;
    }
    case "recruit": add(type, "ccOut", num(d.ccSpent)); ccDelta(-num(d.ccSpent)); break;
    case "quest_claim": add(type, "ccIn", num(d.ccAwarded)); ccDelta(num(d.ccAwarded)); break;
    case "donate":
      add(type, "ccIn", num(d.ccGained)); ccDelta(num(d.ccGained));
      add(type, "dust", num(d.dustGained));
      add(type, d.variant === "shiny" ? "shinyCopies" : "normalCopies");
      add(type, `tier_${String(d.tier ?? "?").toLowerCase()}`);
      break;
    case "stone_purchase": add(type, "ccOut", num(d.cost)); ccDelta(-num(d.cost)); break;
    case "tm_purchase": add(type, "ccOut", num(d.cost)); add(type, "qty", num(d.qty)); ccDelta(-num(d.cost)); break;
    case "aura_purchase": add(type, "ccOut", num(d.cost)); ccDelta(-num(d.cost)); break;
    case "held_item_purchase": add(type, "ccOut", num(d.cost)); ccDelta(-num(d.cost)); break;
    case "evolve": add(type, "stonesSpent", num(d.stoneCost)); add(type, "dustSpent", num(d.dustCost)); break;
    case "convert": add(type, "dustSpent", num(d.dustCost)); break;
    case "challenge": {
      add(type, "ccOut", num(d.ccLost)); ccDelta(-num(d.ccLost));
      const k = d.key ?? "?";
      const c = (challengeByKey[k] ??= { runs: 0, clears: 0, firstWins: 0, ccLost: 0 });
      c.runs++; if (d.cleared) c.clears++; c.ccLost += num(d.ccLost);
      if (d.prize) {
        c.firstWins++;
        const [cc, st, du] = CHALLENGE_PRIZE[k] ?? [0, 0, 0];
        add(type, "firstWinCcBase", cc); ccDelta(cc);
        add(type, "firstWinStones", st);
        add(type, "firstWinDust", du);
      }
      break;
    }
    case "battle":
      battleModes[d.mode ?? "?"] = (battleModes[d.mode ?? "?"] ?? 0) + 1;
      if (d.mode === "wager") wagerStakes.push(num(d.stake));
      break;
    case "encounter":
      if (d.phase === "result") {
        add(type, "results");
        if (d.won) { add(type, "wins"); add(type, "ccIn", num(d.prize)); ccDelta(num(d.prize)); }
        else { add(type, "ccOut", num(d.paid)); ccDelta(-num(d.paid)); }
      } else if (d.phase) add(type, `phase_${d.phase}`);
      break;
    default: break;
  }
}

const spanDays = lastEvent > firstEvent ? (lastEvent - firstEvent) / DAY : DAYS;
for (const [k, s] of Object.entries(actors)) flows[k].players = s.size;
const loggedIn = Object.values(flows).reduce((t, f) => t + (f.ccIn ?? 0) + (f.firstWinCcBase ?? 0), 0);
const loggedOut = Object.values(flows).reduce((t, f) => t + (f.ccOut ?? 0), 0);

const out = {
  generatedAt: new Date(now).toISOString(),
  windowDays: DAYS,
  eventSpanDays: round(spanDays, 0.01),
  eventLines: { read: linesRead, unparsable: linesBad },
  eventTypesAllTime: allTypes,
  population: { records: users.length, active1d: active1.size, active7d: active7.size, active30d: active30.size },
  supply,
  holdings: { active7d: holdings(active7), all: holdings(new Set(users.map(([k]) => k))) },
  ownedCopiesByTier: { active7d: ownedByTier(active7) },
  flows,
  loggedCc: { in: loggedIn, out: loggedOut, net: loggedIn - loggedOut, perDay: round((loggedIn - loggedOut) / spanDays, 1) },
  perActorLoggedNetCc: coarse(pct([...perActorCC.values()]), 5000),
  challengeByKey,
  catchTiers,
  shinyObserved: Object.fromEntries(Object.entries(shiny).map(([k, [n, s]]) => [k, { rolls: n, shiny: s }])),
  ballCounts,
  battleModes,
  wagerStakes: pct(wagerStakes),
  snapshotDelta: delta,
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
