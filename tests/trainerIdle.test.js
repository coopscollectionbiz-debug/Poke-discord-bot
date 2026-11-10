// ==========================================================
// tests/trainerIdle.test.js
// The procedural breathing idle for trainer sprites: the poses only reuse
// the sprite's own pixels, every selectable trainer has an up-to-date idle
// GIF, URLs fall back to the static PNG when they should, and the rendered
// cards animate the trainer (plus the tier backdrop for Epic and above)
// without anything passing behind them.
// ==========================================================

import fs from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { GifReader } from "omggif";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { breathingPoses, idleCuts, poseAtFrame, IDLE_LOOP } from "../utils/trainerIdle.js";
import { nameHash, breathTiming, rectMask, movePart, blinkEyes, applyEvent, idleTimeline, cardSchedule } from "../utils/trainerMotion.js";
import { trainerImageUrl, trainerIdle } from "../utils/trainerAssets.js";
import { createBackdrop, hasBackdrop } from "../utils/render/trainerBackdrop.js";
import { renderTrainerCard } from "../utils/render/trainerCard.js";
import { renderLeaderboard, leaderboardView } from "../utils/render/leaderboardCard.js";
import { rankBattleRatings } from "../commands/leaderboard.js";
import { leaderboardWorld } from "./fixtures/showteamFixtures.js";

const ROOT = new URL("../", import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, ROOT), "utf8"));
const isGif = (b) => b.subarray(0, 3).toString() === "GIF";

async function pixels(file) {
  const img = await loadImage(fileURLToPath(new URL(`public/sprites/trainers_2/${file}`, ROOT)));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return { px: c.getContext("2d").getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height };
}
const colours = (px) => {
  const s = new Set();
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 8) s.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
  return s;
};

section("Breathing poses");
{
  const { px, W, H } = await pixels("cynthia.png");
  const b = breathingPoses(px, W, H);
  assertTrue(b && b.poses.length === 3, "three poses: rest, head-lag, exhale");
  assertEqual(Buffer.from(b.poses[0]).equals(Buffer.from(px)), true, "rest is the unchanged sprite");
  assertTrue(!Buffer.from(b.poses[2]).equals(Buffer.from(px)), "exhale differs from rest");
  const src = colours(px);
  assertTrue([...colours(b.poses[1]), ...colours(b.poses[2])].every((c) => src.has(c)), "the poses use only the sprite's own colours");
  assertTrue(b.cuts.neck < b.cuts.waist, "the neck cut is above the waist cut");
  assertEqual(idleCuts(new Uint8ClampedArray(W * H * 4), W, H), null, "an empty sprite has no cut lines");
  const tiny = new Uint8ClampedArray(W * H * 4);
  for (let y = 40; y < 55; y++) for (let x = 30; x < 40; x++) tiny[(y * W + x) * 4 + 3] = 255;
  assertEqual(breathingPoses(tiny, W, H), null, "a figure under 30 px tall doesn't breathe");
  assertEqual(Array.from({ length: 24 }, (_, f) => poseAtFrame(f, 24)).join(""), "000000000001222222222100", "card loop: rest, lag, exhale, lag, rest");
  assertEqual(IDLE_LOOP.map(([p]) => p), [0, 1, 2, 1], "standalone GIF loop: rest, lag, exhale, lag");
}

section("Idle manifest and GIFs");
{
  const registry = read("trainerSprites.json");
  const selectable = new Set();
  for (const e of Object.values(registry)) for (const s of e.sprites) {
    if (typeof s === "string") selectable.add(s);
    else if (!s.disabled) selectable.add(s.file);
  }
  const manifest = read("data/sprites/trainer-idles.json").files;
  const web = read("public/sprites/trainers_idle/manifest.json");
  assertEqual([...selectable].filter((f) => !manifest[f]), [], "every selectable trainer sprite has a manifest entry");
  const ok = Object.entries(manifest).filter(([, r]) => r.status === "ok");
  assertEqual(ok.filter(([, r]) => !fs.existsSync(new URL(`public/sprites/trainers_idle/${r.gif}`, ROOT))).map(([f]) => f), [], "every ok entry has its GIF");
  assertEqual(Object.keys(web).length, ok.length, "the web manifest lists exactly the ok entries");
  assertEqual(Object.values(manifest).filter((r) => r.status === "review").length, 0, "nothing is left awaiting review");
  let check = "";
  try {
    check = execFileSync(process.execPath, [fileURLToPath(new URL("tools/generate-trainer-idles.mjs", ROOT)), "--check"], { encoding: "utf8" });
  } catch (err) {
    check = String(err.stdout || err.message);
  }
  assertTrue(check.includes("up to date"), `generated idles are up to date (${check.trim().split("\n")[0]})`);

  // Each loop starts at the trainer's own phase, so the unchanged PNG (the
  // rest pose) is somewhere in the loop rather than always frame 0.
  for (const file of ["cynthia.png", "youngster-gen4.png", "iris-gen5bw2.png", "sailor-gen3.png"]) {
    const g = new GifReader(fs.readFileSync(new URL(`public/sprites/trainers_idle/${manifest[file].gif}`, ROOT)));
    const { px, W, H } = await pixels(file);
    let rest = false;
    for (let k = 0; k < g.numFrames() && !rest; k++) {
      const fr = new Uint8ClampedArray(W * H * 4);
      g.decodeAndBlitFrameRGBA(k, fr);
      let same = true;
      for (let i = 0; i < fr.length; i += 4) {
        const a = px[i + 3] >= 128, b = fr[i + 3] >= 128;
        if (a !== b || (a && (px[i] !== fr[i] || px[i + 1] !== fr[i + 1] || px[i + 2] !== fr[i + 2]))) { same = false; break; }
      }
      rest = same;
    }
    assertTrue(g.numFrames() >= 4 && g.loopCount() === 0, `${file}: infinite loop of ≥ 4 frames (${g.numFrames()})`);
    assertTrue(rest, `${file}: the unchanged PNG is one of the frames`);
  }
}

