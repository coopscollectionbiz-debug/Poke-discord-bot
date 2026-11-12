// ==========================================================
// tools/measure-fight-record.js — how big Fight records are.
//
//   node tools/measure-fight-record.js [players]
//
// Builds real records (tools/fight-record-fixtures.mjs), prints the
// JSON bytes per kind (median and max), and the store size if
// `players` players each held the full 50 per group (default 100).
// Then writes a store of that size to a temp dir and times one
// player's list and the API's lite list. Nothing touches real data.
// ==========================================================

import os from "os";
import fs from "fs/promises";
import path from "path";
import { fixtureRecords } from "./fight-record-fixtures.mjs";
import { createFightStore, KEEP_PER_GROUP } from "../utils/fightRecords.js";
import { liteRecord } from "../services/fightRecordsApi.js";

const players = Number(process.argv[2] ?? 100);
const { me, records } = fixtureRecords({ days: 30 });

const bytes = (r) => Buffer.byteLength(JSON.stringify(r));
const byKind = new Map();
for (const r of records) (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)).push(bytes(r));
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log(`Fight record size (${records.length} real records):`);
for (const [kind, xs] of byKind) console.log(`  ${kind.padEnd(10)} n=${String(xs.length).padStart(3)}  median ${kb(med(xs)).padStart(9)}  max ${kb(Math.max(...xs)).padStart(9)}`);
const group = (g) => records.filter((r) => r.group === g).map(bytes);
const perPlayer = ["battles", "challenges", "encounters"].reduce((t, g) => t + (med(group(g)) ?? 0) * KEEP_PER_GROUP, 0);
console.log(`\nOne player at the cap (${KEEP_PER_GROUP} per group, medians): ${kb(perPlayer)}`);
console.log(`${players} players at the cap: ${(perPlayer * players / 1024 / 1024).toFixed(1)} MB (Battles shared by two players are stored once, so this is an upper bound)`);

// Timing: one player's full history read back through the store.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fight-measure-"));
const store = createFightStore({ dir: () => dir });
const mine = [...records.filter((r) => r.group === "battles").slice(-KEEP_PER_GROUP), ...records.filter((r) => r.group === "challenges").slice(-KEEP_PER_GROUP), ...records.filter((r) => r.group === "encounters").slice(-KEEP_PER_GROUP)];
for (const r of mine) await store.add(r);
const t0 = performance.now();
const list = await store.list(me);
const t1 = performance.now();
const payload = Buffer.byteLength(JSON.stringify({ records: list.map(liteRecord) }));
console.log(`\nList for one player with ${list.length} records: ${(t1 - t0).toFixed(1)} ms read, lite payload ${kb(payload)} (full would be ${kb(Buffer.byteLength(JSON.stringify(list)))})`);
await fs.rm(dir, { recursive: true, force: true });
