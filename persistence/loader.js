// ==========================================================
// persistence/loader.js
// Startup decision: which snapshot becomes the live trainerData.
// All I/O is injected, so the whole decision is testable offline.
//
// Rules (see DURABLE-STORAGE-PLAN §2.4):
//  • Operator restore (RESTORE_FROM + matching CONFIRM_RESTORE) wins.
//  • Otherwise consider local current, local previous, and the newest
//    bot-authored Discord backups; pick the newest valid one (seq first).
//  • Refuse a snapshot with < 80% of the players of the largest valid
//    candidate unless ALLOW_PLAYER_COUNT_DROP=1.
//  • If Discord can't be checked, don't load (a newer backup might be
//    there) unless ALLOW_LOCAL_ONLY=1 — never load older over newer.
// ==========================================================

import { resolveRestore, selectSnapshot } from "./snapshot.js";

/**
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.readLocalCandidates
 * @param {() => Promise<object[]>} deps.fetchDiscordCandidates - throws if unreachable
 * @param {(file:string) => Promise<object>} deps.readFileCandidate
 * @param {(messageId:string) => Promise<object>} deps.fetchDiscordMessageCandidate
 * @param {object} [deps.env]
 * @returns {Promise<{ok:boolean, chosen?:object, maxSeq?:number, rejected:object[], blocked?:string, restored?:boolean}>}
 */
export async function loadBestSnapshot({
  readLocalCandidates,
  fetchDiscordCandidates,
  readFileCandidate,
  fetchDiscordMessageCandidate,
  env = process.env,
}) {
  // ---- operator restore ----
  const restore = resolveRestore(env);
  if (restore?.error) return { ok: false, blocked: restore.error, rejected: [] };
  if (restore) {
    const cand =
      restore.kind === "file"
        ? await readFileCandidate(restore.target)
        : await fetchDiscordMessageCandidate(restore.target);
    if (!cand.ok) {
      return { ok: false, blocked: `restore target ${restore.kind}:${restore.target} is invalid: ${cand.reason}`, rejected: [cand] };
    }
    // Continue numbering above anything local, so the restored data becomes newest.
    const local = await readLocalCandidates().catch(() => []);
    const maxSeq = Math.max(0, cand.seq ?? 0, ...local.filter((c) => c.ok && c.seq != null).map((c) => c.seq));
    const maxEpoch = Math.max(0, cand.epoch ?? 0, ...local.filter((c) => c.ok && c.epoch != null).map((c) => c.epoch));
    return { ok: true, chosen: cand, maxSeq, maxEpoch, rejected: [], restored: true };
  }

  // ---- normal selection ----
  const local = await readLocalCandidates();
  let discord;
  let discordReachable = true;
  try {
    discord = await fetchDiscordCandidates();
  } catch (e) {
    discordReachable = false;
    const unreachable = { ok: false, source: "discord", id: "storage channel", reason: `unreachable (${e?.message || e})` };
    // A2: on a persistent, single-writer volume (LOCAL_IS_DURABLE=1) a local
    // snapshot whose metadata verifies is this app's own latest write, so
    // boot from it rather than stay down until Discord answers.
    const durableLocal = env.LOCAL_IS_DURABLE === "1" && local.some((c) => c.ok && c.metaTrusted);
    if (env.ALLOW_LOCAL_ONLY !== "1" && !durableLocal) {
      return {
        ok: false,
        rejected: [...local.filter((c) => !c.ok), unreachable],
        blocked: "Discord storage channel unreachable; not loading local data in case a newer backup exists there (set ALLOW_LOCAL_ONLY=1 to override)",
      };
    }
    discord = [unreachable];
  }

  const candidates = [...local, ...discord];
  const sel = selectSnapshot(candidates, { allowPlayerCountDrop: env.ALLOW_PLAYER_COUNT_DROP === "1" });
  if (!sel.chosen) return { ok: false, rejected: sel.rejected, blocked: sel.blocked };

  // Next seq must exceed every snapshot we saw, so ours always sort newest.
  const maxSeq = Math.max(0, ...candidates.filter((c) => c.ok && c.seq != null).map((c) => c.seq));
  // Next epoch must exceed every epoch we saw (A2 fencing).
  const maxEpoch = Math.max(0, ...candidates.filter((c) => c.ok && c.epoch != null).map((c) => c.epoch));
  return { ok: true, chosen: sel.chosen, maxSeq, maxEpoch, rejected: sel.rejected, localOnly: !discordReachable };
}

/** One-line summary of a candidate for logs (no player data). */
export function describe(c) {
  if (!c) return "none";
  if (!c.ok) return `${c.source} ${c.id}: rejected (${c.reason})`;
  return `${c.source} ${c.id}: ${c.userCount} players, seq=${c.seq ?? "?"}, savedAt=${c.savedAt ? new Date(c.savedAt).toISOString() : "?"}${c.metaTrusted ? "" : ", no trusted metadata"}`;
}
