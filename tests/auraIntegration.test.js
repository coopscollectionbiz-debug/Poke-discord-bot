// ==========================================================
// tests/auraIntegration.test.js — art Auras on every surface:
//   • the opponent's VS half shows its art mirrored (placement and motion, once)
//   • an Aura without a tint still draws on VS cards and battle playback
//   • back.png's feet row lands on the trainer's feet (the coordinate contract)
//   • trainer lighting: off by default, validated, follows the pose, mirrored
//   • every sheet plays once per 2.4 s loop, on Discord and the dashboard alike
//   • backdrop, trainer pose and composite closure, kept apart
// Synthetic sheets with marker pixels, written to a temp folder.
// ==========================================================

import fs from "fs";
import os from "os";
import path from "path";
import { createCanvas, loadImage, ImageData } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aura-int-"));
process.env.AURA_ART_DIR = DIR;

const MARK = [255, 0, 255], FEET = [0, 255, 0], ROWMARK = [0, 128, 255];
const png = (w, h, paint) => { const c = createCanvas(w, h), x = c.getContext("2d"); paint(x); return c.toBuffer("image/png"); };
const px = (x, c, X, Y, w = 1, h = 1) => { x.fillStyle = `rgb(${c.join(",")})`; x.fillRect(X, Y, w, h); };
/** An art folder: back (90×105) with a feet-row marker, vs (160×123) with a marker moving right 1 px a frame, row (438×89). */
function writeArt(id, meta, { frames = 24 } = {}) {
  const d = path.join(DIR, id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "back.png"), png(90 * frames, 105, (x) => { for (let f = 0; f < frames; f++) { px(x, [20, 20, 40], f * 90, 0, 90, 105); px(x, FEET, f * 90, 98, 90, 1); px(x, MARK, f * 90 + (f % 90), 10); } }));
  fs.writeFileSync(path.join(d, "vs.png"), png(160 * frames, 123, (x) => { for (let f = 0; f < frames; f++) { px(x, [20, 20, 40], f * 160, 0, 160, 123); px(x, MARK, f * 160 + 30 + (f % 24), 60, 1, 4); } }));
  fs.writeFileSync(path.join(d, "row.png"), png(438 * frames, 89, (x) => { for (let f = 0; f < frames; f++) { px(x, [20, 20, 40], f * 438, 0, 438, 89); px(x, ROWMARK, f * 438 + 10, 40, 4, 4); } }));
  fs.writeFileSync(path.join(d, "aura.json"), JSON.stringify({ id, name: id, frames, layers: { back: "back.png", vs: "vs.png", row: "row.png" }, ...meta }));
}
writeArt("gymBlaine", {}); // no tint, no palette, no light
writeArt("e4Lorelei", { tint: "#9ab9e4", light: { color: "#ffeec0", from: [-1, -0.6], strength: 1 } });
// 48 frames: sheet frame k carries marker x = k (back.png row 10)
writeArt("milestoneShiny25", { tint: "#e0c48c" }, { frames: 48 });

const { loadAuraArt, trainerLight, resetAuraArtForTesting } = await import("../utils/render/auraArt.js");
const { hasBackdrop, backdropTint, createBackdrop, regionBackdrop } = await import("../utils/render/trainerBackdrop.js");
const { normalizeLight, lightPose, sheetFrame, auraFrameAt, AURA_LOOP_MS, BACK_FEET_FROM_BOTTOM } = await import("../public/shared/auraArt.js");
const { renderBattleVsCard, vsSide } = await import("../utils/render/battleVsCard.js");
const { renderBattleFrame } = await import("../utils/battle/render.js");
const { loadTrainerPoses } = await import("../utils/render/sprites.js");

const find = (data, W, c, x0 = 0, x1 = W, y0 = 0, y1 = data.length / 4 / W) => {
  const hits = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * 4; if (data[o] === c[0] && data[o + 1] === c[1] && data[o + 2] === c[2] && data[o + 3] > 0) hits.push([x, y]); }
  return hits;
};
const frameData = (bd, f, W, H) => bd.frame(f).getContext("2d").getImageData(0, 0, W, H).data;
async function gifFrame0(buf) {
  const img = await loadImage(buf); const c = createCanvas(img.width, img.height); c.getContext("2d").drawImage(img, 0, 0);
  return { data: c.getContext("2d").getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height };
}
const near = (data, W, X, Y, c, r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const o = ((Y + dy) * W + X + dx) * 4; if (Math.abs(data[o] - c[0]) < 40 && Math.abs(data[o + 1] - c[1]) < 40 && Math.abs(data[o + 2] - c[2]) < 40) return true; } return false; };

