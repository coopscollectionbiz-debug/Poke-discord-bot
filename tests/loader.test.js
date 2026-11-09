// ==========================================================
// tests/loader.test.js — startup decision + Discord backup handling,
// with a fake Discord client (offline).
// ==========================================================

import { loadBestSnapshot } from "../persistence/loader.js";
import { fetchDiscordCandidates, fetchDiscordMessageCandidate, uploadBackup } from "../persistence/discordBackups.js";
import { validateSnapshot, buildMeta, parseBackupMessage } from "../persistence/snapshot.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const users = (n, tag = "x") => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${100 + i}`, { tag }]));
function snap(source, n, { seq = null, savedAt = 0, tag = source } = {}) {
  const text = JSON.stringify(users(n, tag));
  const meta = seq == null ? null : buildMeta(text, { seq, savedAt, userCount: n });
  return validateSnapshot({ source, id: source, text, meta, fallbackTime: savedAt });
}
const missing = (source) => ({ ok: false, source, id: source, reason: "missing" });
const run = (local, discord, env = {}, extra = {}) =>
  loadBestSnapshot({
    readLocalCandidates: async () => local,
    fetchDiscordCandidates: async () => (discord instanceof Error ? Promise.reject(discord) : discord),
    readFileCandidate: async () => missing("restore-file"),
    fetchDiscordMessageCandidate: async () => missing("discord"),
    env,
    ...extra,
  });

section("Normal restarts");
let r = await run([snap("local", 100, { seq: 50, savedAt: 2000 }), snap("local-prev", 100, { seq: 49 })], [snap("discord", 100, { seq: 47, savedAt: 1500 })]);
assertEqual([r.ok, r.chosen.source, r.maxSeq], [true, "local", 50], "restart with a volume: newest local snapshot wins");

r = await run([snap("local", 100, { seq: 50 })], [snap("discord", 100, { seq: 53, savedAt: 1 })]);
assertEqual(r.chosen.source, "discord", "a newer Discord backup beats an older local file");

r = await run([{ ok: false, source: "local", id: "l", reason: "invalid JSON" }, snap("local-prev", 100, { seq: 49 })], [snap("discord", 100, { seq: 45 })]);
assertEqual(r.chosen.source, "local-prev", "corrupt current file: previous generation used");

section("First deploy of the volume (legacy backups, empty disk)");
r = await run([missing("local"), missing("local-prev")], [snap("discord", 120, { savedAt: 3000 }), snap("discord", 120, { savedAt: 2000, tag: "older" })]);
assertEqual([r.ok, r.chosen.savedAt, r.maxSeq], [true, 3000, 0], "newest legacy Discord backup is loaded; numbering starts at 0");

r = await run([missing("local"), missing("local-prev")], [snap("discord", 40, { savedAt: 3000 }), snap("discord", 120, { savedAt: 2000 })]);
assertTrue(!r.ok && /below 80%/.test(r.blocked), "a newest backup missing most players is refused");

section("Never load older over newer");
r = await run([snap("local", 100, { seq: 50 })], new Error("Missing Access"));
assertTrue(!r.ok && /unreachable/.test(r.blocked), "Discord unreachable: local is NOT loaded by default");
r = await run([snap("local", 100, { seq: 50 })], new Error("Missing Access"), { ALLOW_LOCAL_ONLY: "1" });
assertEqual([r.ok, r.chosen.source], [true, "local"], "ALLOW_LOCAL_ONLY=1 loads local");
r = await run([snap("local", 100, { seq: 50 })], [snap("discord", 100, { seq: 70 })]);
assertEqual(r.maxSeq, 70, "next seq continues above every snapshot seen");

section("Operator restore");
const fileSnap = snap("restore-file", 90, { seq: 3 });
r = await run([snap("local", 100, { seq: 50 })], [], { RESTORE_FROM: "file:/data/s.json", CONFIRM_RESTORE: "file:/data/s.json" },
  { readFileCandidate: async () => fileSnap });
