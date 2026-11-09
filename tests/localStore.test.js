// ==========================================================
// tests/localStore.test.js — durable local snapshots in a temp dir,
// including the states a crash can leave behind.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "localstore-"));
process.env.TRAINERDATA_DIR = dir;
const store = await import("../persistence/localStore.js");
const p = store.paths();
const warn = console.warn;
console.warn = () => {};

const day = (d) => Date.parse(`2026-11-${String(d).padStart(2, "0")}T12:00:00Z`);

section("Writes");
const m1 = await store.writeSnapshot({ a: { cc: 1 } }, { now: day(1) });
const m2 = await store.writeSnapshot({ a: { cc: 2 }, b: { cc: 0 } }, { now: day(1) + 1000 });
assertEqual([m1.seq, m2.seq], [1, 2], "seq increases with every write");
let [cur, prev] = await store.readLocalCandidates();
assertTrue(cur.ok && cur.metaTrusted && cur.seq === 2 && cur.userCount === 2, "current file + matching metadata");
assertTrue(prev.ok && prev.metaTrusted && prev.seq === 1 && prev.data.a.cc === 1, "previous generation kept with its metadata");
assertEqual(JSON.parse(await fs.readFile(p.current, "utf8")).a.cc, 2, "user-map format unchanged on disk");
const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"));
assertEqual(leftovers, [], "no temp files left behind");

section("Crash states");
// a) crash between "current -> prev" and "tmp -> current": no current file
await fs.rename(p.current, path.join(dir, "hold.json"));
[cur, prev] = await store.readLocalCandidates();
assertTrue(!cur.ok && cur.reason === "missing" && prev.ok, "missing current: previous is still valid");
await fs.rename(path.join(dir, "hold.json"), p.current);

// b) crash after data rename, before meta write: meta describes old data
await fs.writeFile(p.current, JSON.stringify({ a: { cc: 3 }, b: {}, c: {} }, null, 2));
[cur] = await store.readLocalCandidates();
assertTrue(cur.ok && !cur.metaTrusted && cur.seq === null && cur.userCount === 3,
  "stale metadata detected: data still loads, ordered by file time");

// c) torn/corrupt current file
await fs.writeFile(p.current, '{"a": {"cc": 4}, "b":');
[cur, prev] = await store.readLocalCandidates();
assertTrue(!cur.ok && /invalid JSON/.test(cur.reason) && prev.ok, "corrupt current is rejected; previous remains");

// d) the next successful write repairs everything
const m3 = await store.writeSnapshot({ a: { cc: 5 } }, { now: day(1) + 2000 });
[cur] = await store.readLocalCandidates();
assertTrue(cur.ok && cur.metaTrusted && cur.seq === m3.seq, "a later write produces a clean, trusted snapshot");

section("Sequence carry-over");
store.setSeqAtLeast(100);
assertEqual(store.nextSeq(), 101, "continues above a loaded snapshot's seq");
store.setSeqAtLeast(5);
assertEqual(store.getSeq(), 101, "never goes backwards");

section("Daily snapshots");
for (let d = 2; d <= 10; d++) await store.writeSnapshot({ a: { day: d } }, { now: day(d) });
const files = (await fs.readdir(p.snapshots)).filter((f) => /^trainerData-.*\d\.json$/.test(f)).sort();
assertEqual(files.length, 7, "only the last 7 days are kept");
assertEqual(files[0], "trainerData-2026-11-04.json", "oldest kept is 7 days back");
const snap = await store.readFileCandidate(path.join(p.snapshots, "trainerData-2026-11-10.json"),
  path.join(p.snapshots, "trainerData-2026-11-10.meta.json"));
assertTrue(snap.ok && snap.metaTrusted && snap.data.a.day === 10, "a daily snapshot is a valid, restorable candidate");

section("Write failure");
await fs.rm(p.current, { force: true });
await fs.mkdir(p.tmp); // a directory where the temp file goes
let threw = false;
try { await store.writeSnapshot({ a: {} }); } catch { threw = true; }
assertTrue(threw, "a failed write throws (the save queue retries it)");
[cur, prev] = await store.readLocalCandidates();
assertTrue(prev.ok, "previous snapshot untouched by the failed write");

console.warn = warn;
await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
