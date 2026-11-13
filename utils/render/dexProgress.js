// ==========================================================
// utils/render/dexProgress.js
// A player's Pokédex completion, as CONTEXT.md defines it: distinct species
// registered in their Pokédex (ever caught, either variant; never drops),
// counted per region and nationally. "National" is out of the species in released generations
// (isAcquirable: 649 with Generations 1–5), so it grows as generations are
// released. Read-only. Shown privately (/daily, /pokedex), never on public
// cards.
// ==========================================================

import fs from "fs";
import { isAcquirable } from "../speciesCatalog.js";
import { MAX_DEX } from "../../config/generations.js";
import { regionCompletion } from "./catchCard.js";
import { registeredMask } from "../../services/box.js";
import { COLOR } from "./tokens.js";
import { rr, font } from "./primitives.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));

/** { owned, total } across every released species. */
export function nationalCompletion(user) {
  let owned = 0, total = 0;
  for (let id = 1; id <= MAX_DEX; id++) {
    if (!isAcquirable(id)) continue;
    total++;
    if (registeredMask(user, id) > 0) owned++;
  }
  return { owned, total };
}

/**
 * Progress for the regions of the given species (deduplicated, in order),
 * then national. → [{ label, owned, total }, …]
 */
export function dexProgress(user, speciesIds = []) {
  const regions = [...new Set(speciesIds.map((id) => POKEMON[id]?.region).filter(Boolean))];
  const rows = regions.map((r) => regionCompletion(user, r)).filter(Boolean).map((c) => ({ label: c.region, owned: c.owned, total: c.total }));
  const n = nationalCompletion(user);
  return [...rows, { label: "National", owned: n.owned, total: n.total }];
}

/**
 * Draws progress rows side by side in a w-wide band starting at (x, y):
 * "KANTO  121/151" over a thin bar for each. Height ≈ 40.
 */
export function drawDexProgress(ctx, rows, x, y, w) {
  const gap = 24, cw = (w - gap * (rows.length - 1)) / rows.length;
  rows.forEach((r, i) => {
    const cx = x + i * (cw + gap);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(16, 800);
    ctx.fillStyle = r.label === "National" ? COLOR.text : COLOR.textMuted;
    ctx.fillText(r.label.toUpperCase(), cx, y + 16);
    ctx.textAlign = "right";
    ctx.font = font(18, 800);
    ctx.fillStyle = COLOR.text;
    ctx.fillText(`${r.owned.toLocaleString("en-US")}/${r.total.toLocaleString("en-US")}`, cx + cw, y + 16);
    ctx.textAlign = "left";
    ctx.fillStyle = "#0c111e";
    rr(ctx, cx, y + 26, cw, 10, 5);
    ctx.fill();
    if (r.owned > 0) {
      ctx.fillStyle = COLOR.exp;
      rr(ctx, cx, y + 26, Math.max(10, (cw * r.owned) / r.total), 10, 5);
      ctx.fill();
    }
  });
}
