// ==========================================================
// tests/playerDataGuard.test.js
// Player data must never be committed or baked into a Docker image (D-24).
//  • No tracked JSON file may contain a map keyed by Discord user IDs.
//  • .dockerignore must exclude backups, trainerData snapshots and event
//    logs, while keeping the app's own code and catalogs.
// ==========================================================

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_ID_KEYS = 10;

/** Number of Discord-ID-shaped keys at the top level or one level down. */
export function idKeyCount(value) {
  if (!value || typeof value !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (SNOWFLAKE.test(k)) n++;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      n += Object.keys(v).filter((x) => SNOWFLAKE.test(x)).length;
    }
  }
  return n;
}

// Minimal .dockerignore matcher: *, ?, **/ and directory prefixes; "!" re-includes.
function compile(pattern) {
  let p = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += p[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += p[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}
export function dockerIgnored(file, rules) {
  let ignored = false;
  for (const { neg, re } of rules) if (re.test(file)) ignored = !neg;
  return ignored;
}
const rules = fs
  .readFileSync(path.join(root, ".dockerignore"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => ({ neg: l.startsWith("!"), re: compile(l.replace(/^!/, "")) }));

section("Detector");
const fakeIds = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(100000000000000000n + BigInt(i)), { cc: 1 }]));
assertTrue(idKeyCount(fakeIds) >= MAX_ID_KEYS, "a user map keyed by Discord IDs is detected");
assertTrue(idKeyCount({ users: fakeIds }) >= MAX_ID_KEYS, "a wrapped user map is detected");
assertEqual(idKeyCount({ "25": { name: "Pikachu" } }), 0, "a Pokédex keyed by small ids is not");

section("Tracked files");
// Only data-like files matter here (the repo also tracks thousands of sprites).
const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.json", "*.ndjson", "*.bundle"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}).split("\0").filter(Boolean);
const offenders = [];
for (const f of tracked) {
  if (!/\.(json|ndjson)$/i.test(f)) continue;
  let text;
  try { text = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
  const lines = f.endsWith(".ndjson") ? text.split(/\r?\n/).filter(Boolean) : [text];
  let n = 0;
  for (const line of lines) {
    try { n += idKeyCount(JSON.parse(line)); } catch {}
  }
  if (n >= MAX_ID_KEYS) offenders.push(`${f} (${n} ID keys)`);
}
assertEqual(offenders, [], "no tracked JSON holds Discord-ID-keyed player data");
assertTrue(!tracked.includes("oldTrainerBackup.json"), "oldTrainerBackup.json is not tracked");
assertTrue(!fs.existsSync(path.join(root, "commands", "restoretrainers.js")), "/restoretrainers is retired");

section(".dockerignore");
for (const f of [
  "oldTrainerBackup.json",
  "backup_trainerData.json",
  "trainerData.json",
  "trainerData.prev.json",
  "trainerData_backup1.json",
  "data/trainerData.json",
  "events.ndjson",
  "snapshots/trainerData-2026-01-01.json",
  "pre-rewrite.bundle",
  ".env",
]) {
  assertTrue(dockerIgnored(f, rules), `excluded from the image: ${f}`);
}
for (const f of ["bot_final.js", "utils/trainerDataHelper.js", "persistence/discordBackups.js", "pokemonData.json", "trainerSprites.json", "battleData.json", "package.json"]) {
  assertTrue(!dockerIgnored(f, rules), `kept in the image: ${f}`);
}
const shipped = tracked.filter((f) => !dockerIgnored(f, rules));
assertEqual(shipped.filter((f) => /backup.*\.json$|trainerData.*\.json$|\.ndjson$/i.test(f)), [], "no tracked backup or data file reaches the build context");

finish();