section("Mirroring: the opponent's VS half");
{
  const rect = { x: 560, y: 0, w: 640, h: 492 }, args = { tier: "art:gymBlaine", rect, u: 4, occupied: () => false, from: [1200, 492], to: [580, -150], floor: 478, frames: 24, variant: "vs" };
  const left = regionBackdrop({ ...args, rect: { x: 0, y: 0, w: 640, h: 492 } }), right = regionBackdrop({ ...args, mirror: true });
  // regionBackdrop draws into card pixels: the left at x 0…, the right at x 560…
  const lc = createCanvas(1200, 492), lx = lc.getContext("2d"); left.draw(lx, 0); right.draw(lx, 0);
  const all = find(lx.getImageData(0, 0, 1200, 492).data, 1200, MARK);
  const L = all.filter(([x]) => x < 600), R = all.filter(([x]) => x >= 600);
  assertEqual(Math.min(...L.map((p) => p[0])), 30 * 4, "left half: the marker at sheet x 30 → card x 120");
  assertEqual(Math.max(...R.map((p) => p[0])), 560 + (159 - 30) * 4 + 3, "right half: the same marker mirrored → sheet x 129 → card x 1079");
  assertEqual(Math.min(...L.map((p) => p[1])), Math.min(...R.map((p) => p[1])), "mirroring flips x only, never y");
  const c5 = createCanvas(1200, 492), x5 = c5.getContext("2d"); right.draw(x5, 5);
  const R5 = find(x5.getImageData(0, 0, 1200, 492).data, 1200, MARK);
  assertTrue(Math.max(...R5.map((p) => p[0])) < Math.max(...R.map((p) => p[0])), "motion mirrors too: rightward on the left half, leftward on the right");
  assertEqual(Math.max(...R.map((p) => p[0])) - Math.max(...R5.map((p) => p[0])), 20, "…by the same 5 sheet px (once, not twice)");
  // the real VS card: the marker lands near each trainer (left cx 190 → 47.5 cells, right cx 1010 → its mirror)
  const vs = await gifFrame0(await renderBattleVsCard({ mode: "ranked", pot: null, sides: [
    vsSide({ name: "A", trainerFile: "lass.png", tier: "art:e4Lorelei", members: [], record: { rating: 1500, wins: 0, losses: 0, streak: 0 } }),
    vsSide({ name: "B", trainerFile: "lass.png", tier: "art:e4Lorelei", members: [], record: { rating: 1500, wins: 0, losses: 0, streak: 0 } })] }, { animate: true }));
  const vm = find(vs.data, vs.W, MARK, 0, vs.W, 0, 492);
  const vl = vm.filter(([x]) => x < 600), vr = vm.filter(([x]) => x >= 600);
  assertTrue(vl.length > 0 && vr.length > 0, "the VS card draws the art on both halves");
  if (vl.length && vr.length) assertEqual(Math.round((Math.min(...vl.map((p) => p[0])) + Math.max(...vr.map((p) => p[0])) + 1) / 2), 600, "the two markers are mirror images about the card's centre (x 600)");
}

section("No tint: art still draws on VS cards and battle playback");
{
  resetAuraArtForTesting();
  assertTrue(hasBackdrop("art:gymBlaine"), "an art Aura without tint or palette has a backdrop");
  assertEqual(backdropTint("art:gymBlaine"), null, "…and no tint (platforms and records stay neutral)");
  const vs = await gifFrame0(await renderBattleVsCard({ mode: "open", pot: null, sides: [
    vsSide({ name: "A", trainerFile: "lass.png", tier: "art:gymBlaine", members: [], record: { wins: 0, losses: 0, streak: 0 } }),
    vsSide({ name: "B", trainerFile: "lass.png", tier: null, members: [], record: { wins: 0, losses: 0, streak: 0 } })] }, { animate: true }));
  assertTrue(find(vs.data, vs.W, MARK, 0, 600, 0, 492).length > 0, "VS card: the untinted art draws on its half");
  assertEqual(find(vs.data, vs.W, MARK, 600, vs.W, 0, 492).length, 0, "…and the no-aura half stays plain (no fallback art)");
  const pk = (speciesId) => ({ speciesId, name: "P", level: 50, variant: "normal" });
  const pb = await gifFrame0(await renderBattleFrame({ sides: [{ name: "A", members: [pk(25)] }, { name: "B", members: [pk(25)] }], sprites: new Map(), hpBefore: [[1], [1]], trainers: ["lass.png", "lass.png"], tiers: ["art:gymBlaine", null], screens: [["Go!", ""]] }));
  assertTrue(find(pb.data, pb.W, ROWMARK).length > 0, "battle playback: the untinted art's row draws");
}

