# Trainer animation

Every trainer sprite gets the same **procedural breathing idle**, built only from the sprite's own pixels. This was the owner's decision (2026-11-10). Authentic game animations exist for some Gen 4/5 trainers but are deliberately not used, so all trainers look consistent. The community artists gave permission for their sprites to be animated this way.

## The breathing idle (`utils/trainerIdle.js`)

- **Three poses:**
  - **rest:** the unchanged PNG.
  - **head-lag:** the body drops 1 px and the neck row is repeated.
  - **exhale:** the upper body drops 1 px.
- No colours are added and nothing is redrawn.
- **Cut lines** are chosen where the 1 px change is invisible:
  - the waist row whose dropped row equals the row above it;
  - the neck row whose repeated row equals the row below it.
- The leftover difference is the "seam", in pixels.
- **Loops:**
  - **Standalone GIFs** (embeds, web): rest 900 ms, lag 110, exhale 700, lag 110.
  - **Cards** (24 frames, 100 ms): `poseAtFrame` gives rest ×11, lag, exhale ×9, lag, rest ×2.

## Assets (`npm run generate:trainer-idles`)

- `public/sprites/trainers_idle/<name>.gif`: one per selectable sprite (1,271; 4.5 MB). Each uses the sprite's exact palette, so frame 0 is pixel-identical to the PNG. One sprite with more than 255 colours (`ash-hoenn`) is quantised.
- `data/sprites/trainer-idles.json`: the manifest the bot reads (`status`, `seam`, cut rows, `gif`).
- `public/sprites/trainers_idle/manifest.json`: `{ "file.png": "file.gif" }` for the web pages.
- `data/sprites/trainer-idle-review.json`: the manual review record.
  - Sprites with seam > 11 must be listed as `approved`, or they stay static.
  - Any file listed under `excluded` stays static.
  - Reviewed 2026-11-10: all 200 sprites with seam 12–28 were approved; none excluded.
- `--check` verifies everything is up to date. `tests/trainerIdle.test.js` runs it.

Re-run the generator after adding or changing trainer sprites. New sprites with a seam above 11 need a look, then an `approved` entry.

## Where trainers breathe

| Surface | How |
|---|---|
| Embeds: `/recruit`, `/quest`, `/shop` reward, broadcasts, `/showtrainers`, the `/trainercard` picker and fallback, `/inspecttrainer` links | `trainerImageUrl(file)` in `utils/trainerAssets.js` returns the idle GIF, or the PNG. Grayscale (unowned) views stay static. |
| Web trainer picker | Owned trainers and the equip/unlock-success dialogs use the GIF; unowned trainers stay static. |
| `/trainercard` card | `spriteStage.placePosed` animates the poses. **Epic, Legendary and Mythic** also get the tier backdrop (below). |
| `/leaderboard` podium | Breathing only. The medal platforms stay as they are; no tier backdrops. |

Player data never changes: `displayedTrainer` and `trainers[]` keep the `.png` names.

## Tier backdrop (`utils/render/trainerBackdrop.js`)

The backdrop is pixel art on a grid of the trainer's own on-card pixels. Tints are stepped and 2×2-dithered, so nothing bands in the GIF. It is composited over the panel, under the trainer.

| Tier | Backdrop |
|---|---|
| Common–Rare | none (plain panel + tier-lit platform) |
| Epic | purple halo + 8 motes |
| Legendary | amber halo (`#f59e0b`; gold turned muddy on navy) + gold motes + 8 twinkles |
| Mythic | red halo, red/pink motes and twinkles + a meteor shower: 3 per 2.4 s loop at various heights, all down-left at 40°, easing in and out |

Twinkles and meteors are placed only where a dilated silhouette mask of the trainer is clear, so nothing passes behind the trainer. The halo sits under the trainer.

**Rejected during design:** float, shine sweep, pulsing aura, rays, halo swell, orbiting sparkles, and authentic game animations.

## Switches and cost

- `TRAINERS_ANIMATED=0`: every trainer goes back to its static PNG, and backdrops are drawn as one still frame.
- `CARDS_ANIMATED=0`: every card is a PNG, as before.
- **Cost:** an animated `/trainercard` renders in about 200 ms median (p95 240 ms) under the shared GIF gate of 2, against about 24 ms as a PNG; peak RSS about 120 MB.

**Previews:** `docs/design/previews/trainercard-breathing-{common,epic,legendary,mythic}.gif`.
