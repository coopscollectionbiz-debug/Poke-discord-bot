// ==========================================================
// tools/preview-showteam.mjs — renders the /showteam layout candidates for
// synthetic players and times them. Never reads player data.
//
//   node tools/preview-showteam.mjs [outDir]     (default docs/design/previews)
//
// Writes <layout>-<fixture>.png for every layout × fixture, an animated GIF
// of the full team for every layout, and timings.json.
// ==========================================================

import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { buildTeamView } from "../utils/render/teamView.js";
import { renderShowteam, LAYOUTS } from "../utils/render/showteam.js";
import { FIXTURES } from "../tests/fixtures/showteamFixtures.js";
import { clearSpriteCacheForTesting } from "../utils/render/sprites.js";

const out = path.resolve(process.argv[2] ?? "docs/design/previews");
fs.mkdirSync(out, { recursive: true });

const timings = {};
const time = async (label, fn) => {
  const t0 = performance.now();
  const buf = await fn();
  const ms = Math.round(performance.now() - t0);
  timings[label] = { ms, bytes: buf.length };
  return buf;
};

for (const layout of Object.keys(LAYOUTS)) {
  for (const [name, fx] of Object.entries(FIXTURES)) {
    const view = buildTeamView(fx.user, { displayName: fx.displayName });
    clearSpriteCacheForTesting(); // cold: every sprite decoded from disk
    const png = await time(`${layout}/${name}/png-cold`, () => renderShowteam(view, { layout }));
    fs.writeFileSync(path.join(out, `${layout}-${name}.png`), png);
    if (name === "full") {
      await time(`${layout}/${name}/png-warm`, () => renderShowteam(view, { layout }));
      const gif = await time(`${layout}/${name}/gif`, () => renderShowteam(view, { layout, animate: true }));
      fs.writeFileSync(path.join(out, `${layout}-${name}.gif`), gif);
    }
  }
}
timings.rssMB = Math.round(process.memoryUsage().rss / 1048576);
fs.writeFileSync(path.join(out, "timings.json"), `${JSON.stringify(timings, null, 1)}\n`);
console.log(timings);

// Readability sheet: each layout's full Team as Discord shows it, scaled
// down by the client (~550 px wide on desktop, ~360 px on a phone).
import { createCanvas, loadImage } from "@napi-rs/canvas";
{
  const widths = [550, 360];
  const layouts = Object.keys(LAYOUTS);
  const sheet = createCanvas(widths.reduce((a, b) => a + b + 24, 24), layouts.length * 400 + 24);
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#313338"; // Discord's dark chat background
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (const [r, layout] of layouts.entries()) {
    const img = await loadImage(fs.readFileSync(path.join(out, `${layout}-full.png`)));
    let x = 24;
    for (const w of widths) {
      const h = Math.round((img.height * w) / img.width);
      ctx.drawImage(img, x, 24 + r * 400, w, h);
      x += w + 24;
    }
  }
  fs.writeFileSync(path.join(out, "readability-sheet.png"), sheet.toBuffer("image/png"));
}
