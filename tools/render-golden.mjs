// ==========================================================
// tools/render-golden.mjs — proves a render change leaves every image the same.
//   node tools/render-golden.mjs out.json            render the fixed set, write hashes
//   node tools/render-golden.mjs --compare a.json b.json
//
// Renders a fixed set of cards and battle frames (animated), decodes each
// GIF and hashes every composited frame (what Discord shows), plus each
// frame's delay and the frame count; a PNG is hashed as its bytes. Run it
// on master and on a branch on the same machine: identical hashes mean the
// images look identical, frame for frame, whatever the file bytes are.
// Also prints each render's time and file size, so the same run shows the
// speed and size change.
// ==========================================================

import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { performance } from "perf_hooks";
import omggif from "omggif";

const { GifReader } = omggif;
const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

/** Every composited frame of a GIF, hashed, with its delay. PNGs hash as bytes. */
export function imageDigest(buf) {
  if (buf.subarray(0, 3).toString() !== "GIF") return { type: "png", hash: sha(buf) };
  const r = new GifReader(new Uint8Array(buf));
  const px = new Uint8Array(r.width * r.height * 4);
  const frames = [];
  for (let i = 0; i < r.numFrames(); i++) {
    const info = r.frameInfo(i);
    r.decodeAndBlitFrameRGBA(i, px);
    frames.push(`${info.delay}:${sha(px)}`);
  }
  return { type: "gif", w: r.width, h: r.height, frames };
}

async function cases() {
  const { RENDERERS } = await import("../utils/render/renderers.js");
  const { renderBattleFrame, pickFrameTurns } = await import("../utils/battle/render.js");
  const { buildTeamView } = await import("../utils/render/teamView.js");
  const { trainerCardView } = await import("../utils/render/trainerCard.js");
  const { leaderboardView } = await import("../utils/render/leaderboardCard.js");
  const { rankBattleRatings } = await import("../commands/leaderboard.js");
  const { simulateBattle } = await import("../utils/battle/sim.js");
  const { PLAYBACK } = await import("../utils/battle/tuning.js");
  const { FIXTURES, leaderboardWorld } = await import("../tests/fixtures/showteamFixtures.js");

  const TRAINER = "acerola.png";
  const player = { ...JSON.parse(JSON.stringify(FIXTURES.full.user)), tp: 8308, cc: 5400, displayedTrainer: TRAINER };
  const view = buildTeamView(player, { displayName: "Coop", trainerFile: TRAINER });
  const td = leaderboardWorld();
  const mon = (speciesId, name, variant = "normal", extra = {}) => ({ speciesId, level: 50, variant, name, ...extra });
  const sides = [
    { name: "Ash", members: [mon(6, "Charizard"), mon(25, "Pikachu", "shiny"), mon(3, "Venusaur"), mon(130, "Gyarados"), mon(94, "Gengar"), mon(143, "Snorlax", "normal", { levelUp: true })] },
    { name: "Gary", members: [mon(9, "Blastoise"), mon(65, "Alakazam"), mon(59, "Arcanine"), mon(112, "Rhydon"), mon(103, "Exeggutor"), mon(18, "Pidgeot", "shiny")] },
  ];
  const { snapshots, log, turns } = simulateBattle({ sides, seed: 12345 });
  const picked = pickFrameTurns(turns, PLAYBACK.maxUpdates);
  const trainers = ["acerola-masters.png", "brock-gen3.png"];
  const brock = { type: "Rock", badgeFile: "boulder.png" };
  const sprites = new Map();
  const battle = (o) => () => renderBattleFrame({ sides, sprites, ...o });
  const last = snapshots[turns];
  const winner = last[0].some((h) => h > 0) ? 0 : 1;

  return {
    "showteam refined": () => RENDERERS.showteam(view, { layout: "refined", animate: true }),
    "showteam png": () => RENDERERS.showteam(view, { layout: "refined", animate: false }),
    "trainer card": () => RENDERERS.trainerCard(trainerCardView(player, { displayName: "Coop", trainer: { name: "Acerola", tier: "epic" } }), { animate: true }),
    "leaderboard": () => RENDERERS.leaderboard(leaderboardView(rankBattleRatings(td, "p6"), td, "p6"), { animate: true }),
    ...Object.fromEntries(view.slots.slice(0, 3).map((s, i) => [`inspect ${i + 1}`, () => RENDERERS.inspect(s, { owner: "Coop", animate: true })])),
    "battle start": battle({ hpBefore: snapshots[0], screens: [["The battle begins!", "Charizard and Blastoise lead off."]] }),
    "battle start themed": battle({ hpBefore: snapshots[0], screens: [["The battle begins!", ""]], trainers, theme: brock }),
    ...Object.fromEntries(picked.map((t) => [`battle turn ${t}`, battle({ hpBefore: snapshots[t - 1], events: log[t - 1], badge: `TURN ${t}`, surgeSide: t > turns / 2 ? 1 : null })])),
    "battle turn themed": battle({ hpBefore: snapshots[picked[1] - 1], events: log[picked[1] - 1], badge: `TURN ${picked[1]}`, trainers, theme: brock }),
    "battle final": battle({ hpBefore: last, badge: "FINAL", winnerSide: winner, screens: [["Ash won!", ""], ["Snorlax grew to Lv51!", "It learned Body Slam."]] }),
    "battle final award": battle({ hpBefore: last, badge: "FINAL", winnerSide: winner, trainers, screens: [["Ash defeated Brock!", ""], ["Ash received the Boulder Badge!", ""]], theme: { ...brock, award: { screen: 1, badgeFile: "boulder.png", title: "BOULDER BADGE" } } }),
    "battle final title": battle({ hpBefore: last, badge: "FINAL", winnerSide: winner, trainers, screens: [["Ash won!", ""], ["Elite Four cleared!", ""]], theme: { ...brock, badgeFile: null, award: { screen: 1, badgeFile: null, title: "ELITE FOUR CLEARED" } } }),
  };
}

