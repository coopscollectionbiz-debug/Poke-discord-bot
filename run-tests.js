// ==========================================================
// run-tests.js
// Test runner for Coop's Collection Discord Bot
//
// Isolation guard: tests write trainerData snapshots and event logs to
// TRAINERDATA_DIR (default "." = the repo). The runner refuses to start
// unless TRAINERDATA_DIR points at an existing, writable directory
// OUTSIDE this repository, so a test run can never touch real data files.
//
//   npm test                 → needs TRAINERDATA_DIR set
//   npm run test:safe        → creates a fresh temp dir for you
//
// Each test file gets its own subdirectory (TRAINERDATA_DIR/<name>), and
// Discord/production secrets are removed from the child environment.
// ==========================================================

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, resolve, relative, isAbsolute, basename } from "path";
import os from "os";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Never hand these to a test process.
const STRIPPED_ENV = [
  "BOT_TOKEN",
  "DISCORD_TOKEN",
  "STORAGE_CHANNEL_ID",
  "REWARD_CHANNEL_ID",
  "RARE_SIGHTINGS_CHANNEL_ID",
  "REGISTER_COMMANDS",
  "FLY_API_TOKEN",
  "RESTORE_FROM",
  "CONFIRM_RESTORE",
  "BATTLE_FRAME_OUT",
  // Tests decide their own generation settings (config/generations.js).
  "POKEMON_GENERATIONS",
  // ...and their own Mega Evolution flags (config/features.js).
  "MEGA_EVOLUTION_ENABLED",
  "MEGA_FORMS",
  "PUBLIC_URL",
];

/** True if `child` is `parent` or inside it (case-insensitive on Windows). */
export function isInside(parent, child) {
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  const rel = relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Decide the base data directory for a test run, or explain why not.
 * @returns {Promise<{ok:true, dir:string, created:boolean} | {ok:false, reason:string}>}
 */
export async function resolveTestDataDir({ env = process.env, argv = process.argv, repoRoot = __dirname } = {}) {
  const makeTemp = argv.includes("--make-temp");
  let dir = env.TRAINERDATA_DIR;
  let created = false;

  if (!dir) {
    if (!makeTemp) {
      return {
        ok: false,
        reason:
          "TRAINERDATA_DIR is not set. Tests would write data files into the repository.\n" +
          "  Use `npm run test:safe` (creates a temp dir), or set TRAINERDATA_DIR to an empty folder outside the repo.",
      };
    }
    dir = await fs.mkdtemp(join(os.tmpdir(), "poke-test-"));
    created = true;
  }

  dir = resolve(dir);
  if (isInside(repoRoot, dir)) {
    return { ok: false, reason: `TRAINERDATA_DIR (${dir}) is inside the repository (${repoRoot}). Use a folder outside it.` };
  }
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) return { ok: false, reason: `TRAINERDATA_DIR (${dir}) is not a directory.` };
    await fs.access(dir, fs.constants.W_OK);
  } catch (e) {
    return { ok: false, reason: `TRAINERDATA_DIR (${dir}) is missing or not writable (${e.code || e.message}).` };
  }
  return { ok: true, dir, created };
}

function childEnv(baseEnv, dataDir) {
  const env = { ...baseEnv, TRAINERDATA_DIR: dataDir };
  for (const k of STRIPPED_ENV) delete env[k];
  return env;
}

async function runTestFile(testFile, baseDir) {
  const dataDir = join(baseDir, basename(testFile, ".test.js"));
  await fs.mkdir(dataDir, { recursive: true });

  return new Promise((resolvePromise, reject) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${testFile}`);
    console.log("=".repeat(60));

    const child = spawn("node", [testFile], {
      cwd: __dirname,
      stdio: "inherit",
      env: childEnv(process.env, dataDir),
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(testFile);
      } else {
        reject(new Error(`${testFile} failed with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function findTestFiles() {
  const testsDir = join(__dirname, "tests");
  try {
    const files = await fs.readdir(testsDir);
    return files
      .filter(f => f.endsWith(".test.js"))
      .map(f => join(testsDir, f));
  } catch (err) {
    console.warn("No tests directory found or error reading tests:", err.message);
    return [];
  }
}

async function main() {
  console.log("🧪 Coop's Collection Bot - Test Runner\n");

  const target = await resolveTestDataDir();
  if (!target.ok) {
    console.error(`⛔ Refusing to run tests: ${target.reason}`);
    process.exit(2);
  }
  console.log(`📁 Test data dir: ${target.dir}${target.created ? " (created)" : ""}\n`);

  const testFiles = await findTestFiles();

  if (testFiles.length === 0) {
    console.log("⚠️  No test files found in tests/ directory");
    process.exit(0);
  }

  console.log(`Found ${testFiles.length} test file(s):\n`);
  testFiles.forEach(f => console.log(`  - ${f}`));

  const results = {
    passed: [],
    failed: []
  };

  for (const testFile of testFiles) {
    try {
      await runTestFile(testFile, target.dir);
      results.passed.push(testFile);
    } catch (err) {
      console.error(`\n❌ ${testFile} failed:`, err.message);
      results.failed.push(testFile);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 Test Summary");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`📝 Total:  ${testFiles.length}\n`);

  if (results.failed.length > 0) {
    console.log("Failed tests:");
    results.failed.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("✅ All tests passed!\n");
    process.exit(0);
  }
}

// Only run when executed directly (tests import resolveTestDataDir/isInside).
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
