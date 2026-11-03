// ==========================================================
// tests/battleRender.test.js
// Which turns playback shows, turn narration, layout, and the animated GIF.
// ==========================================================

import fs from "fs";
import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  pickFrameTurns, renderBattleFrame, tileCenter, turnText, loadSprite, spritePlayer, ANIMATION, FRAME_WIDTH,
} from "../utils/battle/render.js";

section("Frame turns");
assertEqual(pickFrameTurns(20, 4), [5, 10, 15, 20], "evenly spaced, last is the final turn");
assertEqual(pickFrameTurns(2, 4), [1, 2], "short battles don't repeat frames");
assertEqual(pickFrameTurns(7, 4), [2, 4, 5, 7], "uneven lengths still end on the final turn");
assertEqual(pickFrameTurns(9, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9], "battles up to 12 turns show every turn");
assertEqual(pickFrameTurns(49, 12).length, 12, "longer battles are capped at 12 updates");

section("Centered rows");
assertTrue([1, 2, 5, 6].every((n) => tileCenter(n, 0) + tileCenter(n, n - 1) === FRAME_WIDTH), "every row is centered");

section("Turn text");
const mon = (speciesId, level, name, variant = "normal") => ({ speciesId, level, variant, name });
const sides = [
  { name: "Ash", members: [mon(6, 36, "Charizard"), mon(25, 20, "Pikachu", "shiny"), mon(1, 5, "Bulbasaur"), mon(150, 40, "Mewtwo"), mon(9999, 1, "Missingno"), mon(19, 3, "Rattata")] },
  { name: "Gary", members: [mon(9, 36, "Blastoise")] },
];
const hit = (o = {}) => ({
  side: 0, slot: 0, targetSlot: 0, move: "Flamethrower", damage: 10, crit: false, eff: 1, missed: false, hpAfter: 0.5, fainted: false, ...o,
});
assertEqual(turnText(hit(), sides), ["Charizard used Flamethrower!", ""], "a plain hit");
assertEqual(turnText(hit({ crit: true, eff: 2, hpAfter: 0, fainted: true }), sides),
  ["Charizard used Flamethrower!", "A critical hit! It's super effective! Blastoise fainted!"], "crit, effectiveness, and faint");
assertEqual(turnText(hit({ eff: 0.5 }), sides)[1], "It's not very effective...", "resisted");
assertEqual(turnText(hit({ eff: 0, damage: 0 }), sides)[1], "It doesn't affect Blastoise...", "immune");
assertEqual(turnText(hit({ missed: true, damage: 0 }), sides)[1], "Charizard's attack missed!", "a miss");

section("Render");
const decodeFrame = (reader, i) => { const px = new Uint8Array(reader.width * reader.height * 4); reader.decodeAndBlitFrameRGBA(i, px); return px; };
const attack = await renderBattleFrame({
  sides, hpBefore: [[1, 0.5, 0, 0.1, 1, 1], [0.25]], events: [hit({ crit: true, eff: 2, hpAfter: 0, fainted: true })], badge: "TURN 12", surgeSide: 1,
});
const reader = new GifReader(attack);
assertEqual(attack.subarray(0, 6).toString(), "GIF89a", "renders a GIF");
assertEqual(reader.width, FRAME_WIDTH, "full frame width");
// Discord ignores a long last-frame hold and loops each GIF once its regular
// frames run out (seen in a screen recording), so a turn must play long
// enough on 100 ms frames alone to still be showing when the next update lands.
const playedMs = (r) => Array.from({ length: r.numFrames() - 1 }, (_, i) => r.frameInfo(i).delay * 10).reduce((a, b) => a + b, 0);
assertTrue(playedMs(reader) >= ANIMATION.turnMs - ANIMATION.delayMs, "a one-attack turn plays for the full turn length");
const twoHits = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 0.5, 0, 0.1, 1, 1], [0.9]], events: [hit({ side: 1, slot: 0, targetSlot: 0, hpAfter: 0.8 }), hit({ hpAfter: 0.4 })], badge: "TURN 3" }));
assertTrue(playedMs(twoHits) >= ANIMATION.turnMs - ANIMATION.delayMs, "a two-attack turn plays for the full turn length");
const idleGif = await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [1]], screens: [["The battle begins!", ""]] });
const idle = new GifReader(idleGif);
assertEqual(idle.numFrames(), ANIMATION.idleFrames, "with no attacks it loops the idle animation");
const twoScreens = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [0]], screens: [["Ash defeated Gary!", ""], ["Charizard grew to Lv37!", ""]], winnerSide: 0 }));
assertEqual(twoScreens.numFrames(), 2 * ANIMATION.idleFrames, "each text screen gets its own stretch of the loop");
assertTrue(!Buffer.from(decodeFrame(idle, 0)).equals(Buffer.from(decodeFrame(idle, 10))), "sprites animate between frames");
// Frames after the first store only what changed (the rest is transparent and
// the previous frame shows through). Smaller files load faster, which shortens
// the blank flash Discord's mobile app shows while an updated image loads.
{
  const second = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(1, second);
  let drawn = 0;
  for (let p = 3; p < second.length; p += 4) if (second[p]) drawn++;
  assertTrue(drawn < second.length / 4 / 4, `a later frame stores only its changes (${Math.round((100 * drawn) / (second.length / 4))}% of pixels)`);
}
// A missing sprite (#9999) still renders the frame.
if (process.env.BATTLE_FRAME_OUT) fs.writeFileSync(process.env.BATTLE_FRAME_OUT, attack);

