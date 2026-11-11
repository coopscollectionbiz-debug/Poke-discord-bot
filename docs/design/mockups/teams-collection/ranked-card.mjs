// ==========================================================
// Design mockup: two options for /showbattlecard (the Battle team card).
// Built from the existing image renderer pieces (utils/render: tokens,
// primitives, sprites, stage). Synthetic data only; NOT wired to any
// command. Writes docs/design/previews/redesign-ranked-card-{1,2}.png.
//   node docs/design/mockups/teams-collection/ranked-card.mjs
// ==========================================================
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createCanvas } = await import(pathToFileURL(path.join(repo, "node_modules/@napi-rs/canvas/index.js")).href);
const { COLOR, TIER } = await imp("utils/render/tokens.js");
const P = await imp("utils/render/primitives.js");
const { loadStaticSprite, loadTrainerSprite, loadPlaceholder, drawSprite } = await imp("utils/render/sprites.js");
const { getSpecies, TYPE_ID_TO_NAME } = await imp("utils/battle/data.js");
const { pokemonPower } = await imp("utils/battle/power.js");

// ---- Synthetic view (the shape a real battleCardView would return) ----
const raw = JSON.parse(fs.readFileSync(path.join(repo, "public/pokemonData.json"), "utf8"));
const POK = Object.fromEntries((Array.isArray(raw) ? raw : Object.values(raw)).map((p) => [p.id, p]));
const member = (id, variant, realLevel, mega = null, megaName = null) => ({
  id, spriteId: mega ?? id, variant, shiny: variant === "shiny", realLevel, level: 50,
  name: megaName ?? POK[id].name, mega: !!mega, tier: POK[id].tier,
  types: (getSpecies(id)?.types ?? POK[id].types.map((t) => TYPE_ID_TO_NAME[t])),
});
const view = {
  displayName: "SyntheticAsh",
  trainerFile: "aaron.png",
  rank: "Experienced Trainer", // TP rank (unchanged)
  rating: 1284, wins: 23, losses: 9, position: 4, players: 212, streak: 3,
  team: [
    member(6, "normal", 58, "mega-charizard-x", "Mega Charizard X"),
    member(94, "normal", 41),
    member(150, "normal", 70),
    member(25, "shiny", 34),
    member(149, "normal", 55),
    member(445, "normal", 57),
  ],
};
view.power50 = view.team.reduce((s, m) => s + pokemonPower(m.id, 50), 0);
const fmt = (n) => Number(n).toLocaleString("en-US");
const winPct = (w, l) => Math.round((100 * w) / (w + l));