section("Anchoring: back.png's feet row on the trainer's feet");
{
  assertEqual(BACK_FEET_FROM_BOTTOM, 7, "the contract: feet 7 rows above the sheet's bottom (row 98 of 105)");
  const bd = createBackdrop({ tier: "art:gymBlaine", gridW: 100, gridH: 140, mask: new Uint8Array(14000), halo: { cx: 50 }, floorRow: 120, feetRow: 130, frames: 24 });
  const rows = find(frameData(bd, 0, 100, 140), 100, FEET).map((p) => p[1]);
  assertEqual([...new Set(rows)], [130], "with feetRow, sheet row 98 lands exactly on the feet row");
  const old = createBackdrop({ tier: "art:gymBlaine", gridW: 100, gridH: 140, mask: new Uint8Array(14000), halo: { cx: 50 }, floorRow: 120, frames: 24 });
  assertEqual([...new Set(find(frameData(old, 0, 100, 140), 100, FEET).map((p) => p[1]))], [122 - 105 + 98], "without it, older callers keep their placement (bottom on floorRow + 2)");
  const cols = find(frameData(bd, 0, 100, 140), 100, FEET).map((p) => p[0]);
  assertEqual([Math.min(...cols), Math.max(...cols)], [5, 94], "the panel is centred on the trainer (cx 50 → x 5…94)");
  // the real trainer card: the marker row sits right under the trainer's lowest opaque pixel
  const { trainerCardView, renderTrainerCard } = await import("../utils/render/trainerCard.js");
  const v = trainerCardView({ displayedTrainer: "lass.png" }, { displayName: "T", trainer: { name: "Lass", tier: "common" } });
  v.aura = "art:gymBlaine";
  const card = await gifFrame0(await renderTrainerCard(v, { animate: true }));
  const feet = find(card.data, card.W, FEET, 20, 380).map((p) => p[1]);
  const sprite = await loadImage(path.join(HERE, "..", "public", "sprites", "trainers_2", "lass.png"));
  const sc = createCanvas(sprite.width, sprite.height); sc.getContext("2d").drawImage(sprite, 0, 0);
  const sd = sc.getContext("2d").getImageData(0, 0, sprite.width, sprite.height).data;
  let soles = 0; for (let i = 3; i < sd.length; i += 4) if (sd[i] >= 8) soles = Math.floor(i / 4 / sprite.width) + 1;
  const floorY = 20 + 400 + 6, solesY = floorY - (sprite.height - soles) * 4; // trainerCard: M 20, floor M+400, sprite bottom at floor+6, 4×
  assertTrue(feet.length > 0, "the trainer card draws the art's feet row");
  if (feet.length) assertEqual(Math.min(...feet), solesY, "…starting exactly at the bottom edge of the trainer's feet");
}

section("Lighting: optional, validated, pose-following, mirrored");
{
  assertEqual(normalizeLight(undefined), null, "no light key: no lighting");
  for (const bad of [{ color: "red" }, { color: "#fff000", from: [0, 0] }, { color: "#fff000", from: "above" }, { color: "#fff000", strength: [1, 2] }, { color: "#fff000", strength: 2 }])
    assertTrue((() => { try { normalizeLight(bad); return false; } catch { return true; } })(), `rejects ${JSON.stringify(bad)}`);
  const L = normalizeLight({ color: "#ffffff", from: [-1, 0], strength: 1 });
  assertEqual(L.strength.length, 24, "a single strength becomes a 24-frame track");
  assertEqual(trainerLight("art:gymBlaine"), null, "an Aura without light: trainers are drawn untouched (default off)");
  assertEqual(trainerLight("legendary"), null, "tier Auras never light the trainer");
  // a 9×9 block: dark outline ring, mid-grey inside
  const w = 9, h = 9, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, edge = x === 0 || y === 0 || x === w - 1 || y === h - 1; rgba.set(edge ? [10, 10, 10, 255] : [100, 60, 60, 255], o); }
  const out = lightPose(rgba, w, h, L, 1), outM = lightPose(rgba, w, h, L, 1, { mirror: true });
  const at = (a, x, y) => [...a.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  assertTrue(at(out, 1, 6)[0] > 100 && at(out, 7, 6)[0] === 100, "light from the left brightens the pixel inside the left outline, not the right");
  assertTrue(at(outM, 7, 6)[0] > 100 && at(outM, 1, 6)[0] === 100, "mirrored: the right side lights instead");
  assertTrue(at(out, 0, 6)[0] < 70, "the outline itself stays dark (tinted a little, never washed out)");
  assertTrue(at(out, 4, 6)[0] === 100, "the interior is untouched");
  assertTrue(at(out, 1, 6)[0] >= at(out, 1, 6)[1], "screen blending keeps the cloth's own hue (red stays red)");
  const off = lightPose(rgba, w, h, L, 0);
  assertEqual([...off], [...rgba], "strength 0 changes nothing");
  // follows the pose: a different silhouette lights different pixels
  const shifted = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 2; x < w; x++) shifted.set(rgba.slice((y * w + x - 2) * 4, (y * w + x - 2) * 4 + 4), (y * w + x) * 4);
  const os = lightPose(shifted, w, h, L, 1);
  assertTrue(at(os, 3, 6)[0] > 100 && at(os, 1, 6)[0] === 0, "the lit edge moves with the pose's silhouette");
  const light = trainerLight("art:e4Lorelei");
  assertTrue(typeof light === "function", "an Aura with light gives a lighting function");
  const sprite = { image: (() => { const c = createCanvas(w, h); c.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0); return c; })(), width: w, height: h };
  assertTrue(light(sprite, 0) !== sprite && light(sprite, 0) === light(sprite, 0), "lit poses are made once and cached");
}