section("Sprite cache");
{
  // A battle's images share one cache, so each sprite is decoded once per battle, not once per image.
  const sprites = new Map();
  const turn = (hpBefore) => ({ sides, hpBefore, events: [hit({ side: 1, hpAfter: 0.4 })], badge: "TURN 2" });
  const cachedFirst = await renderBattleFrame({ ...turn([[1, 0.5, 0, 0.1, 1, 1], [0.9]]), sprites });
  assertTrue(sprites.has("normal/6") && sprites.has("shiny/25") && sprites.has("grayscale/1"), "sprites are cached by folder and species");
  const first = new Map(sprites);
  // Charizard has fainted by the next image: it needs its grayscale sprite, not the cached color one.
  const later = turn([[0, 0.5, 0, 0.1, 1, 1], [0.9]]);
  const cachedLater = await renderBattleFrame({ ...later, sprites });
  assertTrue([...first].every(([key, sprite]) => sprites.get(key) === sprite), "later images reuse the decoded sprites");
  assertTrue(sprites.has("grayscale/6"), "a newly fainted Pokémon gets its grayscale sprite");
  assertTrue(cachedFirst.equals(await renderBattleFrame(turn([[1, 0.5, 0, 0.1, 1, 1], [0.9]]))), "a cached image matches an uncached one");
  assertTrue(cachedLater.equals(await renderBattleFrame(later)), "a cached image after a faint matches an uncached one");
}

section("Rendering lets other work run");
{
  // A 6v6 turn image takes about 0.4 s to draw and encode; the bot must keep
  // answering other commands meanwhile (Discord allows 3 s).
  const full = [[6, 25, 3, 150, 94, 130], [9, 143, 149, 65, 68, 248]].map((ids, i) => ({ name: i ? "Gary" : "Ash", members: ids.map((id) => mon(id, 50, `#${id}`)) }));
  let last = performance.now(), longest = 0;
  const tick = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 5);
  await renderBattleFrame({ sides: full, hpBefore: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]], events: [hit(), hit({ side: 1 })], badge: "TURN 1" });
  clearInterval(tick);
  longest = Math.max(longest, performance.now() - last);
  assertTrue(longest < 250, `the bot keeps running while an image renders (longest pause ${Math.round(longest)} ms)`);
}

section("Colors that only appear later");
{
  // Every bar starts green; Blastoise drops from 90% to 10% HP, so its bar
  // ends red, a color the first frame doesn't have.
  const r = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [0.9]], events: [hit({ hpAfter: 0.1 })], badge: "TURN 4" }));
  const end = new Uint8Array(r.width * r.height * 4);
  for (let i = 0; i < r.numFrames(); i++) r.decodeAndBlitFrameRGBA(i, end);
  // The fill of the HP bar under Gary's only Pokémon (tile centered at x 450).
  const [red, green, blue] = end.subarray((375 * r.width + 424) * 4);
  const off = Math.abs(red - 0xef) + Math.abs(green - 0x4b) + Math.abs(blue - 0x4b);
  // A palette from the first frame alone came out 28 off (228, 72, 61).
  assertTrue(off < 15, `the low-HP bar shows its red (${red}, ${green}, ${blue})`);
}

section("Sprites decode as they play");
{
  // Bulbasaur's sprite clears parts of some frames (GIF disposal 2). Decoding
  // a frame only when an image reaches it must match decoding every frame up front.
  const sprite = await loadSprite("normal", 1);
  const { width, height, gif } = sprite;
  const full = [];
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gif.numFrames(); i++) {
    gif.decodeAndBlitFrameRGBA(i, px);
    full.push(Buffer.from(px));
    const f = gif.frameInfo(i);
    if (f.disposal === 2) for (let y = f.y; y < f.y + f.height; y++) px.fill(0, (y * width + f.x) * 4, (y * width + f.x + f.width) * 4);
  }
  assertTrue(gif.numFrames() > 5 && [...Array(gif.numFrames()).keys()].some((i) => gif.frameInfo(i).disposal === 2), "fixture: the sprite has clearing frames");
  const play = spritePlayer(sprite);
  const shown = (ms) => Buffer.from(play(ms).getContext("2d").getImageData(0, 0, width, height).data);
  assertTrue(sprite.starts.every((ms, k) => shown(ms).equals(full[k])), "every frame matches a full decode");
  assertTrue(shown(sprite.starts[3]).equals(full[3]), "jumping back to an earlier frame");
  assertTrue(shown(sprite.duration + sprite.starts[5]).equals(full[5]), "the animation loops");
  assertTrue(!("frames" in sprite), "a cached sprite keeps its GIF file, not every decoded frame (about 5 MB for 12 sprites)");
}

section("Sprite files");
{
  // The player handles GIF disposal 0-2. Disposal 3 (restore the previous
  // frame) would need a saved copy of each frame; no sprite uses it today.
  const bad = [];
  for (const folder of ["normal", "shiny", "grayscale"]) {
    const dir = new URL(`../public/sprites/pokemon/${folder}/`, import.meta.url);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".gif"))) {
      const r = new GifReader(fs.readFileSync(new URL(file, dir)));
      for (let i = 0; i < r.numFrames(); i++) if (r.frameInfo(i).disposal === 3) { bad.push(`${folder}/${file}`); break; }
    }
  }
  assertEqual(bad, [], "no sprite uses GIF disposal 3");
}

finish();