function label(ctx, text, x, y, color = COLOR.textFaint, size = 15) {
  ctx.font = P.font(size, 800);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

async function slot(ctx, m, x, y, w, h, i, { compact = false } = {}) {
  const ring = m.shiny ? COLOR.gold : i === 0 ? COLOR.blue : m.mega ? COLOR.mega : null;
  P.drawCard(ctx, x, y, w, h, { fill: "#1a2135", stroke: "#323c5c", ring, radius: 14, shadow: false });
  const cx = x + w / 2, floor = y + h - (compact ? 88 : 104);
  P.drawPlatform(ctx, cx, floor, w * 0.32, 12, i === 0 ? COLOR.blue : null);
  const sp = (await loadStaticSprite(m.spriteId, m.variant)) ?? (await loadPlaceholder());
  drawSprite(ctx, sp, cx, floor + 4, w - 24, floor - y - 14, { scale: 2 });
  P.drawSlotBadge(ctx, i + 1, x + 22, y + 22, { r: 14, lead: i === 0 });
  let tx = x + w - 10;
  if (m.shiny) { P.drawShinyMark(ctx, tx - 12, y + 22, 9); tx -= 32; }
  if (m.mega) tx -= P.drawMegaTag(ctx, tx, y + 10, { h: 22, size: 12, align: "right" }) + 6;
  if (m.tier === "mythic") P.drawTag(ctx, "MYTHIC", x + 42, y + 10, { fill: TIER.mythic, color: "#fff", h: 22, size: 12 });
  ctx.textAlign = "center";
  const nm = P.fitFont(ctx, m.name, w - 16, 20, 14, 800);
  ctx.font = P.font(nm.size, 800);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(nm.text, cx, floor + 36);
  ctx.textAlign = "left";
  // "Lv 50" large, the real Level small beside it.
  const lw = P.levelWidth(ctx, 50, 24);
  ctx.font = P.font(18, 700);
  const real = `(Lv ${m.realLevel})`;
  const rw = ctx.measureText(real).width;
  const lx = cx - (lw + 8 + rw) / 2;
  P.drawLevel(ctx, 50, lx, floor + 64, { size: 24, color: COLOR.blue });
  ctx.font = P.font(18, 700);
  ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(real, lx + lw + 8, floor + 64);
  if (!compact) {
    const tw = P.typeChipsWidth(ctx, m.types, { h: 24, size: 14, gap: 6 });
    P.drawTypeChips(ctx, m.types, cx - tw / 2, floor + 76, { h: 24, size: 14, gap: 6 });
  }
}

function statTile(ctx, title, value, x, y, w, h, color = COLOR.text, sub = null) {
  P.drawCard(ctx, x, y, w, h, { fill: "#1a2135", stroke: "#323c5c", radius: 14, shadow: false });
  label(ctx, title, x + 16, y + 28);
  const v = P.fitFont(ctx, value, w - 32, 34, 20, 800);
  ctx.font = P.font(v.size, 800);
  ctx.fillStyle = color;
  ctx.fillText(v.text, x + 16, y + 68);
  if (sub) label(ctx, sub, x + 16, y + h - 14, COLOR.textMuted, 14);
}

// ---------- Option 1: trainer-card layout ----------
async function option1() {
  const W = 1200, H = 680, M = 20, LW = 340;
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  P.drawBackground(ctx, W, H);
  // Left: ranked identity.
  P.drawCard(ctx, M, M, LW, H - 2 * M, { fill: "#171d30", stroke: "#4f8cff88", radius: 18, shadow: false });
  const cx = M + LW / 2;
  const glow = ctx.createRadialGradient(cx, 190, 10, cx, 190, 200);
  glow.addColorStop(0, "#4f8cff30"); glow.addColorStop(1, "#4f8cff00");
  ctx.fillStyle = glow; ctx.fillRect(M, M, LW, 360);
  P.drawPlatform(ctx, cx, 300, 110, 20, COLOR.blue);
  const t = await loadTrainerSprite(view.trainerFile);
  if (t) drawSprite(ctx, t, cx, 306, LW - 60, 250, { scale: 3 });
  ctx.textAlign = "center";
  ctx.textAlign = "center";
  ctx.font = P.font(15, 800); ctx.fillStyle = COLOR.textFaint; ctx.fillText("RANKED RATING", cx, 360);
  ctx.font = P.font(64, 800); ctx.fillStyle = COLOR.gold; ctx.fillText(fmt(view.rating), cx, 426);
  ctx.font = P.font(22, 800); ctx.fillStyle = COLOR.text; ctx.fillText(`#${view.position} of ${view.players}`, cx, 464);
  ctx.font = P.font(15, 700); ctx.fillStyle = COLOR.textMuted; ctx.fillText("on the ranked leaderboard", cx, 488);
  ctx.textAlign = "left";
  const bw = (LW - 3 * 12) / 2;
  statTile(ctx, "RECORD", `${view.wins}W–${view.losses}L`, M + 12, 516, bw, 124, COLOR.text, `${winPct(view.wins, view.losses)}% wins`);
  statTile(ctx, "STREAK", `W${view.streak}`, M + 24 + bw, 516, bw, 124, COLOR.green ?? "#3fd46c", "ranked wins in a row");
  // Right: name, rank, team at Lv 50.
  const rx = M + LW + 24, rw = W - rx - M;
  label(ctx, "BATTLE TEAM", rx, M + 26);
  const nm = P.fitFont(ctx, view.displayName, rw - 260, 44, 28, 800);
  ctx.font = P.font(nm.size, 800); ctx.fillStyle = COLOR.text; ctx.fillText(nm.text, rx, M + 72);
  ctx.font = P.font(22, 800); ctx.fillStyle = COLOR.gold; ctx.fillText(view.rank, rx, M + 106);
  ctx.textAlign = "right";
  P.drawTag(ctx, "ALL LV 50", W - M - 120, M + 14, { fill: COLOR.blue, color: "#fff", h: 30, size: 15 });
  ctx.textAlign = "right"; ctx.font = P.font(16, 700); ctx.fillStyle = COLOR.textMuted;
  ctx.fillText(`Power at Lv 50: ${fmt(view.power50)}`, W - M, M + 106);
  ctx.textAlign = "left";
  const gy = M + 128, gap = 12, sw = (rw - 2 * gap) / 3, sh = (H - M - gy - gap) / 2;
  for (let i = 0; i < 6; i++) await slot(ctx, view.team[i], rx + (i % 3) * (sw + gap), gy + Math.floor(i / 3) * (sh + gap), sw, sh, i);
  return c.toBuffer("image/png");
}

// ---------- Option 2: banner + team row ----------
async function option2() {
  const W = 1200, H = 560, M = 20;
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  P.drawBackground(ctx, W, H);
  // Banner.
  P.drawCard(ctx, M, M, W - 2 * M, 190, { fill: "#171d30", stroke: "#4f8cff88", radius: 18, shadow: false });
  const t = await loadTrainerSprite(view.trainerFile);
  P.drawPlatform(ctx, M + 90, M + 168, 62, 12, COLOR.blue);
  if (t) drawSprite(ctx, t, M + 90, M + 172, 150, 160, { scale: 2 });
  const bx = M + 190;
  label(ctx, "RANKED BATTLE CARD", bx, M + 34);
  const nm = P.fitFont(ctx, view.displayName, 420, 42, 26, 800);
  ctx.font = P.font(nm.size, 800); ctx.fillStyle = COLOR.text; ctx.fillText(nm.text, bx, M + 80);
  ctx.font = P.font(20, 800); ctx.fillStyle = COLOR.gold; ctx.fillText(view.rank, bx, M + 110);
  // Rating block (right).
  const rx = W - M - 360;
  ctx.fillStyle = "#0c111e"; P.rr(ctx, rx, M + 18, 340, 154, 14); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#f5c84c66"; ctx.stroke();
  label(ctx, "RATING", rx + 20, M + 48);
  ctx.font = P.font(60, 800); ctx.fillStyle = COLOR.gold; ctx.fillText(fmt(view.rating), rx + 20, M + 112);
  ctx.textAlign = "right"; ctx.font = P.font(30, 800); ctx.fillStyle = COLOR.text; ctx.fillText(`#${view.position}`, rx + 320, M + 84);
  ctx.font = P.font(15, 700); ctx.fillStyle = COLOR.textMuted; ctx.fillText(`of ${view.players} ranked`, rx + 320, M + 108);
  ctx.textAlign = "left";
  // W/L bar.
  const wx = rx + 20, ww = 300, wy = M + 132;
  ctx.fillStyle = COLOR.red; P.rr(ctx, wx, wy, ww, 12, 6); ctx.fill();
  ctx.fillStyle = "#3fd46c"; P.rr(ctx, wx, wy, ww * (view.wins / (view.wins + view.losses)), 12, 6); ctx.fill();
  ctx.font = P.font(14, 800); ctx.fillStyle = COLOR.textMuted; ctx.fillText(`${view.wins}W – ${view.losses}L · ${winPct(view.wins, view.losses)}%`, wx, wy + 32);
  // Chips under the name.
  let cx2 = bx;
  cx2 += P.drawTag(ctx, "ALL LV 50", cx2, M + 130, { fill: COLOR.blue, color: "#fff", h: 30, size: 15 }) + 8;
  cx2 += P.drawTag(ctx, `STREAK W${view.streak}`, cx2, M + 130, { fill: "#3fd46c", color: COLOR.ink, h: 30, size: 15 }) + 8;
  P.drawTag(ctx, `POWER ${fmt(view.power50)}`, cx2, M + 130, { fill: COLOR.surfaceRaised, color: COLOR.text, h: 30, size: 15 });
  // Team row.
  const ty = M + 190 + 16, gap = 10, sw = (W - 2 * M - 5 * gap) / 6, sh = H - M - ty;
  for (let i = 0; i < 6; i++) await slot(ctx, view.team[i], M + i * (sw + gap), ty, sw, sh, i, { compact: false });
  return c.toBuffer("image/png");
}

const out = path.join(repo, "docs/design/previews");
fs.writeFileSync(path.join(out, "redesign-ranked-card-1.png"), await option1());
fs.writeFileSync(path.join(out, "redesign-ranked-card-2.png"), await option2());
console.log("redesign-ranked-card-1.png, redesign-ranked-card-2.png");
