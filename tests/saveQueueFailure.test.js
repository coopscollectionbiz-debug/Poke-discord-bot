// ==========================================================
// tests/saveQueueFailure.test.js
// A failed trainerData write must never leave callers (and so their
// per-user lock) hanging, and the save must be retried until it lands.
// ==========================================================

import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

// saveQueue writes to TRAINERDATA_DIR; give it a private temp dir.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "savequeue-fail-"));
process.env.TRAINERDATA_DIR = dir;
process.on("exit", () => {
  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
});

// A DIRECTORY where the temp file goes makes writeFile fail (like ENOSPC/EIO).
const tmpPath = path.join(dir, "trainerData.json.tmp");
await fs.mkdir(tmpPath);

const { enqueueSave } = await import("../utils/saveQueue.js");
const { lockUser } = await import("../utils/userLocks.js");

const quiet = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = () => {};
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("TIMEOUT"), ms))]);

const data = { u1: { cc: 1 } };
const state = { firstResult: undefined, secondRan: false };

const first = lockUser("u1", async () => { state.firstResult = await enqueueSave(data); });
const second = lockUser("u1", async () => { state.secondRan = true; });
const settled = await within(Promise.all([first, second]), 8000);

// Let the disk recover, then the retry should write the file.
await fs.rmdir(tmpPath);
data.u1.cc = 2;
const retryResult = await within(enqueueSave(data), 40000);
const onDisk = JSON.parse(await fs.readFile(path.join(dir, "trainerData.json"), "utf8"));

Object.assign(console, quiet);

section("Save failure");
assertTrue(settled !== "TIMEOUT", "a failed write releases the user's lock instead of hanging");
assertEqual(state.firstResult, false, "the waiting caller is told the write failed");
assertTrue(state.secondRan, "the next locked operation for that user still runs");

section("Retry after failure");
assertEqual(retryResult, true, "a later save succeeds once the disk recovers");
assertEqual(onDisk.u1.cc, 2, "the latest in-memory data reaches disk");

await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
