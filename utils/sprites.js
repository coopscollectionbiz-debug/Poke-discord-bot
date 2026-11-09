// ==========================================================
// utils/sprites.js — deterministic Pokémon sprite resolution.
//
// Every species has exactly one normal, one shiny and one grayscale GIF,
// listed in data/sprites/sprites.json (built by tools/import-sprites.mjs
// from the audited source manifest). Lookups never construct filenames
// from guesses and never substitute the normal sprite for a shiny one:
// a missing variant resolves to the Poké Ball placeholder and is logged.
// ==========================================================

import fs from "fs";
import { publicBaseUrl } from "./publicUrl.js";

const MANIFEST = JSON.parse(fs.readFileSync(new URL("../data/sprites/sprites.json", import.meta.url), "utf8")).species;
export const PLACEHOLDER_PATH = "/public/sprites/items/pokeball.png";
const reported = new Set();

/** Manifest record for a species (or null). */
export const spriteRecord = (id) => MANIFEST[Number(id)] ?? null;

/** "normal" | "shiny" | "grayscale" → "/public/sprites/pokemon/<file>", or the placeholder. */
export function pokemonSpritePath(id, variant = "normal") {
  const v = variant === true ? "shiny" : variant === false ? "normal" : variant;
  const rec = spriteRecord(id)?.[v];
  if (rec?.file) return `/public/sprites/pokemon/${rec.file}`;
  const key = `${id}:${v}`;
  if (!reported.has(key)) {
    reported.add(key);
    console.warn(`⚠️ No ${v} sprite for Pokémon #${id}; showing the placeholder.`);
  }
  return PLACEHOLDER_PATH;
}

/** Absolute URL for Discord embeds. `shiny` may be a boolean or a variant name. */
export const pokemonSpriteUrl = (id, shiny = false, env = process.env) => `${publicBaseUrl(env)}${pokemonSpritePath(id, shiny)}`;

/** True when the sprite for this variant is animated (more than one frame). */
export const isAnimatedSprite = (id, variant = "normal") => spriteRecord(id)?.[variant]?.kind === "animated";
