// ==========================================================
// tests/megaBattleRegression.test.js — the M2 acceptance gate: ordinary
// battles are unchanged. 3,000 deterministic battles without Megas
// (tools/dev/battle-corpus.mjs) must reproduce the digests recorded with the
// pre-M2 engine (M1 commit 880ba6c8) exactly: winner, turns, end reason,
// full log, knockouts, HP snapshots, surge, power, fighters, EXP and the
// EXP applied — with Mega flags off AND fully on. (Corpus v2, re-recorded
// from 880ba6c8 for ranked battles: open-battle engine output only; ratings
// and wagers changed by design and are covered in tests/runBattle.test.js.)
// The cute surge (2026-11-11) changes casual battles with a cute Team by
// design (tests/cuteness.test.js), so only battles where neither Team
// averages over CUTE.threshold must match exactly. Every other battle in the
// corpus is still held to the recording.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { buildCorpus, corpusCases } from "../tools/dev/battle-corpus.mjs";
import { teamCuteness } from "../utils/battle/cuteness.js";
import { CUTE } from "../utils/battle/tuning.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/battle-corpus-pre-m2.json", import.meta.url), "utf8"));

// A corpus Team as it fights: repeated species + variant slots count once, at most 6 (utils/teamNormalize.js).
const fighting = (team) => [...new Map(team.map((m) => [`${m.id}:${m.variant}`, { speciesId: m.id }])).values()].slice(0, 6);
const cute = new Set(corpusCases(golden.count).flatMap((c, i) => ([c.a, c.b].some((t) => teamCuteness(fighting(t)) > CUTE.threshold) ? [i] : [])));

function compare(current) {
  const diffs = [];
  for (let i = 0; i < golden.digests.length; i++) {
    const g = golden.digests[i], c = current[i];
    if (!c || g.result !== c.result || g.users !== c.users) diffs.push(i);
  }
  return diffs.filter((i) => !cute.has(i));
}

section("Golden corpus");
assertEqual([golden.version, golden.count, golden.engine], [2, 3000, "Poke-discord-bot-mega-m1"], "3,000 digests recorded with the pre-M2 engine (M1 worktree, commit 880ba6c8)");
assertTrue(golden.digests.some((d) => d.turns === 300) && new Set(golden.digests.map((d) => d.winner)).size === 2, "the corpus includes a turn-cap battle and wins for both sides");

section("Mega Evolution switched off (production default)");
const off = await buildCorpus(ROOT, 3000, { env: {} });
const offDiffs = compare(off);
assertTrue(cute.size > 0 && cute.size < 600, `${cute.size} of 3,000 battles have a cute Team and may change`);
assertEqual(offDiffs.slice(0, 10), [], `the other ${3000 - cute.size} battles identical to the pre-M2 engine (${offDiffs.length} differences)`);

section("Every Mega switch on, teams without Megas");
const quiet = console.warn;
console.warn = () => {};
const on = await buildCorpus(ROOT, 3000, { env: { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1", MEGA_FORMS: "all" } });
console.warn = quiet;
for (const k of ["MEGA_EVOLUTION_ENABLED", "MEGA_BATTLES_ENABLED", "MEGA_FORMS"]) delete process.env[k];
const onDiffs = compare(on);
assertEqual(onDiffs.slice(0, 10), [], `the other ${3000 - cute.size} battles identical with Mega battles enabled (${onDiffs.length} differences)`);

finish();
