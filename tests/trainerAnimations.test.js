// ==========================================================
// tests/trainerAnimations.test.js — real (artist-made) trainer animations
// (data/sprites/trainer-animations.json, imported by
// tools/import-trainer-animations.mjs): assets on disk, the idle manifest,
// image URLs, and the card renderer playing the real frames.
// ==========================================================

import fs from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { trainerImageUrl, trainerIdle } from "../utils/trainerAssets.js";
import { loadTrainerPoses } from "../utils/render/sprites.js";

const require = createRequire(import.meta.url);
const { GifReader } = require("omggif");
const ROOT = new URL("../", import.meta.url);
const P = (rel) => fileURLToPath(new URL(rel, ROOT));
const read = (rel) => JSON.parse(fs.readFileSync(P(rel), "utf8"));
const list = read("data/sprites/trainer-animations.json").files;
const reg = read("trainerSprites.json");
const parts = read("data/sprites/trainer-parts.json").sprites;
const files = Object.keys(list);

const selectable = new Set();
for (const e of Object.values(reg)) for (const s of e.sprites ?? []) if (typeof s === "string") selectable.add(s); else if (s?.file && !s.disabled) selectable.add(s.file);
async function rgba(path) {
  const img = await loadImage(path), c = createCanvas(img.width, img.height), x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  return { px: x.getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height };
}
const gifOf = (name) => new GifReader(fs.readFileSync(P(`public/sprites/trainers_idle/${name}`)));

section("list");
{
  const artist = files.filter((f) => list[f].artist).sort(), game = files.filter((f) => !list[f].artist);
  assertEqual(artist, ["brassius.png", "grusha.png", "iono.png", "katy.png", "kofu.png", "larry.png", "ryme.png", "tulip.png"], "the eight Paldea gym leaders are artist-made");
  assertEqual(game.length, 163, "163 sprites use their game animation (Bulbagarden; B2W2 preferred for every base sprite that has one)");
  for (const f of ["acetrainer.png", "baker.png", "battlegirl.png", "blue.png", "lance.png", "weirdlight.png"]) assertTrue(game.includes(f), `${f} plays its game animation`);
  assertTrue(game.every((f) => list[f].game && list[f].source.startsWith("https://archives.bulbagarden.net/")), "every game animation names its game and source");
  assertTrue(files.every((f) => selectable.has(f)), "every animated sprite is a selectable trainer");
  assertTrue(artist.every((f) => list[f].source && list[f].permission), "every artist-made animation names its source and permission");
  assertTrue(files.every((f) => !parts[f]), "no generated part motions (blinks, waves) are left on animated sprites");
}

section("assets");
for (const f of files) {
  const a = list[f], name = f.replace(".png", ".gif");
  const gif = gifOf(name), still = await rgba(P(`public/sprites/trainers_2/${f}`)), gray = await rgba(P(`public/sprites/trainers_2/grayscale/${f}`));
  const ok = [gif.width, gif.height].join() === a.canvas.join() && [still.W, still.H].join() === a.canvas.join() && [gray.W, gray.H].join() === a.canvas.join();
  assertTrue(ok, `${f}: GIF, still and grayscale are all ${a.canvas.join("×")}`);
  assertTrue(a.canvas[0] >= 80 && a.canvas[1] >= 80 && a.canvas[0] <= 120 && a.canvas[1] <= 120, `${f}: canvas is 80×80 or a little larger`);
  assertEqual(gif.numFrames(), a.frames, `${f}: ${a.frames} frames`);
  // The still is the `still` frame (default the last), exactly.
  const last = new Uint8ClampedArray(gif.width * gif.height * 4);
  gif.decodeAndBlitFrameRGBA(a.still ?? gif.numFrames() - 1, last);
  let same = true, luma = true;
  for (let p = 0; p < last.length; p += 4) {
    if ((last[p + 3] > 0) !== (still.px[p + 3] > 0) || (last[p + 3] && (last[p] !== still.px[p] || last[p + 1] !== still.px[p + 1] || last[p + 2] !== still.px[p + 2]))) same = false;
    if (still.px[p + 3] && gray.px[p] !== Math.round(0.2126 * still.px[p] + 0.7152 * still.px[p + 1] + 0.0722 * still.px[p + 2])) luma = false;
  }
  assertTrue(same, `${f}: the PNG is the animation's still frame`);
  assertTrue(luma, `${f}: the grayscale copy is Rec. 709 luma of the PNG`);
}

section("manifest and URLs");
{
  for (const f of files) {
    const rec = trainerIdle(f);
    assertTrue(rec?.animation === "real" && rec.gif === f.replace(".png", ".gif"), `${f}: the idle manifest lists the real animation`);
  }
  assertEqual(trainerImageUrl("iono.png").split("/").slice(-2).join("/"), "trainers_idle/iono.gif", "Iono is shown as her animation");
  assertEqual(trainerImageUrl("iono.png", { grayscale: true }).split("/").slice(-2).join("/"), "grayscale/iono.png", "grayscale views stay the still");
  assertEqual(trainerImageUrl("iono.png", { env: { TRAINERS_ANIMATED: "0" } }).split("/").slice(-2).join("/"), "trainers_2/iono.png", "TRAINERS_ANIMATED=0 turns it back to the still");
  const web = read("public/sprites/trainers_idle/manifest.json");
  assertTrue(files.every((f) => web[f] === f.replace(".png", ".gif")), "the web picker's manifest points at the animations");
  let check = "ok";
  try { execFileSync(process.execPath, [P("tools/generate-trainer-idles.mjs"), "--check"], { cwd: P("."), stdio: "pipe" }); } catch (e) { check = String(e.stdout || e.message); }
  assertEqual(check, "ok", "generate-trainer-idles --check: up to date and keeps the real GIFs");
}

section("card poses");
{
  const idle = await loadTrainerPoses("ryme.png");
  assertTrue(idle?.real === true, "Ryme's card poses are the real animation");
  assertEqual(idle.poses.length, list["ryme.png"].frames, "one pose per frame");
  const n = 24, seen = new Set(Array.from({ length: n }, (_, f) => idle.poseAt(f, n)));
  assertEqual(idle.poseAt(0, n), 1, "the card loop starts at the first frame");
  assertEqual(idle.poseAt(n - 1, n), 0, "and ends on the still (the last frame)");
  assertEqual(seen.size, n, "a 24-frame card shows 24 different frames across the animation");
  const p0 = idle.poses[0].image.getContext("2d").getImageData(0, 0, idle.width, idle.height).data;
  assertTrue(Buffer.from(p0).equals(Buffer.from(idle.rgba)), "pose 0 is pixel-identical to the PNG (still cards)");
  // A game animation whose still is its first frame.
  const baker = await loadTrainerPoses("baker.png");
  assertTrue(baker?.real === true && baker.poses.length === list["baker.png"].frames, "Baker's card poses are his game animation");
  assertEqual([baker.poseAt(0, n), baker.poseAt(1, n)], [0, 1], "a first-frame still: the loop starts on the still, then frame 2");
  const b0 = baker.poses[0].image.getContext("2d").getImageData(0, 0, baker.width, baker.height).data;
  assertTrue(Buffer.from(b0).equals(Buffer.from(baker.rgba)), "Baker's pose 0 is pixel-identical to his PNG");
  const breathing = await loadTrainerPoses("hiker-gen4.png");
  assertTrue(!breathing || !breathing.real, "trainers without a real animation keep the generated breathing");
}

finish();
