// ==========================================================
// tests/durability.test.js
// Release A2: epoch fencing, compact snapshots, verified Discord uploads,
// volume-aware boot, the save circuit breaker, and a two-process drill.
// Offline: fake Discord, temp TRAINERDATA_DIR.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "durability-"));
process.env.TRAINERDATA_DIR = dir;

const snap = await import("../persistence/snapshot.js");
const store = await import("../persistence/localStore.js");
const { loadBestSnapshot } = await import("../persistence/loader.js");
const { uploadBackup, verifyUpload, newestChannelEpoch, fetchDiscordCandidates } = await import("../persistence/discordBackups.js");
const q = await import("../utils/saveQueue.js");

const quiet = { log: console.log, warn: console.warn, error: console.error };
const hush = () => { console.log = console.warn = console.error = () => {}; };
const loud = () => Object.assign(console, quiet);

const users = (n, cc = 1) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(1000 + i), { cc, trainers: [] }]));
const cand = (o) => ({ ok: true, source: "discord", id: "x", data: {}, userCount: 10, seq: null, epoch: null, savedAt: 0, metaTrusted: true, ...o });

// ---------------- Fake Discord ----------------
const BOT = "bot-1";
function fakeDiscord() {
  const messages = new Map();
  let n = 0;
  const blobs = new Map();
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async (a) => (typeof a === "string" ? messages.get(a) : new Map(messages)) },
    send: async ({ content, files }) => {
      const id = `m${++n}`;
      const text = Buffer.from(files[0].attachment).toString("utf8");
      blobs.set(id, text);
      const msg = { id, content, author: { id: BOT }, createdTimestamp: Date.now() + n, attachments: { first: () => ({ name: files[0].name, url: `mem://${id}` }), size: 1 } };
      messages.set(id, msg);
      return msg;
    },
  };
  const client = { user: { id: BOT }, channels: { cache: new Map([["chan", channel]]), fetch: async () => channel } };
  const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => blobs.get(url.replace("mem://", "")) });
  return { client, channel, fetchImpl, blobs, messages };
}

section("Epoch in metadata and backup messages");
{
  const meta = snap.buildMeta("{}", { seq: 7, epoch: 3, userCount: 0 });
  assertEqual(meta.epoch, 3, "buildMeta records the epoch");
  const parsed = snap.parseBackupMessage(snap.formatBackupMessage(meta));
  assertEqual([parsed.seq, parsed.epoch], [7, 3], "epoch survives the message text round trip");
  const legacy = snap.parseBackupMessage("trainerData seq=5 users=1 sha256=" + "a".repeat(64) + " savedAt=1");
  assertEqual(legacy.epoch, null, "pre-A2 messages parse with epoch null");
}

section("Ordering: epoch first, but only when both have one");
{
  assertTrue(snap.isNewer(cand({ epoch: 2, seq: 1 }), cand({ epoch: 1, seq: 999 })), "a higher epoch beats a stale process's higher seq");
  assertTrue(snap.isNewer(cand({ epoch: null, seq: null, savedAt: 2000 }), cand({ epoch: 4, seq: 50, savedAt: 1000 })),
    "rollback safety: a NEWER legacy backup (no epoch/seq) still wins by time over an older epoch snapshot");
  assertTrue(snap.isNewer(cand({ epoch: 3, seq: 10 }), cand({ epoch: null, seq: 9 })), "epoch vs pre-A2 seq snapshot: seq decides");
}

section("Identical content prefers the local copy");
{
  const same = "f".repeat(64);
  assertTrue(snap.isNewer(cand({ source: "local", seq: 84, epoch: 1, sha256: same }), cand({ source: "discord", seq: 85, epoch: 1, sha256: same })),
    "shutdown flush (seq 84) and final backup (seq 85) of the same data: local wins");
  assertTrue(snap.isNewer(cand({ source: "discord", seq: 85, epoch: 1, sha256: "a".repeat(64) }), cand({ source: "local", seq: 84, epoch: 1, sha256: "b".repeat(64) })),
    "different content: the newer seq still wins");
  const v = snap.validateSnapshot({ source: "local", text: '{"1":{}}', meta: null });
  assertTrue(/^[0-9a-f]{64}$/.test(v.sha256), "candidates carry a content hash even without metadata");
}

section("Compact local snapshots carry the epoch");
{
  store.__resetLocalStoreForTests();
  store.setEpoch(5);
  await store.writeSnapshot(users(3));
  const p = store.paths();
  const text = await fs.readFile(p.current, "utf8");
  assertTrue(!text.includes("\n"), "trainerData.json is compact JSON (D-27)");
  const meta = JSON.parse(await fs.readFile(p.currentMeta, "utf8"));
  assertEqual(meta.epoch, 5, "local metadata records the writer's epoch");
  const [cur] = await store.readLocalCandidates();
  assertTrue(cur.ok && cur.metaTrusted && cur.epoch === 5, "the local candidate reports epoch 5");
}