async function run(out) {
  const result = {};
  const list = await cases();
  for (const [name, render] of Object.entries(list)) await render(); // warm sprite caches
  let totalMs = 0, totalBytes = 0;
  for (const [name, render] of Object.entries(list)) {
    const t = performance.now();
    const buf = await render();
    const ms = performance.now() - t;
    totalMs += ms;
    totalBytes += buf.length;
    result[name] = { ...imageDigest(buf), ms: Math.round(ms), bytes: buf.length };
    console.log(`${name.padEnd(22)} ${String(Math.round(ms)).padStart(5)} ms ${String(Math.round(buf.length / 1024)).padStart(5)} KB  ${result[name].frames?.length ?? "png"}`);
  }
  console.log(`${"total".padEnd(22)} ${String(Math.round(totalMs)).padStart(5)} ms ${String(Math.round(totalBytes / 1024)).padStart(5)} KB`);
  writeFileSync(out, JSON.stringify(result, null, 1));
}

function compare(a, b) {
  const A = JSON.parse(readFileSync(a, "utf8")), B = JSON.parse(readFileSync(b, "utf8"));
  let bad = 0, ms = [0, 0], kb = [0, 0];
  for (const name of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[name], y = B[name];
    const same = x && y && x.type === y.type && x.hash === y.hash && x.w === y.w && x.h === y.h && JSON.stringify(x.frames) === JSON.stringify(y.frames);
    if (!same) {
      bad++;
      const diff = x?.frames && y?.frames ? x.frames.findIndex((f, i) => f !== y.frames[i]) : -1;
      console.log(`✗ ${name}${diff >= 0 ? ` (first different frame ${diff} of ${x.frames.length}/${y.frames.length})` : ""}`);
    } else console.log(`✓ ${name.padEnd(22)} ${String(x.ms).padStart(5)} → ${String(y.ms).padStart(5)} ms  ${String(Math.round(x.bytes / 1024)).padStart(5)} → ${String(Math.round(y.bytes / 1024)).padStart(5)} KB`);
    if (x && y) { ms[0] += x.ms; ms[1] += y.ms; kb[0] += x.bytes / 1024; kb[1] += y.bytes / 1024; }
  }
  console.log(`total ${ms[0]} → ${ms[1]} ms, ${Math.round(kb[0])} → ${Math.round(kb[1])} KB`);
  console.log(bad ? `${bad} image(s) differ` : "every image identical, frame for frame");
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[2] === "--compare") compare(process.argv[3], process.argv[4]);
else if (process.argv[2]) await run(process.argv[2]);
else console.log("usage: node tools/render-golden.mjs out.json | --compare a.json b.json");
