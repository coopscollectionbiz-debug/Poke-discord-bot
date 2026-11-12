// ==========================================================
// tools/tint-badges.mjs
// Makes the 8 Badge images in public/sprites/badges/ from FireRed's
// trainer card badge sheet (tools/badges/frlg-trainer-card-badges.png, from
// pret/pokefirered graphics/trainer_card/badges.png). The game draws its
// badges in silver; this tints each with its usual colors so they're easy
// to tell apart, then scales the 16×16 art to the 128×128 Discord wants for
// emojis, pixel for pixel.
//
// Run: npm run generate:badges
// ==========================================================

import fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { GYM_BADGES } from "../public/picker-pokemon/badges.js";

const SHEET = new URL("./badges/frlg-trainer-card-badges.png", import.meta.url);
const OUT = new URL("../public/sprites/badges/", import.meta.url);
const TILE = 16;
const SCALE = 8;

// The sheet's colors: the background (made transparent), 4 grays from light
// to dark (shades 0-3), and the black outline, which every badge keeps.
const BACKGROUND = "8b6273";
const SHADES = ["ffffff", "d5d5d5", "b4b4b4", "7b7b7b"];
const OUTLINE = "000000";

// Each badge's 4 shades, light to dark. Boulder stays silver; Rainbow is
// colored by angle instead.
const RAMPS = {
  brock: null,
  misty: ["eaf7ff", "9fd8ff", "52a8ec", "2462b0"],
  surge: ["fff4c0", "ffcf4a", "f0901e", "b0500c"],
  koga: ["ffe6f3", "f79ccb", "dc5aa2", "8e2a66"],
  sabrina: ["fff6cc", "f5d25a", "d49e1c", "8a620c"],
  blaine: ["ffe2cc", "ff8c4c", "e03c18", "8e1a0a"],
  giovanni: ["eaffdc", "9fe07c", "4fae48", "26703a"],
};

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (r, g, b) => [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

// Python's colorsys.hsv_to_rgb, so the art matches the version first approved.
function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

// The Rainbow Badge's petals take their hue from their angle around the
// center, at each shade's brightness; the silver center stays as it is.
function rainbow(x, y, shade, silver) {
  if (Math.hypot(x - 7.5, y - 7.5) < 3) return silver;
  const hue = (((Math.atan2(y - 7.5, x - 7.5) / (2 * Math.PI)) % 1) + 1) % 1;
  return hsvToRgb(hue, 0.6, [1, 0.9, 0.75, 0.5][shade]).map((c) => Math.trunc(c * 255));
}

const sheet = await loadImage(fs.readFileSync(SHEET));
const read = createCanvas(sheet.width, sheet.height).getContext("2d");
read.drawImage(sheet, 0, 0);
const src = read.getImageData(0, 0, sheet.width, sheet.height).data;

for (const [n, badge] of GYM_BADGES.entries()) {
  const out = createCanvas(TILE * SCALE, TILE * SCALE);
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(TILE * SCALE, TILE * SCALE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const at = 4 * (y * sheet.width + n * TILE + x);
      const color = hex(src[at], src[at + 1], src[at + 2]);
      if (color === BACKGROUND) continue;
      const shade = SHADES.indexOf(color);
      if (shade === -1 && color !== OUTLINE) throw new Error(`${badge.badge}: unexpected color #${color} at ${x},${y}`);
      const pixel = shade === -1 ? rgb(OUTLINE)
        : badge.key === "erika" ? rainbow(x, y, shade, rgb(color))
        : RAMPS[badge.key] ? rgb(RAMPS[badge.key][shade])
        : rgb(color);
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          img.data.set([...pixel, 255], 4 * ((y * SCALE + dy) * TILE * SCALE + x * SCALE + dx));
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const file = new URL(badge.image.split("/").at(-1), OUT);
  fs.writeFileSync(file, out.toBuffer("image/png"));
  console.log(`✅ ${badge.badge} → public/sprites/badges/${badge.image.split("/").at(-1)}`);
}