section("Timing: every sheet plays once per 2.4 s");
{
  assertEqual(AURA_LOOP_MS, 2400, "the aura loop is 2.4 s");
  for (const n of [12, 24, 48]) {
    const seq = Array.from({ length: 48 }, (_, f) => sheetFrame(f, n));
    assertEqual(seq.slice(0, 24), seq.slice(24), `n = ${n}: the same 24 frames every 2.4 s`);
    assertEqual(seq[0], 0, `n = ${n}: frame 0 shows sheet frame 0`);
    assertEqual(seq[23], Math.floor((23 * n) / 24), `n = ${n}: the last aura frame shows sheet frame ${Math.floor((23 * n) / 24)}`);
  }
  assertEqual([0, 99, 100, 2399, 2400].map(auraFrameAt), [0, 0, 1, 23, 0], "card time → aura frame");
  resetAuraArtForTesting();
  const art = loadAuraArt("milestoneShiny25");
  assertEqual(art.layers.back.n, 48, "a 48-frame sheet loads");
  const bd = createBackdrop({ tier: "art:milestoneShiny25", gridW: 90, gridH: 105, mask: new Uint8Array(90 * 105), halo: { cx: 45 }, floorRow: 96, feetRow: 98, frames: 24 });
  const markX = (f) => find(frameData(bd, f, 90, 105), 90, MARK)[0]?.[0];
  assertEqual([markX(0), markX(1), markX(23), markX(24)], [0, 2, 46, 0], "the backdrop shows sheet frames 0, 2 … 46, then closes on 0");
  const dash = fs.readFileSync(path.join(HERE, "..", "public", "picker", "auras.js"), "utf8");
  assertTrue(/import \{[^}]*\bsheetFrame\b[^}]*\} from "\/public\/shared\/auraArt\.js"/.test(dash) && /sheetFrame\(f, n\)/.test(dash), "the dashboard maps frames with the same function");
  assertTrue(!/aura-steps|--frames/.test(fs.readFileSync(path.join(HERE, "..", "public", "picker", "style.css"), "utf8")), "…and no longer runs a CSS animation of frames × 100 ms");
}

section("Closure: backdrop, trainer pose and composite (kept apart)");
{
  const bd = createBackdrop({ tier: "art:gymBlaine", gridW: 90, gridH: 105, mask: new Uint8Array(90 * 105), halo: { cx: 45 }, floorRow: 96, feetRow: 98, frames: 24 });
  assertEqual([...frameData(bd, 24, 90, 105)], [...frameData(bd, 0, 90, 105)], "backdrop closure: aura frame 24 = frame 0");
  const poses = await loadTrainerPoses("lass.png");
  if (poses) {
    assertEqual(poses.poseAt(24, 24), poses.poseAt(0, 24), "trainer pose closure: the idle restarts on the same 2.4 s loop");
    assertEqual(Array.from({ length: 24 }, (_, f) => poses.poseAt(f, 24)), Array.from({ length: 24 }, (_, f) => poses.poseAt(f + 24, 24)), "…pose for pose");
  } else assertTrue(true, "lass.png has no idle here (TRAINERS_ANIMATED off): pose closure not applicable");
  const light = trainerLight("art:e4Lorelei");
  const s = { image: createCanvas(4, 4), width: 4, height: 4 };
  assertTrue(light(s, 24) === light(s, 0), "composite closure: the lit trainer on frame 24 is the frame-0 one, over the frame-0 backdrop");
}

fs.rmSync(DIR, { recursive: true, force: true });
finish();