section("Offsets and part motions");
{
  assertEqual(nameHash("leon.png"), nameHash("leon.png"), "the per-trainer hash is stable");
  const tim = [...new Set(["leon.png", "serena.png", "kukui.png", "hilbert.png", "rosa.png", "hau.png"].map((f) => JSON.stringify(breathTiming(f))))];
  assertTrue(tim.length === 6, "different trainers get different breath timings");
  const all = Object.keys(read("data/sprites/trainer-idles.json").files).map(breathTiming);
  assertTrue(all.every((t) => t.rest >= 760 && t.rest <= 1090 && t.exhale >= 590 && t.exhale <= 850 && t.phase >= 0 && t.phase < 1), "tempo stays within 0.85×–1.2×, phase within the loop");

  // movePart: a 3×3 block moved right by 1 on a 6×3 canvas with clear background.
  const W = 6, H = 3, px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) px.set([200, 50, 50, 255], (y * W + x) * 4);
  const moved = movePart(px, W, H, rectMask(px, W, H, [0, 0, 2, 2]), 1, 0);
  const alphaRow = (buf) => Array.from({ length: W }, (_, x) => (buf[x * 4 + 3] ? 1 : 0)).join("");
  assertEqual(alphaRow(moved), "011100", "a part moved into clear space leaves clear space behind it");
  const blinked = blinkEyes(new Uint8ClampedArray([230, 190, 160, 255, 10, 10, 10, 255]), 1, 2, [0, 1, 0, 1]);
  assertEqual(Array.from(blinked.subarray(4, 8)), [230, 190, 160, 255], "a blink paints the dark eye pixel with the lid colour above");

  const parts = read("data/sprites/trainer-parts.json").sprites;
  const idles = read("data/sprites/trainer-idles.json").files;
  const evs = Object.entries(parts).flatMap(([f, s]) => s.events.map((e) => [f, e]));
  assertTrue(Object.keys(parts).length >= 150, `part motions for ${Object.keys(parts).length} trainers`);
  assertEqual(Object.keys(parts).filter((f) => idles[f]?.status !== "ok"), [], "every part-motion sprite has an approved idle");
  assertTrue(evs.every(([, e]) => e.at >= 0 && e.at <= 1 && e.ms > 0 && e.ms <= 600), "events sit inside the loop and are short");
  assertTrue(evs.filter(([, e]) => e.kind === "move").every(([, e]) => e.parts.every((p) => Math.abs(p.d[0]) + Math.abs(p.d[1]) === 1 && p.rect.every((v) => v >= 0 && v < 80))), "every move is exactly 1 px, inside the sprite");
  assertTrue(evs.filter(([, e]) => e.kind === "move" && e.parts.length > 1).every(([, e]) => e.parts.every((p) => p.d.join() === e.parts[0].d.join())), "multi-part moves (capes) all go the same way");
  const leon = parts["leon.png"].events[0];
  assertTrue(leon.parts.length === 2 && leon.parts.every((p) => p.d[0] === 1), "Leon's cape: both flaps sway the same way, not outward");

  // Timelines: no flicker slivers, each loop shows its event states.
  for (const f of ["sailor-gen3.png", "hiker.png", "leon.png", "youngster-gen4.png", "acetrainerf.png"]) {
    const tl = idleTimeline(f, parts[f]?.events ?? []);
    assertTrue(tl.every((s) => s.ms >= 60), `${f}: no frame shorter than 60 ms`);
    assertTrue((parts[f]?.events ?? []).every((_, k) => tl.some((s) => s.state === k + 1)), `${f}: every part event appears in the loop`);
  }
  const sched = (f) => cardSchedule(f, 24, [], poseAtFrame).map((s) => s.pose).join("");
  assertTrue(new Set(["leon.png", "serena.png", "kukui.png"].map(sched)).size > 1, "card loops: trainers start their breath at different frames");
  const { px: lp } = await pixels("leon.png");
  assertTrue(!Buffer.from(applyEvent(lp, 80, 80, leon)).equals(Buffer.from(lp)), "Leon's cape event changes the sprite");
}

