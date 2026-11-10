// ==========================================================
// tests/spriteFx.test.js — the dashboard's sprite backdrops
// (public/shared/spriteFx.js) must match the Discord cards'
// (utils/render/shinyBackdrop.js, utils/render/trainerBackdrop.js).
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const fx = await import("../public/shared/spriteFx.js");
const server = await import("../utils/render/shinyBackdrop.js");
const { createBackdrop, hasBackdrop } = await import("../utils/render/trainerBackdrop.js");
const { FRAMES, DELAY_MS, backdropSeed } = await import("../utils/render/stage.js");

section("same loop, colours and constants as the Discord cards");
assertEqual([fx.FRAMES, fx.DELAY_MS], [FRAMES, DELAY_MS], "24 frames × 100 ms");
assertEqual(fx.SHINY_GOLD, server.SHINY_GOLD, "shiny gold #facc15");
const shinySrc = fs.readFileSync(new URL("../utils/render/shinyBackdrop.js", import.meta.url), "utf8");
const num = (name) => Number(shinySrc.match(new RegExp(`const ${name} = ([0-9]+)`))[1]);
assertEqual([fx.SHINY.DILATE, fx.SHINY.MARGIN], [num("DILATE"), num("MARGIN")], "shiny clear space and margin");
assertEqual(JSON.stringify(fx.SHINY.LEVELS), shinySrc.match(/const LEVELS = (\[[^\]]+\])/)[1].replace(/\s/g, ""), "shiny tint levels");
assertTrue(shinySrc.includes("const REF_AREA = 120 * 104") && fx.SHINY.REF_AREA === 120 * 104, "shiny density reference");
for (const id of [1, 25, "mega-charizard-x", 1025]) assertEqual(fx.backdropSeed(id), backdropSeed(id), `same layout seed for ${id}`);
for (const t of ["common", "rare", "epic", "legendary", "mythic", "", null]) assertEqual(fx.hasTrainerBackdrop(t), hasBackdrop(t), `trainer backdrop for "${t}"`);

section("trainer backdrops: pixel-identical frames to the Discord renderer");
{
  const W = 90, H = 120;
  const mask = new Uint8Array(W * H);
  for (let y = 30; y < 110; y++) for (let x = 30; x < 60; x++) mask[y * W + x] = 1; // a trainer-shaped block
  const halo = { cx: 45, cy: 60, rx: 40, ry: 54 }, floorRow = 112;
  for (const tier of ["epic", "legendary", "mythic"]) {
    const ref = createBackdrop({ tier, gridW: W, gridH: H, mask, halo, floorRow, frames: FRAMES });
    const ours = fx.trainerRecipe({ tier, W, H, mask, halo, floorRow });
    let diff = 0;
    for (const f of [0, 5, 11, 17, 23]) {
      const a = ref.frame(f).getContext("2d").getImageData(0, 0, W, H).data;
      const b = new Uint8ClampedArray(W * H * 4);
      ours.draw((x, y, c, al) => b.set([c[0], c[1], c[2], Math.round(al * 255)], (y * W + x) * 4), f);
      // The server's frame went through a canvas (premultiplied alpha), so
      // faint pixels' colours come back rounded: alpha must match exactly,
      // colour within that rounding.
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] !== b[i + 3]) { diff++; continue; }
        if (!a[i + 3]) continue;
        const tol = Math.ceil(255 / a[i + 3]) + 1;
        for (let c = 0; c < 3; c++) if (Math.abs(a[i + c] - b[i + c]) > tol) diff++;
      }
    }
    assertEqual(diff, 0, `${tier}: 5 frames identical`);
  }
  assertEqual(fx.trainerRecipe({ tier: "rare", W, H, mask, halo, floorRow }), null, "rare and below: no backdrop");
}

section("shiny backdrop: never over the sprite, seamless loop");
{
  const LW = 60, LH = 52;
  const solid = new Uint8Array(LW * LH);
  for (let y = 20; y < 50; y++) for (let x = 22; x < 38; x++) solid[y * LW + x] = 1;
  const r = fx.shinyRecipe({ LW, LH, solid, seed: 7 });
  assertTrue(r && r.stars >= 3 && r.motes >= 1, "stars and motes are placed");
  const frame = (f) => { const m = new Map(); r.draw((x, y, c, a) => m.set(`${x},${y}`, a), f); return m; };
  let onSprite = 0;
  for (let f = 0; f < FRAMES; f++) for (const k of frame(f).keys()) { const [x, y] = k.split(",").map(Number); if (solid[y * LW + x]) onSprite++; }
  assertEqual(onSprite, 0, "no cell drawn over the sprite in any frame");
  assertEqual([...frame(FRAMES)], [...frame(0)], "frame 24 = frame 0 (seamless)");
}

section("pages use it");
for (const f of ["public/teams/script.js", "public/picker-pokemon/script.js", "public/picker/script.js"]) {
  const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assertTrue(src.includes('from "/public/shared/spriteFx.js"') && src.includes("scanFx("), `${f} mounts the backdrops`);
}

finish();
