// ==========================================================
// tests/megaBattleRegression.test.js — the M2 acceptance gate: ordinary
// battles are unchanged. 3,000 deterministic battles without Megas
// (tools/dev/battle-corpus.mjs) must reproduce the digests recorded with the
// pre-M2 engine (M1 commit 880ba6c8) exactly: winner, turns, end reason,
// full log, knockouts, HP snapshots, surge, power, EXP, Elo, and both
// players' post-battle records — with Mega flags off AND fully on.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { buildCorpus } from "../tools/dev/battle-corpus.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/battle-corpus-pre-m2.json", import.meta.url), "utf8"));

function compare(current) {
  const diffs = [];
  for (let i = 0; i < golden.digests.length; i++) {
    const g = golden.digests[i], c = current[i];
    if (!c || g.result !== c.result || g.users !== c.users) diffs.push(i);
  }
  return diffs;
}

section("Golden corpus");
assertEqual([golden.version, golden.count, golden.engine], [1, 3000, "Poke-discord-bot-mega-m1"], "3,000 digests recorded with the pre-M2 engine (M1 worktree, commit 880ba6c8)");
assertTrue(golden.digests.some((d) => d.turns === 300) && new Set(golden.digests.map((d) => d.winner)).size === 2, "the corpus includes a turn-cap battle and wins for both sides");

section("Mega Evolution switched off (production default)");
const off = await buildCorpus(ROOT, 3000, { env: {} });
const offDiffs = compare(off);
assertEqual(offDiffs.slice(0, 10), [], `all 3,000 ordinary battles identical to the pre-M2 engine (${offDiffs.length} differences)`);

section("Every Mega switch on, teams without Megas");
const quiet = console.warn;
console.warn = () => {};
const on = await buildCorpus(ROOT, 3000, { env: { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1", MEGA_FORMS: "all" } });
console.warn = quiet;
for (const k of ["MEGA_EVOLUTION_ENABLED", "MEGA_BATTLES_ENABLED", "MEGA_FORMS"]) delete process.env[k];
const onDiffs = compare(on);
assertEqual(onDiffs.slice(0, 10), [], `all 3,000 ordinary battles identical with Mega battles enabled (${onDiffs.length} differences)`);

finish();
