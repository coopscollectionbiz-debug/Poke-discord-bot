// ==========================================================
// persistence/discordBackups.js
// Off-machine backups in the Discord storage channel.
//
// The attachment is unchanged (trainerData.json, compact JSON of the user
// map), so older bot releases can still load it — that keeps code rollback
// safe. Metadata travels in the message text:
//   trainerData seq=<n> epoch=<n> users=<n> sha256=<hex> savedAt=<ms>
// Only backups posted by the bot itself are considered at startup.
// ==========================================================

import { AttachmentBuilder } from "discord.js";
import { buildMeta, formatBackupMessage, parseBackupMessage, validateSnapshot, sha256 } from "./snapshot.js";

const isBackupAttachment = (att) => {
  const name = String(att?.name || "").toLowerCase();
  return name.startsWith("trainerdata") && name.endsWith(".json");
};

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function downloadCandidate(message, fetchImpl, timeoutMs) {
  const att = message.attachments.first();
  try {
    const res = await withTimeout(fetchImpl(att.url), timeoutMs, "download backup");
    if (!res.ok) return { ok: false, source: "discord", id: message.id, reason: `download HTTP ${res.status}` };
    const text = await withTimeout(res.text(), timeoutMs, "read backup");
    return validateSnapshot({
      source: "discord",
      id: message.id,
      text,
      meta: parseBackupMessage(message.content),
      fallbackTime: message.createdTimestamp,
    });
  } catch (e) {
    return { ok: false, source: "discord", id: message.id, reason: `download failed (${e?.message || e})` };
  }
}

async function getChannel(client, channelId, timeoutMs) {
  const channel = client.channels.cache.get(channelId) ?? (await withTimeout(client.channels.fetch(channelId), timeoutMs, "fetch storage channel"));
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("storage channel unusable");
  return channel;
}

/**
 * The newest `limit` bot-authored backups as validated candidates.
 * Throws if the channel or its message history can't be read, so the
 * caller can tell "Discord unreachable" apart from "no backups".
 */
export async function fetchDiscordCandidates(client, channelId, { limit = 3, fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  const channel = await getChannel(client, channelId, 10_000);
  const messages = await withTimeout(channel.messages.fetch({ limit: 50 }), 10_000, "fetch storage messages");
  const botId = client.user?.id;

  const all = [...messages.values()].filter((m) => isBackupAttachment(m.attachments.first()));
  const foreign = all.filter((m) => m.author?.id !== botId);
  const mine = all.filter((m) => m.author?.id === botId).sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  const out = foreign.map((m) => ({ ok: false, source: "discord", id: m.id, reason: "not posted by the bot (ignored)" }));
  for (const m of mine.slice(0, limit)) out.push(await downloadCandidate(m, fetchImpl, timeoutMs));
  return out;
}

/** One specific backup message (operator restore). Any author is allowed here. */
export async function fetchDiscordMessageCandidate(client, channelId, messageId, { fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  try {
    const channel = await getChannel(client, channelId, 10_000);
    const message = await withTimeout(channel.messages.fetch(messageId), 10_000, "fetch restore message");
    if (!isBackupAttachment(message.attachments.first())) {
      return { ok: false, source: "discord", id: messageId, reason: "message has no trainerData*.json attachment" };
    }
    return downloadCandidate(message, fetchImpl, timeoutMs);
  } catch (e) {
    return { ok: false, source: "discord", id: messageId, reason: `fetch failed (${e?.message || e})` };
  }
}

/**
 * Upload a backup with metadata.
 * @returns {Promise<{meta: object, bytes: number, message: object}>}
 */
export async function uploadBackup(channel, data, { seq, epoch = null, now = Date.now(), timeoutMs = 25_000 } = {}) {
  const text = JSON.stringify(data); // compact, same as before
  const meta = buildMeta(text, { seq, epoch, savedAt: now, userCount: Object.keys(data).length });
  const file = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "trainerData.json" });
  const message = await withTimeout(channel.send({ content: formatBackupMessage(meta), files: [file] }), timeoutMs, "upload backup");
  return { meta, bytes: meta.bytes, message };
}

/**
 * A2: download what Discord stored and compare its sha256 with what we sent.
 * Never throws. @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function verifyUpload(message, meta, { fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  try {
    const att = message?.attachments?.first?.();
    if (!att?.url) return { ok: false, reason: "no attachment on the sent message" };
    const res = await withTimeout(fetchImpl(att.url), timeoutMs, "verify download");
    if (!res.ok) return { ok: false, reason: `download HTTP ${res.status}` };
    const text = await withTimeout(res.text(), timeoutMs, "verify read");
    const got = sha256(text);
    return got === meta.sha256 ? { ok: true } : { ok: false, reason: "sha256 mismatch" };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * A2 fencing: the highest epoch announced by any bot-authored backup among
 * the newest messages (read from message text only; nothing is downloaded).
 * Throws if the channel can't be read, so callers can tell "unknown" from 0.
 */
export async function newestChannelEpoch(client, channelId, { limit = 50 } = {}) {
  const channel = await getChannel(client, channelId, 10_000);
  const messages = await withTimeout(channel.messages.fetch({ limit }), 10_000, "fetch storage messages");
  const botId = client.user?.id;
  let max = 0;
  for (const m of messages.values()) {
    if (m.author?.id !== botId || !isBackupAttachment(m.attachments.first())) continue;
    const e = parseBackupMessage(m.content)?.epoch;
    if (Number.isInteger(e) && e > max) max = e;
  }
  return max;
}

/**
 * One page of the storage channel's history for the Pokédex backfill
 * (services/dexBackfill.js): the bot-authored backups among up to 100
 * messages older than `beforeId` (newest first), and the id to page on from
 * (null at the start of the channel). Read-only.
 */
export async function listBackupPage(client, channelId, beforeId = null, { timeoutMs = 25_000 } = {}) {
  const channel = await getChannel(client, channelId, timeoutMs);
  const messages = await withTimeout(channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }), timeoutMs, "fetch storage history");
  const list = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const botId = client.user?.id;
  const items = list
    .filter((m) => m.author?.id === botId && isBackupAttachment(m.attachments.first()))
    .map((m) => ({ id: m.id, at: m.createdTimestamp, url: m.attachments.first().url }));
  return { items, next: list.length === 100 ? list[list.length - 1].id : null };
}
