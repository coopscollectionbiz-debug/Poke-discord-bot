// ==========================================================
// tools/probe-discord-media.mjs — how long Discord takes to deliver our images.
//   BOT_TOKEN=… node tools/probe-discord-media.mjs --dir <images> --channel <id> [--keep] [--width 550]
// <images>: a folder of .gif/.png files (node tools/bench-displays.mjs --out <dir>).
// Standalone (Node's fetch only), so it can run from a temp folder on the server.
//
// For each image, smallest first: post it to the channel (one message per
// image, as the bot does), then fetch it the ways a client can, all at once
// and cold:
//   cdn        the original file (attachment.url)
//   proxy      the Media Proxy, no options (attachment.proxy_url)
//   proxy-webp the Media Proxy resized to --width as animated WebP, the
//              shape Discord's own blog describes for its clients
// A fetch that fails or isn't 200 is retried every 500 ms for up to 30 s, so
// "first ok" is when a client could first have shown the image. Every
// message is deleted at the end unless --keep.
// ==========================================================

import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DIR = arg("dir");
const CHANNEL = arg("channel");
const WIDTH = Number(arg("width", "550"));
const KEEP = process.argv.includes("--keep");
const TOKEN = process.env.BOT_TOKEN;
if (!DIR || !CHANNEL || !TOKEN) {
  console.error("usage: BOT_TOKEN=… node tools/probe-discord-media.mjs --dir <images> --channel <id> [--keep] [--width 550]");
  process.exit(2);
}
const API = "https://discord.com/api/v10";
const auth = { Authorization: `Bot ${TOKEN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Discord REST with its rate limits honoured.
async function discord(method, url, body) {
  for (;;) {
    const res = await fetch(`${API}${url}`, { method, headers: auth, body });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 50);
      continue;
    }
    if (!res.ok && res.status !== 204) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
}

/** Fetches `url` until it returns 200 with a body, up to 30 s. → { firstOkMs, tries, status, kb, type } */
async function firstOk(url) {
  const started = performance.now();
  let tries = 0, last = "";
  while (performance.now() - started < 30_000) {
    tries++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "probe-discord-media" } });
      const body = Buffer.from(await res.arrayBuffer());
      if (res.status === 200 && body.length) {
        return { firstOkMs: Math.round(performance.now() - started), tries, status: 200, kb: Math.round(body.length / 1024), type: res.headers.get("content-type") };
      }
      last = String(res.status);
    } catch (err) {
      last = err?.name === "TimeoutError" ? "timeout" : (err?.message ?? "error");
    }
    await sleep(500);
  }
  return { firstOkMs: null, tries, status: last, kb: null, type: null };
}

const files = fs.readdirSync(DIR).filter((f) => /\.(gif|png)$/i.test(f))
  .map((f) => ({ f, size: fs.statSync(path.join(DIR, f)).size })).sort((a, b) => a.size - b.size);

const rows = [];
const posted = [];
try {
  for (const { f, size } of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: `probe ${f}`, attachments: [{ id: 0, filename: f }] }));
    form.append("files[0]", new Blob([buf]), f);
    const t = performance.now();
    const msg = await discord("POST", `/channels/${CHANNEL}/messages`, form);
    const uploadMs = Math.round(performance.now() - t);
    posted.push(msg.id);
    const a = msg.attachments[0];
    const h = a.width && a.height ? Math.round((a.height * WIDTH) / a.width) : WIDTH;
    const sep = (u) => (u.includes("?") ? "&" : "?");
    const [cdn, proxy, webp] = await Promise.all([
      firstOk(a.url),
      firstOk(a.proxy_url),
      firstOk(`${a.proxy_url}${sep(a.proxy_url)}format=webp&width=${WIDTH}&height=${h}&animated=true`),
    ]);
    rows.push({
      image: f, kb: Math.round(size / 1024), px: `${a.width}x${a.height}`, uploadMs,
      cdnMs: cdn.firstOkMs ?? `✗ ${cdn.status}`, proxyMs: proxy.firstOkMs ?? `✗ ${proxy.status}`,
      webpMs: webp.firstOkMs ?? `✗ ${webp.status}`, webpKb: webp.kb, webpType: webp.type, webpTries: webp.tries,
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally {
  if (!KEEP) for (const id of posted) await discord("DELETE", `/channels/${CHANNEL}/messages/${id}`).catch((err) => console.warn("delete failed:", err.message));
}
console.table(rows);
