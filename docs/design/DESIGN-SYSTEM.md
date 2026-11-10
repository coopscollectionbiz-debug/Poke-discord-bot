# Design System — Coop's Collection

Milestone A, part 2. One visual language for two renderers:

- **Discord images:** `@napi-rs/canvas`, tokens in `utils/render/tokens.js`, pieces in `utils/render/primitives.js`.
- **Web dashboard:** CSS custom properties with the same values (§8). This is proposed and not yet applied.

The two surfaces share **tokens and rules**, not code. Forcing the browser and the canvas through one rendering framework would add a build step to a dashboard that has none, for no player benefit.

**Direction:** a modern Pokémon game UI, built on the battle screen's night sky, ink and gold. The art is 2D pixel sprites drawn crisply. Cards are quiet, so the Pokémon and their type colors carry the color.

---

## 1. Color

### Core (from the battle renderer)

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0e1120` | Outlines, dark text on light chips |
| `bg-top` / `bg-bottom` | `#141a2c` / `#1d1530` | Image and page background gradient |
| `surface` | `#1b2236` | Cards |
| `surface-raised` | `#232b44` | Move pills, hovered cards |
| `surface-sunken` | `#121729` | Sprite stages, bar tracks |
| `line` | `#2e3756` | 1.5 px card hairlines, dividers |
| `text` / `text-muted` / `text-faint` | `#f4f6fb` / `#aab2c8` / `#6f7891` | Three text levels, never more |
| `gold` | `#f5c84c` | **Shiny**, winner, Team Power number |
| `blue` | `#4f8cff` | **Lead / active / selected** (battle side 1) |
| `red` | `#ff5a6a` | Opponent side, destructive actions |
| `exp` | `#5ab4ff` | EXP bars |
| `hp-high/mid/low` | `#3fd46c` / `#f5c431` / `#ef4b4b` | Battle HP only |
| `textbox` / `textbox-border` | `#f8f8f0` / `#3a4256` | The game text box |

**Meaning is fixed.** Gold always means shiny or achievement, and blue always means lead or selected. The prototype briefly used gold for both "lead" and "shiny", and the screens became ambiguous, so it was corrected.

### Types (18)

Every type has a fill color and a label color (dark ink or white, chosen for contrast). See `TYPE` in `tokens.js`. Fairy is included, and an unknown type falls back to slate `#5b6478`. A type is always shown as a **chip**: an uppercase label on a rounded fill with a light top sheen. It is never an emoji. On the dashboard, the chip is also a filter control.

### Tiers (rarity)

The existing colors are kept (common gray → mythic red) because players already know them. A tier is drawn as a **rarity pill**: the tier name in uppercase ("LEGENDARY") in the tier color, on a tinted fill with a tier-color outline. This is the same pill on the Team card, inspect card and catch card. It replaces the old `⚬ ✦ ☆ ✮` glyphs, which need fonts the server image lacks. An earlier diamond-pip version was dropped at the owner's request. Discord embeds keep the emoji marks, because there the client renders them.

## 2. Typography

| Role | Discord image (1200 px wide) | Dashboard |
|---|---|---|
| Display (trainer, featured name) | 40 / 800 | 28–32 / 800 |
| Title (Pokémon name on a card) | 30 / 800 | 18 / 700 |
| Body (stat values) | 24 / 800 | 15 / 500 |
| Label (sub-lines) | 22 / 600 | 14 / 600 |
| Micro (eyebrows, uppercase) | 18 / 800, letter-case only | 12 / 700, +0.04em tracking |

**Rules:**

- On images, nothing a player must read is below 22 px, because Discord shows images at 30–50 % scale.
- Every string is fitted by measurement: first the font shrinks to a floor, then the text is truncated with an ellipsis. Long names cannot break a layout.
- Numbers use the bold weight. Units and labels ("Lv", "TP") are smaller and muted.
- Font stack: `'Segoe UI', 'DejaVu Sans', 'Noto Sans', system-ui, Arial`. The dashboard keeps Inter.

## 3. Spacing, radii, elevation

- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32. Image outer margins are 24–32. The gap between cards is 16–18.
- **Radii:** chips are fully rounded. Small elements (move pills, stages) use 8–10. Cards use 14. Panels use 18–20.
- **Elevation:** one card shadow (`0 6px 18px #00000066`) plus a 1.5 px hairline. Selection is shown with a 3 px **ring** in blue (lead/selected) or gold (shiny), never with glow stacks.
- **No neon** and no more than one gradient per surface: the background gradient plus soft radial "spotlights" behind sprites, as in battles.

## 4. Components

