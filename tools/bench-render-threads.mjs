// ==========================================================
// tools/bench-render-threads.mjs — how many render threads the host can use.
//   node tools/bench-render-threads.mjs [threads ...]   (default: 0 1 2 3 4 6 8)
//
// Renders one burst of animated images, all requested at the same moment
// (4 /showteam, 4 /trainercard, 2 /leaderboard GIFs and 6 battle turns: a
// busy minute's worth), after one warm-up burst so sprite caches are full.
// 0 threads renders on the main thread (RENDER_THREADS=0); N > 0 sends the
// jobs to the bot's own render pool (utils/render/renderPool.js) with N
// threads. Each thread count runs in a fresh Node.
//
// Reports per thread count:
//   burst ms     — wall time until the last image of the burst is done
//   p50/p95 ms   — time each image waited + rendered (request → buffer)
//   lag p99/max  — main-thread event-loop delay during the burst: how long
//                  any other command or button would have stalled
//   cores        — CPU the bot process used during the burst (cpu ms / wall ms)
//   host idle %  — whole-machine idle during the burst (Linux /proc/stat),
//                  so other services' share shows up too
//   rss / peak   — resident memory after warm-up, and peak for the process
// ==========================================================

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { performance, monitorEventLoopDelay } from "perf_hooks";

const SELF = fileURLToPath(import.meta.url);
const BURST = [
  ...Array(4).fill({ kind: "showteam" }),
  ...Array(4).fill({ kind: "trainercard" }),
  ...Array(2).fill({ kind: "leaderboard" }),
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ kind: "battle", turn: i })),
];

// ---- the burst's jobs, as the bot sends them (renderer name + plain data) ----
async function makeJobs() {
  const { buildTeamView } = await import("../utils/render/teamView.js");
  const { trainerCardView } = await import("../utils/render/trainerCard.js");
  const { leaderboardView } = await import("../utils/render/leaderboardCard.js");
  const { rankBattleRatings } = await import("../commands/leaderboard.js");
  const { simulateBattle } = await import("../utils/battle/sim.js");
  const { pickFrameTurns } = await import("../utils/battle/render.js");
  const { PLAYBACK } = await import("../utils/battle/tuning.js");
  const { FIXTURES, leaderboardWorld } = await import("../tests/fixtures/showteamFixtures.js");

  const TRAINER = "acerola.png"; // Epic: breathes and blinks
  const player = { ...JSON.parse(JSON.stringify(FIXTURES.full.user)), tp: 8308, cc: 5400, displayedTrainer: TRAINER };
  const td = leaderboardWorld();
  const mon = (speciesId, name, variant = "normal") => ({ speciesId, level: 50, variant, name });
  const sides = [
    { name: "Ash", members: [mon(6, "Charizard"), mon(25, "Pikachu", "shiny"), mon(3, "Venusaur"), mon(130, "Gyarados"), mon(94, "Gengar"), mon(143, "Snorlax")] },
    { name: "Gary", members: [mon(9, "Blastoise"), mon(65, "Alakazam"), mon(59, "Arcanine"), mon(112, "Rhydon"), mon(103, "Exeggutor"), mon(18, "Pidgeot", "shiny")] },
  ];
  const { snapshots, log, turns } = simulateBattle({ sides, seed: 12345 });
  const picked = pickFrameTurns(turns, PLAYBACK.maxUpdates);
  const make = {
    showteam: () => ["showteam", [buildTeamView(player, { displayName: "Coop", trainerFile: TRAINER }), { layout: "refined", animate: true }]],
    trainercard: () => ["trainerCard", [trainerCardView(player, { displayName: "Coop", trainer: { name: "Acerola", tier: "epic" } }), { animate: true }]],
    leaderboard: () => ["leaderboard", [leaderboardView(rankBattleRatings(td, "p6"), td, "p6"), { animate: true }]],
    battle: (job) => {
      const turn = picked[job.turn % picked.length];
      return ["battleFrame", [{ sides, hpBefore: snapshots[turn - 1], events: log[turn - 1], badge: `TURN ${turn}` }]];
    },
  };
  return BURST.map((job) => make[job.kind](job));
}

if (process.argv[2] === "--child") {
  await runChild(Number(process.argv[3]));
} else {
  runParent(process.argv.slice(2).map(Number));
}

// ---- one thread count, in its own process -----------------------------
function cpuTimes() {
  try {
    const f = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
    return { idle: f[3] + f[4], total: f.reduce((a, b) => a + b, 0) };
  } catch {
    return null;
  }
}

async function runChild(threads) {
  const jobs = await makeJobs();
  let render, close = async () => {};
  if (threads === 0) {
    // Today's bot: renders are awaited on the main thread; a burst queues behind the CPU.
    const { RENDERERS } = await import("../utils/render/renderers.js");
    const { renderBattleFrame } = await import("../utils/battle/render.js");
    const sprites = new Map();
    const direct = { ...RENDERERS, battleFrame: (o) => renderBattleFrame({ ...o, sprites }) };
    render = ([name, args]) => direct[name](...args);
  } else {
    const { createRenderPool } = await import("../utils/render/renderPool.js");
    const pool = createRenderPool({ size: threads, log: () => {} });
    render = ([name, args]) => pool.run(name, args);
    close = pool.close;
  }

  const burst = async () => {
    const t0 = performance.now();
    const times = await Promise.all(jobs.map(async (job) => {
      const s = performance.now();
      const buf = await render(job);
      if (!buf?.length) throw new Error(`empty image for ${job[0]}`);
      return performance.now() - s;
    }));
    return { wall: performance.now() - t0, times };
  };

  // Warm-up: fill each thread's sprite cache (repeat so every worker sees every kind).
  for (let i = 0; i < Math.max(1, Math.ceil(threads / 2)); i++) await burst();
  const rss = process.memoryUsage().rss;

  const lag = monitorEventLoopDelay({ resolution: 10 });
  const host0 = cpuTimes();
  const cpu0 = process.cpuUsage();
  lag.enable();
  const { wall, times } = await burst();
  lag.disable();
  const cpu = process.cpuUsage(cpu0);
  const host1 = cpuTimes();
  await close();

  const sorted = times.sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mb = (b) => Math.round(b / 1048576);
  console.log(JSON.stringify({
    threads,
    "burst ms": Math.round(wall),
    "p50 ms": Math.round(pct(0.5)),
    "p95 ms": Math.round(pct(0.95)),
    "lag p99 ms": Math.round(lag.percentile(99) / 1e6),
    "lag max ms": Math.round(lag.max / 1e6),
    cores: +(((cpu.user + cpu.system) / 1000) / wall).toFixed(2),
    "host idle %": host0 && host1 ? Math.round((100 * (host1.idle - host0.idle)) / (host1.total - host0.total)) : null,
    "rss MB": mb(rss),
    "peak MB": mb(process.resourceUsage().maxRSS * 1024),
  }));
}

function runParent(counts) {
  const list = counts.length ? counts : [0, 1, 2, 3, 4, 6, 8];
  const rows = [];
  for (const n of list) {
    const out = spawnSync(process.execPath, [SELF, "--child", String(n)], { encoding: "utf8", maxBuffer: 1 << 24 });
    const line = out.stdout.trim().split("\n").pop();
    try {
      rows.push(JSON.parse(line));
    } catch {
      console.error(`threads=${n} failed:\n${out.stderr || out.stdout}`);
    }
  }
  console.log(`burst: ${BURST.length} animated images requested at once`);
  console.table(rows);
}
