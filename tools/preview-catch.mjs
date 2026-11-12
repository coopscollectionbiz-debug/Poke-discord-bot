// ==========================================================
// tools/preview-catch.mjs — renders the random-catch card prototype for
// synthetic catches, in Discord context, and times it.
//   node tools/preview-catch.mjs [outDir]   (default docs/design/previews)
// ==========================================================
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { catchView, renderCatchCard } from "../utils/render/catchCard.js";
import { CATCH_FIXTURES } from "../tests/fixtures/showteamFixtures.js";

const out = path.resolve(process.argv[2] ?? "docs/design/previews");
const FONT = "'Segoe UI', 'DejaVu Sans', Arial, sans-serif";
const timings = {};
const imgs = [];
for (const [name, fx] of Object.entries(CATCH_FIXTURES)) {
  const v = catchView(fx.user, fx);
  let t = performance.now();
  const png = await renderCatchCard(v);
  timings[`${name}/png`] = { ms: Math.round(performance.now() - t), kb: Math.round(png.length / 1024) };
  t = performance.now();
  const gif = await renderCatchCard(v, { animate: true });
  timings[`${name}/gif`] = { ms: Math.round(performance.now() - t), kb: Math.round(gif.length / 1024) };
  fs.writeFileSync(path.join(out, `catch-${name}.png`), png);
  fs.writeFileSync(path.join(out, `catch-${name}.gif`), gif);
  imgs.push([fx, await loadImage(png)]);
}

// Discord context: the ping line, then the card as Discord shows it: its own
// size, capped at desktop (550) or phone (310) width. Discord never upscales.
for (const [label, w, cw] of [["desktop", 550, 700], ["phone", 310, 390]]) {
  const dw = (im) => Math.min(w, im.width);
  const rowH = imgs.map(([, im]) => Math.round((im.height * dw(im)) / im.width) + 78);
  const c = createCanvas(cw, rowH.reduce((a, b) => a + b, 24));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#313338";
  ctx.fillRect(0, 0, c.width, c.height);
  let y = 16;
  const x = cw === 390 ? 64 : 72;
  imgs.forEach(([fx, im], i) => {
    ctx.fillStyle = "#4f6bd8";
    ctx.beginPath();
    ctx.arc(x - 34, y + 22, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = "#f2f3f5";
    ctx.fillText("Coop's Collection", x, y + 16);
    ctx.font = `500 15px ${FONT}`;
    ctx.fillStyle = "#dbdee1";
    const shiny = fx.variant === "shiny" ? "a shiny " : "a wild ";
    ctx.fillText(`@${fx.trainerName.slice(0, 12)} caught ${shiny}${i === 1 ? "Dragonite" : i === 0 ? "Cubchoo" : "Giratina"}!`, x, y + 40);
    ctx.save();
    const iw = dw(im), h = Math.round((im.height * iw) / im.width);
    ctx.beginPath();
    ctx.roundRect(x, y + 52, iw, h, 8);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im, x, y + 52, iw, h);
    ctx.restore();
    y += rowH[i];
  });
  fs.writeFileSync(path.join(out, `catch-discord-${label}.png`), c.toBuffer("image/png"));
}
fs.writeFileSync(path.join(out, "catch-timings.json"), `${JSON.stringify(timings, null, 1)}\n`);
console.log(timings);
