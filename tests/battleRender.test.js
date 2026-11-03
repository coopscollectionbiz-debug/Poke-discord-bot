// ==========================================================
// tests/battleRender.test.js
// Which turns playback shows, turn narration, layout, and the animated GIF.
// ==========================================================

import fs from "fs";
import { GifReader } from "omggif";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  pickFrameTurns, renderBattleFrame, tileCenter, turnText, deltaFrame, ANIMATION, FRAME_WIDTH,
} from "../utils/battle/render.js";

section("Frame turns");
assertEqual(pickFrameTurns(20, 4), [5, 10, 15, 20], "evenly spaced, last is the final turn");
assertEqual(pickFrameTurns(2, 4), [1, 2], "short battles don't repeat frames");
assertEqual(pickFrameTurns(7, 4), [2, 4, 5, 7], "uneven lengths still end on the final turn");
assertEqual(pickFrameTurns(9, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9], "battles up to 12 turns show every turn");
assertEqual(pickFrameTurns(49, 12).length, 12, "longer battles are capped at 12 updates");

section("Centered rows");
assertTrue([1, 2, 5, 6].every((n) => tileCenter(n, 0) + tileCenter(n, n - 1) === FRAME_WIDTH), "every row is centered");

section("Delta frames");
{
  // 4x3 RGBA: one pixel changes at (2, 1); everything else must become transparent and be cropped away.
  const px = (rgb) => [...rgb, 255];
  const prev = new Uint8Array(Array.from({ length: 12 }, () => px([10, 20, 30])).flat());
  const next = prev.slice();
  next.set(px([200, 0, 0]), (1 * 4 + 2) * 4);
  assertEqual(deltaFrame(prev, next, 4, 3), { left: 2, top: 1, width: 1, height: 1, data: new Uint8Array([200, 0, 0, 255]) },
    "only the changed pixel is kept, cropped to its box");
  const two = next.slice();
  two.set(px([0, 200, 0]), (0 * 4 + 0) * 4);
  const d = deltaFrame(next, two, 4, 3);
  assertEqual([d.left, d.top, d.width, d.height], [0, 0, 1, 1], "the box covers just the change");
  const wide = prev.slice();
  wide.set(px([1, 1, 1]), 0);
  wide.set(px([2, 2, 2]), (2 * 4 + 3) * 4);
  const w = deltaFrame(prev, wide, 4, 3);
  const alpha = (x, y) => w.data[(y * w.width + x) * 4 + 3];
  assertEqual([w.width, w.height, alpha(3, 2), alpha(1, 0)], [4, 3, 255, 0], "unchanged pixels inside the box are transparent");
  assertEqual(deltaFrame(prev, prev.slice(), 4, 3), { left: 0, top: 0, width: 1, height: 1, data: new Uint8Array(4) },
    "no change is a single transparent pixel");
}

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
// A missing sprite (#9999) still renders the frame.
if (process.env.BATTLE_FRAME_OUT) fs.writeFileSync(process.env.BATTLE_FRAME_OUT, attack);

finish();
