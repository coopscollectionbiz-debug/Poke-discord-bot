// ==========================================================
// tools/card-timing-report.mjs — summarizes production render timing.
//   ssh <vps> 'sudo journalctl -u pokebot --since -24h -o cat' | node tools/card-timing-report.mjs
//   node tools/card-timing-report.mjs <logfile>
// Reads the "🖼️ card <name> gif|png <KB> KB <ms> ms[ (gate full)]" lines
// (utils/render/stage.js cardImage) and the "⏱️ <command> took <ms>ms" /
// "⏱️ Slow slash command: <command> took <ms>ms" lines (bot_final.js), and
// counts timeouts and failed renders/posts.
// ==========================================================

import fs from "fs";

const text = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : fs.readFileSync(0, "utf8");
const lines = text.split(/\r?\n/);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null);

const cards = new Map();
const commands = new Map();
const events = new Map();
const count = (k) => events.set(k, (events.get(k) ?? 0) + 1);

for (const line of lines) {
  let m = line.match(/🖼️ card (\S+) (gif|png) (\d+) KB (\d+) ms( \(gate full\))?/);
  if (m) {
    const [, name, kind, kb, ms, full] = m;
    const c = cards.get(name) ?? { n: 0, gif: 0, gateFull: 0, kb: [], ms: [], gifKb: [], gifMs: [] };
    c.n++;
    if (kind === "gif") { c.gif++; c.gifKb.push(+kb); c.gifMs.push(+ms); }
    if (full) c.gateFull++;
    c.kb.push(+kb); c.ms.push(+ms);
    cards.set(name, c);
    continue;
  }
  m = line.match(/⏱️ (?:Slow slash command: )?(\S+) took (\d+)ms/);
  if (m) {
    const a = commands.get(m[1]) ?? [];
    a.push(+m[2]);
    commands.set(m[1], a);
    continue;
  }
  if (/timed out|timeout after/i.test(line)) count("command timeout");
  if (/render failed/i.test(line)) count("render failed → PNG");
  if (/playback stopped/i.test(line)) count("battle playback stopped");
  if (/post failed|announcement failed/i.test(line)) count("post failed");
  if (/Unknown interaction/i.test(line)) count("Unknown interaction (3 s deadline missed)");
  if (/Request entity too large|50035|file.*too large/i.test(line)) count("upload too large");
}

const cardRows = [...cards].map(([name, c]) => ({
  card: name, n: c.n, gifPct: Math.round((100 * c.gif) / c.n), gateFull: c.gateFull,
  gifKbP50: pct(c.gifKb, 0.5), gifKbP95: pct(c.gifKb, 0.95), gifKbMax: c.gifKb.length ? Math.max(...c.gifKb) : null,
  gifMsP50: pct(c.gifMs, 0.5), gifMsP95: pct(c.gifMs, 0.95), gifMsMax: c.gifMs.length ? Math.max(...c.gifMs) : null,
})).sort((a, b) => (b.gifMsP95 ?? 0) - (a.gifMsP95 ?? 0));
const cmdRows = [...commands].map(([cmd, a]) => ({ command: cmd, n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a), over3s: a.filter((x) => x > 3000).length }))
  .sort((a, b) => b.p95 - a.p95);

console.log("Cards (KB and ms are GIF-only)");
console.table(cardRows);
console.log("Command totals (ms, from interaction received to command returned)");
console.table(cmdRows);
console.log("Events");
console.table(Object.fromEntries(events));
