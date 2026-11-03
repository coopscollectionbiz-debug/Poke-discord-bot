// ==========================================================
// tests/battleRender.test.js
// Which turns playback shows, turn narration, layout, and the animated GIF.
// ==========================================================

import fs from "fs";
import { GifReader } from "omggif";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  pickFrameTurns, renderBattleFrame, tileCenter, turnText, ANIMATION, FRAME_WIDTH,
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
assertEqual([reader.width, reader.numFrames()], [FRAME_WIDTH, ANIMATION.eventFrames + ANIMATION.holdFrames], "one attack plays, then holds");
const idleGif = await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [1]], screens: [["The battle begins!", ""]] });
const idle = new GifReader(idleGif);
assertEqual(idle.numFrames(), ANIMATION.idleFrames, "with no attacks it loops the idle animation");
const twoScreens = new GifReader(await renderBattleFrame({ sides, hpBefore: [[1, 1, 1, 1, 1, 1], [0]], screens: [["Ash defeated Gary!", ""], ["Charizard grew to Lv37!", ""]], winnerSide: 0 }));
assertEqual(twoScreens.numFrames(), 2 * ANIMATION.idleFrames, "each text screen gets its own stretch of the loop");
assertTrue(!Buffer.from(decodeFrame(idle, 0)).equals(Buffer.from(decodeFrame(idle, 10))), "sprites animate between frames");
// A missing sprite (#9999) still renders the frame.
if (process.env.BATTLE_FRAME_OUT) fs.writeFileSync(process.env.BATTLE_FRAME_OUT, attack);

finish();
