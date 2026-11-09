// ==========================================================
// persistence/discordBackups.js
// Off-machine backups in the Discord storage channel.
//
// The attachment is unchanged (trainerData.json, compact JSON of the user
// map), so older bot releases can still load it — that keeps code rollback
// safe. Metadata travels in the message text:
//   trainerData seq=<n> users=<n> sha256=<hex> savedAt=<ms>
// Only backups posted by the bot itself are considered at startup.
// ==========================================================

import { AttachmentBuilder } from "discord.js";
import { buildMeta, formatBackupMessage, parseBackupMessage, validateSnapshot } from "./snapshot.js";

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
 * @returns {Promise<{meta: object, bytes: number}>}
 */
export async function uploadBackup(channel, data, { seq, now = Date.now(), timeoutMs = 25_000 } = {}) {
  const text = JSON.stringify(data); // compact, same as before
  const meta = buildMeta(text, { seq, savedAt: now, userCount: Object.keys(data).length });
  const file = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "trainerData.json" });
  await withTimeout(channel.send({ content: formatBackupMessage(meta), files: [file] }), timeoutMs, "upload backup");
  return { meta, bytes: meta.bytes };
}
