// ==========================================================
// tests/softPlatformCache.test.js
// drawSoftPlatform draws each floor once into a cached stamp and copies it.
// The copy must match drawing the cells directly, pixel for pixel, on an
// opaque card background, at whole and fractional positions, for every tint
// and grid the cards use; a scaled context must still draw cells directly.
// ==========================================================

import { createCanvas } from "@napi-rs/canvas";
import { assertTrue, section, finish } from "./harness.js";
import { drawSoftPlatform } from "../utils/render/primitives.js";

const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// The cell loop as it was before the cache (the reference).
function direct(ctx, cx, cy, rx, ry, tint, { u, peak }) {
  const [r, g, b] = tint ? [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16)) : [3, 5, 12];
  const nx = Math.ceil(rx / u), ny = Math.ceil(ry / u);
  for (let gy = -ny; gy <= ny; gy++) for (let gx = -nx; gx <= nx; gx++) {
    const d = Math.hypot((gx * u) / rx, (gy * u) / ry);
    if (d >= 1) continue;
    const lv = Math.max(0, Math.min(4, Math.floor((1 - d) * 4 + BAYER4[(gy + 64) & 3][(gx + 64) & 3] / 16 - 0.5)));
    if (!lv) continue;
    ctx.fillStyle = `rgba(${r},${g},${b},${((peak * lv) / 4).toFixed(3)})`;
    ctx.fillRect(Math.round(cx + gx * u - u / 2), Math.round(cy + gy * u - u / 2), u, u);
  }
}

function card(draw) {
  const c = createCanvas(320, 120);
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 320, 120);
  grad.addColorStop(0, "#0e1120");
  grad.addColorStop(1, "#3a2a5c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 120);
  draw(ctx);
  return c.getContext("2d").getImageData(0, 0, 320, 120).data;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

section("The cached floor matches drawing it cell by cell");
const cases = [
  [160, 60, 46, 9, null, { u: 2, peak: 0.55 }],
  [160, 60, 56, 14, "#f5c84c", { u: 2, peak: 0.9 }],
  [160.5, 60.25, 52, 12, "#4f8cff", { u: 2, peak: 0.4 }],
  [101.7, 59.4, 118, 20, "#ff5a6a", { u: 4, peak: 0.5 }],
  [160, 60, 124, 22, "#94a3b8", { u: 4, peak: 0.6 }],
  [33, 20, 36, 6, "#22c55e", { u: 2, peak: 0.6 }], // partly off the canvas
];
for (const [cx, cy, rx, ry, tint, opts] of cases) {
  // Twice: the second call copies the stamp the first one cached.
  const want = card((ctx) => direct(ctx, cx, cy, rx, ry, tint, opts));
  const first = card((ctx) => drawSoftPlatform(ctx, cx, cy, rx, ry, tint, opts));
  const again = card((ctx) => drawSoftPlatform(ctx, cx, cy, rx, ry, tint, opts));
  assertTrue(same(want, first) && same(want, again), `identical: ${rx}×${ry} at (${cx}, ${cy}) tint ${tint} u ${opts.u}`);
}

section("A transformed context draws cells directly");
{
  const want = card((ctx) => { ctx.scale(1.5, 1.5); direct(ctx, 80, 40, 46, 9, "#f5c84c", { u: 2, peak: 0.5 }); });
  const got = card((ctx) => { ctx.scale(1.5, 1.5); drawSoftPlatform(ctx, 80, 40, 46, 9, "#f5c84c", { u: 2, peak: 0.5 }); });
  assertTrue(same(want, got), "scaled: same pixels as the cell loop (no resampled stamp)");
  const wantT = card((ctx) => { ctx.translate(10.5, 0); direct(ctx, 80, 40, 46, 9, null, { u: 2, peak: 0.55 }); });
  const gotT = card((ctx) => { ctx.translate(10.5, 0); drawSoftPlatform(ctx, 80, 40, 46, 9, null, { u: 2, peak: 0.55 }); });
  assertTrue(same(wantT, gotT), "a fractional translate also draws directly");
}

finish();
