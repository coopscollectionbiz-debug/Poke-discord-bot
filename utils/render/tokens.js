// ==========================================================
// utils/render/tokens.js
// Design tokens for server-rendered Discord images. The dashboard mirrors
// these as CSS custom properties (docs/design/DESIGN-SYSTEM.md), so both
// surfaces read as one product. Values are anchored on the battle renderer
// (utils/battle/render.js): its ink, night-sky background, gold accent and
// game-style HP colors are the reference.
//
// Presentation only: nothing here feeds game logic.
// ==========================================================

export const FONT = "'Segoe UI', 'DejaVu Sans', 'Noto Sans', system-ui, Arial, sans-serif";

export const COLOR = Object.freeze({
  ink: "#0e1120", // battle INK: outlines, chip text on light fills
  bgTop: "#141a2c", // battle background gradient
  bgBottom: "#1d1530",
  surface: "#1b2236", // cards on the background
  surfaceRaised: "#232b44",
  surfaceSunken: "#121729",
  line: "#2e3756", // hairlines and card borders
  text: "#f4f6fb",
  textMuted: "#aab2c8",
  textFaint: "#6f7891",
  gold: "#f5c84c", // battle GOLD: winners, shiny, lead
  goldSoft: "#f5c84c33",
  blue: "#4f8cff", // battle side colors
  red: "#ff5a6a",
  exp: "#5ab4ff", // EXP bar (the games' blue)
  hp: { high: "#3fd46c", mid: "#f5c431", low: "#ef4b4b" },
  textbox: "#f8f8f0",
  textboxBorder: "#3a4256",
  mega: "#c084fc", // Mega Evolution: MEGA tags and Mega card accents (dashboard --cc-mega)
});

// The 18 types. Each has a fill (chip background) and a readable label color.
// Colors are this project's own tuning of the conventional type hues.
export const TYPE = Object.freeze({
  Normal: { fill: "#a8a77a", text: COLOR.ink },
  Fighting: { fill: "#c8423a", text: "#ffffff" },
  Flying: { fill: "#98a8f0", text: COLOR.ink },
  Poison: { fill: "#a04aa0", text: "#ffffff" },
  Ground: { fill: "#dcbc68", text: COLOR.ink },
  Rock: { fill: "#b8a038", text: COLOR.ink },
  Bug: { fill: "#a8b820", text: COLOR.ink },
  Ghost: { fill: "#705898", text: "#ffffff" },
  Steel: { fill: "#b8b8d0", text: COLOR.ink },
  Fire: { fill: "#f08030", text: COLOR.ink },
  Water: { fill: "#6890f0", text: "#ffffff" },
  Grass: { fill: "#6cc04a", text: COLOR.ink },
  Electric: { fill: "#f8d030", text: COLOR.ink },
  Psychic: { fill: "#f85888", text: "#ffffff" },
  Ice: { fill: "#98d8d8", text: COLOR.ink },
  Dragon: { fill: "#7038f8", text: "#ffffff" },
  Dark: { fill: "#5a4a40", text: "#ffffff" },
  Fairy: { fill: "#ee99ac", text: COLOR.ink },
});
export const UNKNOWN_TYPE = Object.freeze({ fill: "#5b6478", text: "#ffffff" });
export const typeStyle = (name) => TYPE[name] ?? UNKNOWN_TYPE;

// Tier (rarity) colors are the existing ones (spriteconfig.js rarityColors),
// kept so players' learned associations survive the redesign.
export const TIER = Object.freeze({
  common: "#9ca3af",
  uncommon: "#10b981",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#facc15",
  mythic: "#ef4444",
});
export const tierColor = (t) => TIER[String(t || "").toLowerCase()] ?? TIER.common;
// Pips instead of emoji stars: canvas fonts on the Linux image have no emoji.
export const TIER_PIPS = Object.freeze({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 });

export const SPACE = Object.freeze({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
export const RADIUS = Object.freeze({ chip: 999, sm: 8, md: 14, lg: 20 });
// Type scale for 1200 px-wide images. Discord shows them at roughly 40–50 %
// on desktop and ~30 % on phones, so nothing a player must read is under 22.
export const TEXT = Object.freeze({ display: 40, title: 30, body: 24, label: 22, micro: 18 });
