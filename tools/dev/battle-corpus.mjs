// ==========================================================
// tools/dev/battle-corpus.mjs — deterministic no-Mega battle corpus.
//
// Builds N random battles (random species incl. Shedinja, multi-hit,
// recoil, crash and drain users; random Levels; open and wager modes;
// underdog surges) and runs each through runBattle() of the engine found
// under `root`. Returns one digest per battle covering the battle ENGINE's
// output (winner, turns, end reason, log, knockouts, HP snapshots, surge,
// power, fighters, EXP) and the EXP actually applied (training).
//
// Version 2 (ranked battles): every case runs as an open (casual) battle,
// whose engine path is the same in every version: Display teams at real
// Levels with the Underdog surge. Ratings, records and wager pots are left
// out on purpose: open battles became unrated and wagers became Lv 50
// Battle-team battles (owner decision), which tests/runBattle.test.js covers.
//
//   node tools/dev/battle-corpus.mjs <engineRoot> <count> <out.json> [envJSON]
//
// Used to prove that ordinary battles are unchanged by Mega Evolution:
// tests/megaBattleRegression.test.js compares the current engine with the
// pre-M2 digests in tests/fixtures/battle-corpus-pre-m2.json.
// ==========================================================

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export const CORPUS_VERSION = 2;
const FEATURED = [292, 6, 9, 3, 25, 143, 286, 106, 237, 398, 389, 409, 94, 150, 248, 445, 448, 130, 212, 214, 373, 376, 384, 493, 649, 650, 1025, 980, 999];

function rng32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The deterministic list of battle setups (independent of the engine). */
export function corpusCases(count, seed = 20261110) {
  const r = rng32(seed);
  const pick = (n) => Math.floor(r() * n);
  const cases = [];
  for (let i = 0; i < count; i++) {
    const team = () => Array.from({ length: 1 + pick(6) }, () => {
      const id = r() < 0.25 ? FEATURED[pick(FEATURED.length)] : 1 + pick(1025);
      const variant = r() < 0.15 ? "shiny" : "normal";
      const level = r() < 0.1 ? 100 : 1 + pick(100);
      return { id, variant, level };
    });
    cases.push({ a: team(), b: team(), mode: r() < 0.3 ? "wager" : "open", stake: 1 + pick(500), seed: pick(2 ** 31 - 1) });
  }
  return cases;
}

const expForLevel = (l) => (l <= 1 ? 0 : l ** 3);

function makeUser(id, team, createNewUser) {
  const u = createNewUser(id, `Corpus ${id}`);
  u.cc = 1000;
  const seen = new Set();
  for (const m of team) {
    const k = `${m.id}:${m.variant}`;
    u.pokemon[m.id] ??= { normal: 0, shiny: 0 };
    u.pokemon[m.id][m.variant] += 1;
    if (!seen.has(k)) {
      u.training = u.training ?? {};
      u.training[k] = { exp: expForLevel(m.level) };
      seen.add(k);
    }
  }
  u.displayedPokemon = team.map((m) => ({ id: m.id, variant: m.variant }));
  return u;
}

const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");

export async function buildCorpus(root, count, { env = {} } = {}) {
  const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  Object.assign(process.env, env);
  const { runBattle } = await imp("utils/battle/runBattle.js");
  const { createNewUser } = await imp("utils/userSchema.js");
  const now = new Date(Date.UTC(2026, 10, 10, 12));
  const out = [];
  for (const [i, c] of corpusCases(count).entries()) {
    const td = { A: makeUser("A", c.a, createNewUser), B: makeUser("B", c.b, createNewUser) };
    const res = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", stake: 0, seed: c.seed, now });
    const result = res.ok ? { winnerId: res.winnerId, turns: res.result.turns, endedBy: res.result.endedBy, log: res.result.log, knockouts: res.result.knockouts, snapshots: res.result.snapshots, surge: res.surge, powers: res.sides.map((s) => s.power), members: res.sides.map((s) => s.members), exp: res.exp } : { refused: res.reason };
    const users = ["A", "B"].map((k) => ({ training: td[k].training }));
    out.push({ i, winner: res.winnerId ?? null, turns: res.result?.turns ?? null, result: sha(result), users: sha(users) });
  }
  return out;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [root, count, file, envJson] = process.argv.slice(2);
  const env = envJson ? JSON.parse(envJson) : {};
  const t0 = performance.now();
  const corpus = await buildCorpus(path.resolve(root), Number(count), { env });
  const ms = performance.now() - t0;
  fs.writeFileSync(file, JSON.stringify({ version: CORPUS_VERSION, count: corpus.length, engine: path.basename(path.resolve(root)), digests: corpus }) + "\n");
  console.log(`corpus ${corpus.length} battles in ${ms.toFixed(0)} ms → ${file}`);
}
