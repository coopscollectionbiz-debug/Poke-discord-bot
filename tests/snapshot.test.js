// ==========================================================
// tests/snapshot.test.js — validation + selection rules (pure)
// ==========================================================

import {
  sha256, buildMeta, validateSnapshot, isNewer, selectSnapshot,
  formatBackupMessage, parseBackupMessage, resolveRestore,
} from "../persistence/snapshot.js";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const users = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${100 + i}`, { cc: i }]));
const text = (n) => JSON.stringify(users(n));
const cand = (o) => ({ ok: true, id: o.source, userCount: 10, seq: null, savedAt: 0, metaTrusted: true, data: {}, ...o });

section("Validation");
assertEqual(validateSnapshot({ source: "local", text: null }).reason, "missing", "missing file");
assertEqual(validateSnapshot({ source: "local", text: "  " }).reason, "empty file", "empty file");
assertTrue(/invalid JSON/.test(validateSnapshot({ source: "local", text: '{"a":' }).reason), "truncated JSON");
assertEqual(validateSnapshot({ source: "local", text: "[]" }).reason, "not a user map", "array");
assertEqual(validateSnapshot({ source: "local", text: "{}" }).reason, "no users", "empty map");
assertTrue(/not an object/.test(validateSnapshot({ source: "local", text: '{"1":5}' }).reason), "non-object user");

const t = text(3);
const good = validateSnapshot({ source: "local", text: t, meta: buildMeta(t, { seq: 7, savedAt: 123, userCount: 3 }), fallbackTime: 999 });
assertTrue(good.ok && good.userCount === 3, "valid snapshot accepted");
assertEqual([good.seq, good.savedAt, good.metaTrusted], [7, 123, true], "matching metadata is trusted");

const stale = validateSnapshot({ source: "local", text: t, meta: { seq: 9, savedAt: 1, sha256: sha256("other") }, fallbackTime: 555 });
assertEqual([stale.ok, stale.seq, stale.savedAt, stale.metaTrusted], [true, null, 555, false],
  "metadata for different content is ignored (seq unknown, file time used)");

section("Backup message metadata");
const meta = buildMeta(t, { seq: 42, savedAt: 1700000000000, userCount: 3 });
const parsed = parseBackupMessage(formatBackupMessage(meta));
assertEqual([parsed.seq, parsed.userCount, parsed.sha256, parsed.savedAt], [42, 3, meta.sha256, 1700000000000], "round-trips through message text");
assertEqual(parseBackupMessage(""), null, "legacy backup (no text) has no metadata");

section("Which snapshot is newer");
assertTrue(isNewer(cand({ source: "discord", seq: 11, savedAt: 1 }), cand({ source: "local", seq: 10, savedAt: 9e12 })),
  "higher seq wins even when its clock says older (skew)");
assertTrue(isNewer(cand({ source: "local", seq: 5 }), cand({ source: "discord", seq: 5 })), "same seq: local preferred");
assertTrue(isNewer(cand({ source: "discord", savedAt: 200 }), cand({ source: "local", seq: 3, savedAt: 100 })),
  "unknown seq on one side: compare times");
assertTrue(isNewer(cand({ source: "local", savedAt: 100 }), cand({ source: "discord", savedAt: 100 })), "same time: local preferred");

section("Selection and the player-count guard");
const sel = selectSnapshot([
  { ok: false, source: "local", id: "a", reason: "missing" },
  cand({ source: "local-prev", seq: 4, userCount: 100 }),
  cand({ source: "discord", seq: 6, userCount: 101 }),
]);
assertEqual([sel.chosen.source, sel.blocked], ["discord", null], "newest valid snapshot is chosen");
assertEqual(sel.rejected.length, 1, "invalid candidates are reported");

const shrink = selectSnapshot([cand({ source: "local", seq: 9, userCount: 70 }), cand({ source: "discord", seq: 8, userCount: 100 })]);
assertTrue(shrink.chosen === null && /below 80%/.test(shrink.blocked), "a newest snapshot with 70% of players is refused");
const allowed = selectSnapshot([cand({ source: "local", seq: 9, userCount: 70 }), cand({ source: "discord", seq: 8, userCount: 100 })], { allowPlayerCountDrop: true });
assertEqual(allowed.chosen?.source, "local", "operator override allows it");
assertEqual(selectSnapshot([cand({ source: "local", seq: 9, userCount: 85 }), cand({ source: "discord", seq: 8, userCount: 100 })]).chosen?.source,
  "local", "a small drop (85%) is allowed");
assertEqual(selectSnapshot([{ ok: false, source: "local", id: "x", reason: "missing" }]).blocked, "no valid snapshot", "nothing valid");

section("Operator restore");
assertEqual(resolveRestore({}), null, "no restore by default");
assertEqual(resolveRestore({ RESTORE_FROM: "discord:123", CONFIRM_RESTORE: "discord:123" }), { kind: "discord", target: "123" }, "confirmed discord restore");
assertEqual(resolveRestore({ RESTORE_FROM: "file:/data/x.json", CONFIRM_RESTORE: "file:/data/x.json" }), { kind: "file", target: "/data/x.json" }, "confirmed file restore");
assertTrue(!!resolveRestore({ RESTORE_FROM: "discord:123" }).error, "refused without confirmation");
assertTrue(!!resolveRestore({ RESTORE_FROM: "discord:123", CONFIRM_RESTORE: "discord:124" }).error, "refused when confirmation differs");
assertTrue(!!resolveRestore({ RESTORE_FROM: "s3:x", CONFIRM_RESTORE: "s3:x" }).error, "unknown kind refused");

finish();