| Component | Discord (`primitives.js`) | Dashboard (proposed class) | Notes |
|---|---|---|---|
| Background | `drawBackground` | `body` gradient | Night sky + floor glow |
| Card | `drawCard` | `.cc-card` | Surface, hairline, shadow, optional ring |
| Sprite stage | sunken rect + `drawPlatform` | `.cc-stage` | Ellipse platform, lit blue for the lead and gold for a shiny |
| Sprite | `drawSprite` | `<img class="cc-sprite">` with `image-rendering: pixelated` | Uniform 2× (§5) |
| Type chip | `drawTypeChip(s)` | `.cc-type[data-type]` | |
| Rarity pill | `drawTierPill` (showteamRefined.js) | `.cc-tier[data-tier]` | Tier name only |
| Shiny mark | `drawShinyMark` (vector sparkle) | inline SVG | Never the `✨` emoji in images |
| Level | `drawLevel` | `.cc-level` | Small "Lv" + bold number |
| EXP bar | `drawExpBar` | `<progress class="cc-exp">` | Real EXP toward the next Level |
| HP bar | battle `drawHpBar` | — | **Battle only.** There is no persistent HP outside battles, so none is shown. |
| Slot badge | `drawSlotBadge` | `.cc-slot` | 1–6. Slot 1 is filled blue and labeled "LEAD", because it fights first. |
| Poké Ball row | `drawBall` | inline SVG | Filled = slot used |
| Tag | `drawTag` | `.cc-tag` | "LEAD", "NEW", "CLAIMABLE" |
| Text box | battle text box | `.cc-textbox` | Game-voice messages |
| Empty slot | dashed outline, ghost ball, "Slot n · Empty" | `.cc-slot--empty` | Looks deliberate and invites action |

## 5. Sprites

- 2D sprites only (B/W style for all generations, matching battles). No 3D renders.
- **Uniform scale per image.** Every Pokémon in an image is drawn at the same pixel scale (2× on cards, 3× for a featured Pokémon), so Pikachu stays smaller than Gyarados, as in the games, and pixel density never mixes. The trimmed sprite sizes justify this: median 54 px, 97th percentile 86–89 px, largest 102 px. At 2×, about 97 % fit a 180 px stage, and the rest shrink just enough to fit.
- **Hard pixel edges:** smoothing is off at 1× and above. The dashboard uses `image-rendering: pixelated`.
- Sprites are **trimmed** to their opaque bounds and bottom-anchored on the platform, so tall and short sprites stand on the same floor.
- **Animated where the surface allows it:** GIF output plays each sprite's own animation (the battle player). PNG output uses the first frame, which is the idle pose.
- **Fallback chain:** manifest sprite for the variant → Poké Ball placeholder. A missing shiny never silently becomes the normal sprite; this rule already exists in `utils/sprites.js`.
- Shiny treatment: gold sparkle after the name, gold ring, and a faint gold wash behind the sprite. These are visible but subtle.

## 6. Interaction states (dashboard)

| State | Treatment |
|---|---|
| Hover | `surface-raised`, translateY(-1px). The pointer only changes on real controls. |
| Focus | 2 px `blue` outline, 2 px offset, always visible with the keyboard |
| Selected | 3 px blue ring + check badge |
| Disabled | 50 % opacity + `aria-disabled` + a reason in the tooltip or text |
| Loading | Skeleton cards with the stage shape, no spinners over content |
| Empty | Illustration (ghost ball) + one sentence + one action |
| Error | Inline banner in the game text-box style with the server's message. Session expiry gets its own message: "Your dashboard link expired — run /dashboard in Discord". |
| Success | Toast in the text-box style, auto-dismissed after 4 s, `role="status"` |
| Touch targets | Minimum 44 × 44 px |

## 7. Fonts and assets needing approval

- **NEEDS APPROVAL:** Bundle one OFL font for canvas rendering (e.g. Inter, two weights, ~600 KB, registered with `GlobalFonts.registerFromPath`). This makes images identical on dev machines and Fly and matches the dashboard's Inter. Without it, production renders in DejaVu Sans. The layouts already tolerate that (measured fitting), but they will look slightly heavier.
- No new sprite packs are proposed. The existing manifest covers #1–1025, normal/shiny/grayscale.

## 8. Dashboard tokens (proposed `public/shared/tokens.css`)

```css
:root {
  --cc-ink:#0e1120; --cc-bg-top:#141a2c; --cc-bg-bottom:#1d1530;
  --cc-surface:#1b2236; --cc-surface-raised:#232b44; --cc-surface-sunken:#121729;
  --cc-line:#2e3756; --cc-text:#f4f6fb; --cc-text-muted:#aab2c8; --cc-text-faint:#6f7891;
  --cc-gold:#f5c84c; --cc-blue:#4f8cff; --cc-red:#ff5a6a; --cc-exp:#5ab4ff;
  --cc-r-chip:999px; --cc-r-sm:8px; --cc-r-md:14px; --cc-r-lg:20px;
  --cc-s1:4px; --cc-s2:8px; --cc-s3:12px; --cc-s4:16px; --cc-s5:24px; --cc-s6:32px;
  --cc-shadow:0 6px 18px #00000066;
}
.cc-type[data-type="Fire"]{background:#f08030;color:var(--cc-ink)} /* …one rule per type, from tokens.js */
```

The game is dark-themed by identity (the battle screen), so the dashboard stays dark. A light theme is not proposed.

## 9. Discord embeds

Embeds stay where they work (inventory, achievements, pagination), but they should use **one** brand color (`blue` `#4f8cff`). Tier colors are used only when the embed is about one Pokémon, and gold only for shiny or achievement moments. This replaces the six ad-hoc colors.
