// ==========================================================
// tools/repeat-report.mjs — would a render cache get hits?
//   ssh <vps> 'sudo journalctl -u pokebot -o short-iso --since …' | node tools/repeat-report.mjs
//   node tools/repeat-report.mjs <logfile>
// Reads "⚡ interactionCreate (slash) … user=<id> name=<command>" lines with
// their journal timestamps. For each card command, counts how often the same
// player ran it again within 5 / 15 / 60 minutes (the best case for a
// per-player cache: it can only hit if nothing on the card changed in
// between), and how many distinct players ran it.
// ==========================================================

import fs from "fs";

const CARD_COMMANDS = new Set(["showcard", "trainercard", "showbattlecard", "showteam", "showcase", "leaderboard", "pokedex", "inspectpokemon", "inspecttrainer", "daily", "challenge", "battle"]);
const text = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : fs.readFileSync(0, "utf8");
const runs = new Map(); // command -> [{ t, user }]
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^(\S+) .*interactionCreate \(slash\).* user=(\d+) name=(\S+)/);
  if (!m || !CARD_COMMANDS.has(m[3])) continue;
  const t = Date.parse(m[1]);
  if (Number.isNaN(t)) continue;
  const a = runs.get(m[3]) ?? [];
  a.push({ t, user: m[2] });
  runs.set(m[3], a);
}
const rows = [];
for (const [cmd, a] of runs) {
  const last = new Map();
  const within = { 5: 0, 15: 0, 60: 0 };
  for (const { t, user } of a.sort((x, y) => x.t - y.t)) {
    const prev = last.get(user);
    if (prev != null) for (const min of [5, 15, 60]) if (t - prev <= min * 60_000) within[min]++;
    last.set(user, t);
  }
  rows.push({ command: cmd, runs: a.length, players: last.size, "again ≤5m": within[5], "again ≤15m": within[15], "again ≤60m": within[60], "hit% ≤15m": Math.round((100 * within[15]) / a.length) });
}
console.table(rows.sort((x, y) => y.runs - x.runs));
