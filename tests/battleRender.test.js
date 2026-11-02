// ==========================================================
// tests/battleRender.test.js
// Frame timing and the battle frame PNG.
// ==========================================================

import fs from "fs";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { pickFrameTurns, renderBattleFrame } from "../utils/battle/render.js";

section("Frame turns");
assertEqual(pickFrameTurns(20, 4), [5, 10, 15, 20], "evenly spaced, last is the final turn");
assertEqual(pickFrameTurns(2, 4), [1, 2], "short battles don't repeat frames");
assertEqual(pickFrameTurns(7, 4), [2, 4, 5, 7], "uneven lengths still end on the final turn");

section("Render");
const mon = (speciesId, level, variant = "normal") => ({ speciesId, level, variant, name: `#${speciesId}` });
const png = await renderBattleFrame({
  sides: [
    { name: "Ash", members: [mon(6, 36), mon(25, 20, "shiny"), mon(1, 5), mon(150, 40), mon(9999, 1), mon(19, 3)] },
    { name: "Gary", members: [mon(9, 36)] },
  ],
  hp: [[1, 0.5, 0, 0.1, 1, 1], [0.25]],
  caption: "Turn 12",
  surgeSide: 1,
});
assertTrue(Buffer.isBuffer(png) && png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "renders a PNG");
assertTrue(png.length > 10_000, "the PNG has real content");
// A missing sprite (#9999) still renders the frame.
if (process.env.BATTLE_FRAME_OUT) fs.writeFileSync(process.env.BATTLE_FRAME_OUT, png);

finish();