section("Loader: next epoch and volume-aware boot");
{
  const local = async () => store.readLocalCandidates();
  const down = async () => { throw new Error("discord down"); };
  const up = async () => [];
  let r = await loadBestSnapshot({ readLocalCandidates: local, fetchDiscordCandidates: up, env: {} });
  assertTrue(r.ok && r.maxEpoch === 5, "loader reports the highest epoch seen (next writer takes maxEpoch + 1)");

  r = await loadBestSnapshot({ readLocalCandidates: local, fetchDiscordCandidates: down, env: {} });
  assertTrue(!r.ok && /unreachable/.test(r.blocked), "Discord down, no volume flag: still refuses (unchanged behavior)");

  r = await loadBestSnapshot({ readLocalCandidates: local, fetchDiscordCandidates: down, env: { LOCAL_IS_DURABLE: "1" } });
  assertTrue(r.ok && r.chosen.source === "local" && r.localOnly === true, "Discord down + durable volume + verified local: boots from local");

  const untrusted = async () => [{ ...(await local())[0], metaTrusted: false }, { ok: false, source: "local-prev", id: "p", reason: "missing" }];
  r = await loadBestSnapshot({ readLocalCandidates: untrusted, fetchDiscordCandidates: down, env: { LOCAL_IS_DURABLE: "1" } });
  assertTrue(!r.ok, "durable volume but local metadata doesn't verify: refuses");
}

section("Verified uploads and the channel epoch scan");
{
  const d = fakeDiscord();
  const { meta, message } = await uploadBackup(d.channel, users(4), { seq: 11, epoch: 2 });
  assertEqual((await verifyUpload(message, meta, { fetchImpl: d.fetchImpl })).ok, true, "an intact upload verifies");
  d.blobs.set(message.id, "{\"corrupted\":true}");
  const bad = await verifyUpload(message, meta, { fetchImpl: d.fetchImpl });
  assertTrue(!bad.ok && /sha256/.test(bad.reason), "a changed upload fails verification");
  assertEqual(await newestChannelEpoch(d.client, "chan"), 2, "channel scan finds epoch 2 from message text");
  const cands = await fetchDiscordCandidates(d.client, "chan", { fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(users(4)) }) });
  assertTrue(cands.some((c) => c.ok && c.epoch === 2), "downloaded candidates carry the epoch");
}

section("Write fence");
{
  q.__resetSaveQueueForTests();
  q.__setSaveQueueTestHooks({ writer: async () => {}, timing: { debounceMs: 1, minIntervalMs: 0, maxWaitMs: 10, retryBaseMs: 5, retryMaxMs: 10 } });
  hush();
  assertEqual(await q.enqueueSave({ a: {} }), true, "writes succeed before fencing");
  q.fenceWrites("test: higher epoch seen");
  const after = await q.enqueueSave({ a: {} });
  loud();
  assertEqual(after, false, "after fencing every save is refused");
  assertTrue(q.isFenced() && q.getSaveHealth().fenced, "health reports the fence");
}

section("Circuit breaker (degraded after repeated failures)");
{
  q.__resetSaveQueueForTests();
  let fail = true;
  q.__setSaveQueueTestHooks({ writer: async () => { if (fail) throw new Error("EIO"); }, timing: { debounceMs: 1, minIntervalMs: 0, maxWaitMs: 5, retryBaseMs: 5, retryMaxMs: 10 } });
  hush();
  await q.enqueueSave({ a: {} });
  for (let i = 0; i < 40 && q.getSaveHealth().consecutiveFailures < q.DEGRADED_AFTER; i++) await new Promise((r) => setTimeout(r, 10));
  const degraded = q.getSaveHealth().degraded;
  fail = false;
  for (let i = 0; i < 40 && q.getSaveHealth().consecutiveFailures > 0; i++) await new Promise((r) => setTimeout(r, 10));
  loud();
  assertTrue(degraded, `degraded after ${q.DEGRADED_AFTER} consecutive failures`);
  assertTrue(!q.getSaveHealth().degraded, "recovers as soon as a write succeeds");
  q.__resetSaveQueueForTests();
}

section("Drill: an old process is fenced when a new one takes over");
{
  const d = fakeDiscord();
  // Process A boots (epoch 1) and backs up.
  const a = { epoch: 1, seq: 1 };
  await uploadBackup(d.channel, users(5, 1), { seq: a.seq, epoch: a.epoch });
  // Process B boots from Discord: takes epoch max+1 and backs up newer data.
  const r = await loadBestSnapshot({
    readLocalCandidates: async () => [],
    fetchDiscordCandidates: () => fetchDiscordCandidates(d.client, "chan", { fetchImpl: d.fetchImpl }),
    env: {},
  });
  const b = { epoch: r.maxEpoch + 1, seq: r.maxSeq + 1 };
  await uploadBackup(d.channel, users(5, 2), { seq: b.seq, epoch: b.epoch });
  // A, still running, checks before its next upload: it must stop.
  const seen = await newestChannelEpoch(d.client, "chan");
  assertTrue(b.epoch === 2 && seen > a.epoch, "A sees a higher epoch and fences itself instead of uploading");
  // Even if A had uploaded with a higher seq, the loader prefers B.
  await uploadBackup(d.channel, users(5, 1), { seq: 99, epoch: a.epoch });
  const pick = await loadBestSnapshot({
    readLocalCandidates: async () => [],
    fetchDiscordCandidates: () => fetchDiscordCandidates(d.client, "chan", { fetchImpl: d.fetchImpl }),
    env: {},
  });
  assertTrue(pick.ok && pick.chosen.epoch === 2 && Object.values(pick.chosen.data)[0].cc === 2, "the loader picks B's data over A's late higher-seq upload");
}

await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
