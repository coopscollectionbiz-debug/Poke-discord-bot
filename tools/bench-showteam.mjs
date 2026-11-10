// ==========================================================
// tools/bench-showteam.mjs — /showteam prototype benchmark.
// Each layout runs in its own fresh Node process (so peak memory and the
// cold sprite cache are per layout), on the same synthetic "full" Team.
//
//   node tools/bench-showteam.mjs [layout ...]   (default: grid roster refined)
//
// Reports: cold static (sprites decoded from disk), warm static (median of
// 5), animated GIF (median of 3, 24 frames × 100 ms), output sizes, sprite
// load timings, and peak RSS above the post-import baseline.
// ==========================================================

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

if (process.argv[2] === "--child") {
  const layout = process.argv[3];
  const { buildTeamView } = await import("../utils/render/teamView.js");
  const { renderShowteam } = await import("../utils/render/showteam.js");
  const { loadStaticSprite, clearSpriteCacheForTesting } = await import("../utils/render/sprites.js");
  const { loadSprite } = await import("../utils/battle/render.js");
  const { FIXTURES } = await import("../tests/fixtures/showteamFixtures.js");
  const { GifReader } = await import("omggif");
  const view = buildTeamView(FIXTURES.full.user, { displayName: "Coop" });
  const baseRss = process.memoryUsage().rss;

  let t = performance.now();
  await Promise.all(view.slots.map((s) => loadStaticSprite(s.id, s.variant)));
  const spriteStaticMs = performance.now() - t;
  t = performance.now();
  await Promise.all(view.slots.map((s) => loadSprite(s.variant, s.id)));
  const spriteAnimMs = performance.now() - t;
  clearSpriteCacheForTesting();

  t = performance.now();
  const png = await renderShowteam(view, { layout });
  const coldMs = performance.now() - t;
  const warm = [];
  for (let i = 0; i < 5; i++) { t = performance.now(); await renderShowteam(view, { layout }); warm.push(performance.now() - t); }
  const gifs = [];
  let gif;
  for (let i = 0; i < 3; i++) { t = performance.now(); gif = await renderShowteam(view, { layout, animate: true }); gifs.push(performance.now() - t); }
  const peakRss = process.resourceUsage().maxRSS * 1024;
  console.log(JSON.stringify({
    layout,
    staticColdMs: Math.round(coldMs),
    staticWarmMs: Math.round(median(warm)),
    gifMs: Math.round(median(gifs)),
    pngKB: Math.round(png.length / 1024),
    gifKB: Math.round(gif.length / 1024),
    frames: new GifReader(gif).numFrames(),
    size: `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,
    spriteLoadStaticMs: Math.round(spriteStaticMs),
    spriteLoadAnimMs: Math.round(spriteAnimMs),
    baseRssMB: Math.round(baseRss / 1048576),
    peakRssMB: Math.round(peakRss / 1048576),
    peakAboveBaseMB: Math.round((peakRss - baseRss) / 1048576),
  }));
} else {
  const layouts = process.argv.slice(2).length ? process.argv.slice(2) : ["grid", "roster", "refined"];
  const rows = layouts.map((l) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", l], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  });
  console.table(rows);
  console.log(JSON.stringify(rows, null, 1));
}