assertEqual([r.ok, r.restored, r.chosen.source, r.maxSeq], [true, true, "restore-file", 50], "confirmed restore loads the file and numbers above local");
r = await run([snap("local", 100, { seq: 50 })], [], { RESTORE_FROM: "file:/data/s.json" });
assertTrue(!r.ok && /CONFIRM_RESTORE/.test(r.blocked), "unconfirmed restore refuses to load anything");
r = await run([], [], { RESTORE_FROM: "discord:9", CONFIRM_RESTORE: "discord:9" });
assertTrue(!r.ok && /invalid/.test(r.blocked), "restore target that doesn't validate is refused");

// ---------------- Fake Discord ----------------
const BOT = "bot-1";
function fakeMessage(id, author, ts, data, content = "") {
  const text = JSON.stringify(data);
  return {
    id, content, createdTimestamp: ts, author: { id: author },
    attachments: { first: () => ({ name: "trainerData.json", url: `mem://${id}` }) },
    _text: text,
  };
}
function fakeClient(messages) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const sent = [];
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async (arg) => (typeof arg === "string" ? byId.get(arg) : new Map(byId)) },
    send: async (payload) => { sent.push(payload); return { id: `sent-${sent.length}` }; },
  };
  return { client: { user: { id: BOT }, channels: { cache: new Map([["chan", channel]]), fetch: async () => channel } }, channel, sent };
}
const fetchImpl = (msgs) => async (url) => {
  const m = msgs.find((x) => `mem://${x.id}` === url);
  return { ok: true, status: 200, text: async () => m._text };
};

section("Discord backups");
const msgs = [
  fakeMessage("m1", BOT, 1000, users(100)),
  fakeMessage("m2", BOT, 2000, users(101)),
  fakeMessage("m3", "someone-else", 9999, users(5)),       // newest, but not the bot
  fakeMessage("m4", BOT, 3000, {}),                        // empty backup
  fakeMessage("m5", BOT, 500, users(99)),
];
const { client, channel, sent } = fakeClient(msgs);
const cands = await fetchDiscordCandidates(client, "chan", { fetchImpl: fetchImpl(msgs) });
assertEqual(cands.filter((c) => c.id === "m3").map((c) => c.reason), ["not posted by the bot (ignored)"], "backups posted by others are ignored");
assertEqual(cands.filter((c) => c.reason !== "not posted by the bot (ignored)").map((c) => c.id), ["m4", "m2", "m1"], "only the newest 3 bot backups are downloaded");
assertEqual(cands.find((c) => c.id === "m4").reason, "no users", "an empty backup is rejected, not loaded");

r = await loadBestSnapshot({
  readLocalCandidates: async () => [missing("local"), missing("local-prev")],
  fetchDiscordCandidates: () => fetchDiscordCandidates(client, "chan", { fetchImpl: fetchImpl(msgs) }),
  readFileCandidate: async () => missing("f"),
  fetchDiscordMessageCandidate: async () => missing("d"),
  env: {},
});
assertEqual([r.ok, r.chosen.id, r.chosen.userCount], [true, "m2", 101], "empty newest backup is skipped; the newest valid bot backup loads");

const restoreMsg = await fetchDiscordMessageCandidate(client, "chan", "m3", { fetchImpl: fetchImpl(msgs) });
assertTrue(restoreMsg.ok && restoreMsg.userCount === 5, "an explicit restore may use any author's backup");

const { meta } = await uploadBackup(channel, users(7), { seq: 12, now: 4242 });
const last = sent.at(-1);
const parsed = parseBackupMessage(last.content);
assertEqual([parsed.seq, parsed.userCount, parsed.savedAt], [12, 7, 4242], "upload carries seq/users/savedAt in the message");
assertEqual(last.files[0].name, "trainerData.json", "attachment name unchanged (older releases can load it)");
const uploadedText = Buffer.from(last.files[0].attachment).toString("utf8");
assertEqual(JSON.parse(uploadedText), users(7), "attachment is the plain user map (unchanged format)");
const reread = validateSnapshot({ source: "discord", id: "u", text: uploadedText, meta: parsed });
assertTrue(reread.metaTrusted && reread.seq === 12 && meta.sha256 === parsed.sha256, "sha256 in the message matches the uploaded file");

finish();
