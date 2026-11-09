// ==========================================================
// tests/persistenceRestart.test.js
// Simulated process lifetimes with the real save queue, local store,
// loader and Discord upload code (fake channel, temp TRAINERDATA_DIR).
// Invariant: a restart never loads data older than the newest durable copy.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "restart-"));
process.env.TRAINERDATA_DIR = dir;

const q = await import("../utils/saveQueue.js");
const store = await import("../persistence/localStore.js");
const { loadBestSnapshot } = await import("../persistence/loader.js");
const { uploadBackup } = await import("../persistence/discordBackups.js");
const { validateSnapshot, parseBackupMessage } = await import("../persistence/snapshot.js");

const quiet = { log: console.log, warn: console.warn, error: console.error };
console.log = (m, ...r) => { if (!/^(💾|⏳)/.test(String(m))) quiet.log(m, ...r); };
console.warn = (m, ...r) => { if (!/^(⚠️|⏳)/.test(String(m))) quiet.warn(m, ...r); };
console.error = (m, ...r) => { if (!/^❌ Save error/.test(String(m))) quiet.error(m, ...r); };

// ---- fake Discord storage channel ----
const discord = []; // { content, text, ts }
const channel = { send: async ({ content, files }) => { discord.push({ content, text: Buffer.from(files[0].attachment).toString("utf8"), ts: Date.now() }); } };
const discordCandidates = async () =>
  discord.slice(-3).reverse().map((m, i) => validateSnapshot({ source: "discord", id: `d${i}`, text: m.text, meta: parseBackupMessage(m.content), fallbackTime: m.ts }));

// ---- one "process lifetime" ----
async function boot() {
  q.__resetSaveQueueForTests();
  store.__resetLocalStoreForTests(); // a new process starts counting from 0
  q.__setSaveQueueTestHooks({ timing: { debounceMs: 5, minIntervalMs: 0, maxWaitMs: 50, retryBaseMs: 20, retryMaxMs: 40 } });
  q.requireLoadBeforeWrite();
  const r = await loadBestSnapshot({
    readLocalCandidates: store.readLocalCandidates,
    fetchDiscordCandidates: discordCandidates,
    readFileCandidate: async () => ({ ok: false }),
    fetchDiscordMessageCandidate: async () => ({ ok: false }),
    env: {},
  });
  if (!r.ok) return { r, data: null };
  store.setSeqAtLeast(r.maxSeq);
  q.markLoaded();
  if (r.chosen.source !== "local") await q.enqueueSave(r.chosen.data, { force: true });
  return { r, data: r.chosen.data };
}
const save = (data) => q.enqueueSave(data, { force: true });
const upload = (data) => uploadBackup(channel, data, { seq: store.nextSeq() });

const players = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${1000 + i}`, { cc: 100, tp: 0 }]));

// ---------------------------------------------------------
section("Boot 1 — first deploy: empty disk, legacy Discord backup");
discord.push({ content: "", text: JSON.stringify(players), ts: Date.now() - 60_000 }); // pre-metadata backup
q.__resetSaveQueueForTests();
q.requireLoadBeforeWrite();
assertEqual(await q.enqueueSave({ junk: {} }), false, "before loading, saves are refused");
assertEqual((await fs.readdir(dir)).length, 0, "nothing is written before loading");

let { r, data } = await boot();
assertEqual([r.chosen.source, r.chosen.userCount], ["discord", 50], "loads the legacy Discord backup");
let [cur] = await store.readLocalCandidates();
assertTrue(cur.ok && cur.seq === 1, "the loaded snapshot is immediately written to local storage (seq 1)");

data["1000"].cc = 999;
assertEqual(await save(data), true, "a change is saved locally");
await upload(data);                 // periodic Discord backup
data["1000"].cc = 1000;
await save(data);                   // newer local change, then a crash (no shutdown upload)

// ---------------------------------------------------------
section("Boot 2 — crash restart: local is newer than Discord");
({ r, data } = await boot());
assertEqual([r.chosen.source, data["1000"].cc], ["local", 1000], "newest local snapshot loads; nothing lost");
const seqAfterBoot2 = store.getSeq();

// Disk starts failing; changes only reach Discord.
data["1000"].cc = 2000;
await fs.rm(path.join(dir, "trainerData.json.tmp"), { force: true, recursive: true });
await fs.mkdir(path.join(dir, "trainerData.json.tmp"));
assertEqual(await save(data), false, "local write fails and is reported as failed");
await upload(data);
assertTrue(store.getSeq() > seqAfterBoot2, "seq kept increasing through the failed write and the upload");
await fs.rm(path.join(dir, "trainerData.json.tmp"), { force: true, recursive: true });
q.__resetSaveQueueForTests(); // crash: the pending retry dies with the process

// ---------------------------------------------------------
section("Boot 3 — Discord is newer than the stale local file");
({ r, data } = await boot());
assertEqual([r.chosen.source, data["1000"].cc], ["discord", 2000], "the newer Discord backup wins over the older local file");
[cur] = await store.readLocalCandidates();
assertTrue(cur.ok && JSON.parse(await fs.readFile(path.join(dir, "trainerData.json"), "utf8"))["1000"].cc === 2000,
  "and is written back to local storage");

// ---------------------------------------------------------
section("Boot 4 — corrupt current file");
data["1000"].cc = 3000;
await save(data);
await fs.writeFile(path.join(dir, "trainerData.json"), '{"1000": {"cc": 30');
({ r, data } = await boot());
assertTrue(r.ok && r.chosen.source !== "local", "the corrupt file is skipped");
assertTrue(data["1000"].cc >= 2000, `loads the next newest valid copy (cc=${data["1000"].cc}), never an older generation than necessary`);

q.__resetSaveQueueForTests();
Object.assign(console, quiet);
await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
