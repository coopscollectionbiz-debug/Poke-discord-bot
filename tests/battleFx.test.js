// ==========================================================
// tests/battleFx.test.js
// Battle FX's effect drawing (utils/battle/fx.js): each condition's and
// stat change's beat draws inside the Pokémon's box (with a margin for
// rising flames, Zs and the stat pop), animates from one phase to the
// next, and in the condition's own color; the sprite tint keeps the
// sprite's shape; only paralysis jitters.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { drawEffect, tinted, jitterAt, tintAt, STATUS_COLORS, CHIP_COLORS, EFFECT_COLORS } from "../utils/battle/fx.js";
import { typeStyle } from "../utils/render/tokens.js";

const box = { cx: 100, top: 60, floor: 160, w: 80, h: 100 };
const M = 24; // the margin effects may use around the box
const render = (seg, phase) => {
  const c = createCanvas(200, 200);
  drawEffect(c.getContext("2d"), seg, box, phase);
  return c.getContext("2d").getImageData(0, 0, 200, 200).data;
};
const hue = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
// The circular mean hue of the drawn, colored pixels (white highlights and dark outlines left out).
function meanHue(px) {
  let x = 0, y = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 80 || (max - min) / max < 0.15) continue;
    const h = (hue(r, g, b) * Math.PI) / 180;
    x += Math.cos(h); y += Math.sin(h);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

section("Colors");
assertEqual(STATUS_COLORS.brn, typeStyle("Fire").fill, "burn is the Fire type's color");
assertEqual([STATUS_COLORS.psn, STATUS_COLORS.par, STATUS_COLORS.slp, STATUS_COLORS.frz], ["Poison", "Electric", "Normal", "Ice"].map((t) => typeStyle(t).fill), "poison, paralysis, sleep and freeze are their types' colors");
assertTrue(gap(hue(...hex(STATUS_COLORS.tox)), hue(...hex(STATUS_COLORS.psn))) < 10 && hex(STATUS_COLORS.tox)[0] < hex(STATUS_COLORS.psn)[0], "bad poison is a deeper purple");
assertEqual(CHIP_COLORS, { up: "#ef4b4b", down: typeStyle("Water").fill }, "a raise is the low-HP red, a drop the Water blue");

section("Each effect");
const CASES = [
  [{ fx: "brn" }, STATUS_COLORS.brn], [{ fx: "psn" }, STATUS_COLORS.psn], [{ fx: "tox" }, STATUS_COLORS.tox],
  [{ fx: "par" }, STATUS_COLORS.par], [{ fx: "slp" }, STATUS_COLORS.slp], [{ fx: "frz" }, STATUS_COLORS.frz],
  [{ fx: "confusion" }, EFFECT_COLORS.confusion], [{ fx: "leechseed", side: 1 }, EFFECT_COLORS.leechseed],
  [{ fx: "stats", up: true, down: false, pop: "ATK ▲▲" }, CHIP_COLORS.up], [{ fx: "stats", up: false, down: true, pop: "DEF ▼" }, CHIP_COLORS.down],
  [{ fx: "cure" }, EFFECT_COLORS.cure],
];
for (const [seg, color] of CASES) {
  const name = seg.pop ? `stats ${seg.up ? "up" : "down"}` : seg.fx;
  const px = render(seg, 0.5);
  let inside = 0, outside = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
    if (px[(y * 200 + x) * 4 + 3] < 128) continue;
    const near = x >= box.cx - box.w / 2 - M && x < box.cx + box.w / 2 + M && y >= box.top - M && y < box.floor + M;
    if (near) inside++; else outside++;
  }
  assertTrue(inside > 40 && outside === 0, `${name}: drawn around the Pokémon (${inside} pixels), nothing beyond the margin (${outside})`);
  assertTrue(!Buffer.from(render(seg, 0.25)).equals(Buffer.from(render(seg, 0.75))), `${name}: it moves from one phase to the next`);
  const h = meanHue(px);
  assertTrue(gap(h, hue(...hex(color))) <= 30, `${name}: in its color (hue ${Math.round(h)}°, expected ${Math.round(hue(...hex(color)))}°)`);
  assertTrue(Buffer.from(render(seg, 0.5)).equals(Buffer.from(px)), `${name}: the same phase draws the same frame`);
}

section("Sprite tint and jitter");
{
  const sprite = createCanvas(20, 20);
  const s = sprite.getContext("2d");
  s.fillStyle = "#336699";
  s.fillRect(4, 4, 8, 12);
  s.fillStyle = "#cc3322";
  s.fillRect(10, 2, 6, 6);
  const alpha = (c) => Array.from(c.getContext("2d").getImageData(0, 0, 20, 20).data.filter((_, i) => i % 4 === 3));
  const t = tinted(sprite, STATUS_COLORS.frz, 0.45);
  assertEqual(alpha(t), alpha(sprite), "a tinted sprite keeps its exact shape");
  assertTrue(!Buffer.from(t.getContext("2d").getImageData(0, 0, 20, 20).data).equals(Buffer.from(s.getImageData(0, 0, 20, 20).data)), "and its colors change");
  assertEqual(tintAt({ fx: "frz" }, 0.5), { color: STATUS_COLORS.frz, alpha: 0.45 }, "a frozen Pokémon is tinted ice blue through its beat");
  assertTrue(tintAt({ fx: "brn" }, 0.3).alpha > tintAt({ fx: "brn" }, 0.9).alpha && tintAt({ fx: "brn" }, 0.9).alpha === 0, "a burn flashes orange early in its beat");
  assertEqual(tintAt({ fx: "psn" }, 0.5), null, "other effects don't tint");
  assertTrue(jitterAt({ fx: "par" }, 0) !== jitterAt({ fx: "par" }, 1 / 8) && Math.abs(jitterAt({ fx: "par" }, 0)) === 2, "paralysis jitters 2 px one way, then the other");
  assertTrue(["brn", "slp", "stats", "cure"].every((fx) => jitterAt({ fx }, 0) === 0 && jitterAt({ fx }, 1 / 8) === 0), "nothing else jitters");
}

finish();