section("Trainer image URLs");
{
  const env = {};
  assertTrue(trainerImageUrl("cynthia.png", { env }).endsWith("/public/sprites/trainers_idle/cynthia.gif"), "ok sprite → its breathing GIF");
  assertTrue(trainerImageUrl("cynthia.png", { env: { TRAINERS_ANIMATED: "0" } }).endsWith("/public/sprites/trainers_2/cynthia.png"), "TRAINERS_ANIMATED=0 → static PNG");
  assertTrue(trainerImageUrl("cynthia.png", { grayscale: true, env }).endsWith("/public/sprites/trainers_2/grayscale/cynthia.png"), "grayscale (unowned) → static grayscale PNG");
  assertTrue(trainerImageUrl("not-a-trainer.png", { env }).endsWith("/public/sprites/trainers_2/not-a-trainer.png"), "unknown file → static PNG");
  assertEqual(trainerIdle("acetrainer-gen1.png"), null, "disabled sprites get no idle");
  assertEqual(trainerImageUrl(null), null, "no file → null");
}

section("Tier backdrop");
{
  assertEqual(["common", "uncommon", "rare"].map(hasBackdrop), [false, false, false], "Rare and below: no backdrop");
  assertEqual(["epic", "legendary", "mythic"].map(hasBackdrop), [true, true, true], "Epic, Legendary, Mythic: backdrop");
  const W = 90, H = 104, mask = new Uint8Array(W * H);
  for (let y = 18; y < 100; y++) for (let x = 25; x < 65; x++) mask[y * W + x] = 1; // a trainer-shaped block
  const halo = { cx: 45, cy: 60, rx: 40, ry: 54 };
  assertEqual(createBackdrop({ tier: "rare", gridW: W, gridH: H, mask, halo, floorRow: 99, frames: 24 }), null, "no backdrop object for Rare");
  const bd = createBackdrop({ tier: "mythic", gridW: W, gridH: H, mask, halo, floorRow: 99, frames: 24 });
  assertTrue(bd.meteors.length === 3, `Mythic: 3 meteors per 2.4 s loop (${bd.meteors.length})`);
  assertTrue(new Set(bd.meteors.map((m) => Math.round(m.y0 / 25))).size >= 2, "meteors start at different heights");
  assertTrue(bd.meteors.every((m) => Math.sign(m.dx) === -1 && m.dy > 0), "all meteors fall down-left");
  const clear = (x, y) => !mask[y * W + x];
  assertTrue(bd.twinkles.every((s) => clear(s.x, s.y)), "twinkles sit in open space");
  assertTrue(bd.meteors.every((m) => {
    for (let s = 0; s <= m.travel; s++) for (let t = 0; t <= m.tail; t++) if (!clear(Math.round(m.x0 + m.dx * (s - t)), Math.round(m.y0 + m.dy * (s - t)))) return false;
    return true;
  }), "no meteor path or tail crosses the trainer");
  const f0 = bd.frame(0), ctx = f0.getContext("2d");
  assertTrue(f0.width === W && f0.height === H && ctx.getImageData(0, 0, W, H).data.some((v, i) => i % 4 === 3 && v > 0), "draws a non-empty frame");
}

section("Rendered cards");
{
  const v = (file, tier) => ({ displayName: "T", trainerFile: file, trainer: { name: "T", tier }, rank: { current: "A", next: "B", remaining: 1, progress: 50 }, tp: 1, cc: 1, owned: 1, shinies: 0, trainers: 1, battle: null, team: [], fallbackTeam: false });
  assertTrue(isGif(await renderTrainerCard(v("youngster-gen4.png", "common"), { animate: true })), "a Common trainer alone animates the card (breathing)");
  assertTrue(isGif(await renderTrainerCard(v("cynthia-masters.png", "mythic"), { animate: true })), "a Mythic trainer card animates");
  assertTrue(!isGif(await renderTrainerCard(v("cynthia-masters.png", "mythic"), { animate: false })), "still mode stays a PNG");
  process.env.TRAINERS_ANIMATED = "0";
  assertTrue(!isGif(await renderTrainerCard(v("youngster-gen4.png", "common"), { animate: true })), "TRAINERS_ANIMATED=0: a lone static trainer stays a PNG");
  delete process.env.TRAINERS_ANIMATED;
  const td = leaderboardWorld();
  const board = await renderLeaderboard(leaderboardView(rankBattleRatings(td, "p6"), td, "p6"), { animate: true });
  assertTrue(isGif(board), "the leaderboard podium trainers breathe");
}

finish();
