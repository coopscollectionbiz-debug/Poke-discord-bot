// ==========================================================
// tests/testRunnerGuard.test.js
// run-tests.js must refuse to run unless TRAINERDATA_DIR is a writable
// folder outside the repository, so tests can never write real data files.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveTestDataDir, isInside } from "../run-tests.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "runner-guard-"));

section("Path containment");
assertTrue(isInside(repoRoot, repoRoot), "the repo root counts as inside");
assertTrue(isInside(repoRoot, path.join(repoRoot, "tests", "x")), "a subfolder counts as inside");
assertTrue(!isInside(repoRoot, scratch), "a temp folder is outside");
assertTrue(!isInside(repoRoot, repoRoot + "-other"), "a sibling folder with the same prefix is outside");

section("Decisions");
const unset = await resolveTestDataDir({ env: {}, argv: [], repoRoot });
assertEqual(unset.ok, false, "unset TRAINERDATA_DIR is refused");

const inRepo = await resolveTestDataDir({ env: { TRAINERDATA_DIR: repoRoot }, argv: [], repoRoot });
assertEqual(inRepo.ok, false, "the repo itself is refused");

const inSub = await resolveTestDataDir({ env: { TRAINERDATA_DIR: path.join(repoRoot, "tmp") }, argv: [], repoRoot });
assertEqual(inSub.ok, false, "a folder inside the repo is refused");

const missing = await resolveTestDataDir({ env: { TRAINERDATA_DIR: path.join(scratch, "nope") }, argv: [], repoRoot });
assertEqual(missing.ok, false, "a missing folder is refused");

const good = await resolveTestDataDir({ env: { TRAINERDATA_DIR: scratch }, argv: [], repoRoot });
assertEqual(good.ok, true, "an existing folder outside the repo is accepted");

const made = await resolveTestDataDir({ env: {}, argv: ["--make-temp"], repoRoot });
assertTrue(made.ok && made.created && !isInside(repoRoot, made.dir), "--make-temp creates a folder outside the repo");
if (made.ok) await fs.rm(made.dir, { recursive: true, force: true });

section("Runner refuses before running anything");
const env = { ...process.env };
delete env.TRAINERDATA_DIR;
const run = spawnSync(process.execPath, [path.join(repoRoot, "run-tests.js")], { cwd: repoRoot, env, encoding: "utf8" });
assertEqual(run.status, 2, "npm test without TRAINERDATA_DIR exits with code 2");
assertTrue(/Refusing to run tests/.test(run.stderr) && !/Running:/.test(run.stdout), "no test file is started");

await fs.rm(scratch, { recursive: true, force: true });
finish();
