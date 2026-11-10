// ==========================================================
// tools/preview-refined.mjs — the refined A/B /showteam prototype in
// Discord context, plus an A / B / refined comparison sheet. Synthetic
// data only (tests/fixtures/showteamFixtures.js).
//
//   node tools/preview-refined.mjs [outDir]    (default docs/design/previews)
//
// Viewing assumptions (Discord does not publish these; measured from the
// client's layout and stated in SHOWTEAM-REDESIGN.md):
//   desktop: a single image attachment is shown up to 550 CSS px wide
//   phone:   390 px screen; messages start after the 40 px avatar column,
//            leaving ~310 CSS px for the image
// Scaling uses high-quality smoothing, as browsers do.
// ==========================================================

import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildTeamView } from "../utils/render/teamView.js";
import { renderShowteam } from "../utils/render/showteam.js";
import { FIXTURES } from "../tests/fixtures/showteamFixtures.js";

const out = path.resolve(process.argv[2] ?? "docs/design/previews");
fs.mkdirSync(out, { recursive: true });
export const DESKTOP_W = 550, PHONE_W = 310;
const FONT = "'Segoe UI', 'DejaVu Sans', Arial, sans-serif";
const fx = FIXTURES.full;
const view = buildTeamView(fx.user, { displayName: fx.displayName });

const png = await renderShowteam(view, { layout: "refined" });
fs.writeFileSync(path.join(out, "hybrid-ab-refined-full.png"), png);
fs.writeFileSync(path.join(out, "hybrid-ab-refined-full.gif"), await renderShowteam(view, { layout: "refined", animate: true }));
for (const name of ["partial", "stress", "fallback", "empty"]) {
  const v = buildTeamView(FIXTURES[name].user, { displayName: FIXTURES[name].displayName });
  fs.writeFileSync(path.join(out, `hybrid-ab-refined-${name}.png`), await renderShowteam(v, { layout: "refined" }));
}

function scaled(ctx, img, x, y, w, radius = 8) {
  const h = Math.round((img.height * w) / img.width);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  return h;
}

/** A generic dark chat message: reply line, avatar, bot name, then the image. */
function chatMessage(ctx, img, { x, y, avatar, nameSize, imgW, dpr = 1 }) {
  const s = (v) => v * dpr;
  ctx.fillStyle = "#949ba4";
  ctx.font = `500 ${s(nameSize - 2)}px ${FONT}`;
  ctx.fillText("↳ Coop used /showteam", x + s(avatar + 12), y + s(14));
  const top = y + s(24);
  ctx.fillStyle = "#4f6bd8";
  ctx.beginPath();
  ctx.arc(x + s(avatar / 2), top + s(avatar / 2), s(avatar / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${s(avatar * 0.45)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("CC", x + s(avatar / 2), top + s(avatar * 0.64));
  ctx.textAlign = "left";
  const nx = x + s(avatar + 12);
  ctx.font = `700 ${s(nameSize)}px ${FONT}`;
  ctx.fillStyle = "#f2f3f5";
  ctx.fillText("Coop's Collection", nx, top + s(nameSize));
  const nw = ctx.measureText("Coop's Collection").width;
  ctx.fillStyle = "#5865f2";
  ctx.beginPath();
  ctx.roundRect(nx + nw + s(6), top + s(nameSize * 0.2), s(30), s(nameSize * 0.95), s(4));
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${s(nameSize * 0.62)}px ${FONT}`;
  ctx.fillText("APP", nx + nw + s(10), top + s(nameSize * 0.9));
  ctx.fillStyle = "#949ba4";
  ctx.font = `500 ${s(nameSize * 0.8)}px ${FONT}`;
  ctx.fillText("Today at 8:06 PM", nx + nw + s(44), top + s(nameSize * 0.9));
  return top + s(nameSize + 8) + scaled(ctx, img, nx, top + s(nameSize + 8), s(imgW), s(8));
}

const img = await loadImage(png);

// Desktop: a chat column wide enough for the 550 px attachment.
{
  const c = createCanvas(700, 40 + 24 + 28 + Math.round((img.height * DESKTOP_W) / img.width) + 40);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#313338";
  ctx.fillRect(0, 0, c.width, c.height);
  chatMessage(ctx, img, { x: 20, y: 24, avatar: 40, nameSize: 16, imgW: DESKTOP_W });
  fs.writeFileSync(path.join(out, "hybrid-ab-refined-desktop.png"), c.toBuffer("image/png"));
}

// Phone: a 390 × 844 screen drawn at 2× pixel density (phones are 2–3×),
// so the preview is as sharp as a phone shows it; sizes are CSS px × 2.
{
  const dpr = 2, Wp = 390 * dpr, Hp = 844 * dpr;
  const c = createCanvas(Wp, Hp);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a1a1e";
  ctx.fillRect(0, 0, Wp, Hp);
  ctx.fillStyle = "#f2f3f5";
  ctx.font = `600 ${15 * dpr}px ${FONT}`;
  ctx.fillText("8:06", 28 * dpr, 34 * dpr);
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 50 * dpr, Wp, 52 * dpr);
  ctx.fillStyle = "#f2f3f5";
  ctx.font = `700 ${17 * dpr}px ${FONT}`;
  ctx.fillText("#  pokemon-chat", 16 * dpr, 83 * dpr);
  chatMessage(ctx, img, { x: 16 * dpr, y: 118 * dpr, avatar: 40, nameSize: 15, imgW: PHONE_W, dpr });
  // Message bar.
  ctx.fillStyle = "#2b2d31";
  ctx.beginPath();
  ctx.roundRect(56 * dpr, Hp - 76 * dpr, Wp - 72 * dpr, 42 * dpr, 21 * dpr);
  ctx.fill();
  ctx.fillStyle = "#6d6f78";
  ctx.font = `500 ${15 * dpr}px ${FONT}`;
  ctx.fillText("Message #pokemon-chat", 74 * dpr, Hp - 49 * dpr);
  fs.writeFileSync(path.join(out, "hybrid-ab-refined-phone.png"), c.toBuffer("image/png"));
}

// Comparison sheet: A, B and refined, same team, each at Discord desktop
// and phone display width, at 1 CSS px = 1 sheet px (true perceived size).
{
  const rows = [["A — Grid (original)", "grid"], ["B — Roster (original)", "roster"], ["A/B Hybrid (refined)", "refined"]];
  const imgs = [];
  for (const [, layout] of rows) imgs.push(await loadImage(await renderShowteam(view, { layout })));
  const rowH = imgs.map((im) => Math.round((im.height * DESKTOP_W) / im.width));
  const c = createCanvas(24 + DESKTOP_W + 32 + PHONE_W + 24, rowH.reduce((a, b) => a + b + 64, 56) + 8);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#313338";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#b5bac1";
  ctx.font = `700 14px ${FONT}`;
  ctx.fillText(`Discord desktop (${DESKTOP_W} px)`, 24, 30);
  ctx.fillText(`Discord phone (${PHONE_W} px)`, 24 + DESKTOP_W + 32, 30);
  let y = 56;
  rows.forEach(([label], i) => {
    ctx.fillStyle = "#f2f3f5";
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(label, 24, y + 16);
    scaled(ctx, imgs[i], 24, y + 28, DESKTOP_W);
    scaled(ctx, imgs[i], 24 + DESKTOP_W + 32, y + 28, PHONE_W);
    y += rowH[i] + 64;
  });
  fs.writeFileSync(path.join(out, "comparison-a-b-refined.png"), c.toBuffer("image/png"));
}
console.log("written to", out);
