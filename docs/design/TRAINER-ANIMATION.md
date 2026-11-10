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
  - **Standalone GIFs** (embeds, web): rest about 900 ms, lag 110, exhale about 700, lag 110, scaled per trainer (below).
  - **Cards** (24 frames, 100 ms): `poseAtFrame` gives rest ×11, lag, exhale ×9, lag, rest ×2, shifted per trainer.

## Offsets and part motions (`utils/trainerMotion.js`, pass 2)

### Offsets

Every trainer gets its own breath **tempo** (0.85× to 1.2×) and **starting point**, both from a hash of its file name. They're stable for that trainer, but trainers shown together (the dashboard, the picker, the leaderboard podium) never breathe in step. On cards, `cardSchedule` shifts the breath by the trainer's phase.

### Part motions (`data/sprites/trainer-parts.json`, 169 trainers)

- **How a move works:** a part moves exactly 1 px. Each vacated pixel takes the colour of the pixel just behind it, so arms stay attached and clear background stays clear.
- **Several parts in one event all move the same way.** Leon's cape sways like wind; it never bulges.
- **Blinks:** dark eye pixels take the lid colour above them for about 120 ms.
- **Event timing:** events sit at a trainer-specific point in the loop. Frames shorter than 60 ms are folded away, so nothing flickers.

| Motion | Sprites | Source |
|---|---|---|
| Held Poké Ball lifts 1 px and settles | 78 | Detected, then each one reviewed by eye |
| Raised hand nudges outward 1 px, twice | 96 | Detected, then each one reviewed by eye |
| Salute snap + blink (`sailor-gen3`), wave (`hiker`), cape caught by wind (`leon`) | 3 | Hand-made |

- **Detection:** `tools/detect-trainer-parts.mjs <out.json>` proposes candidates; it never writes the data file.
  - It found 206 balls (78 kept: the rest were ties, scarves, shoes, belt balls and trays) and 225 raised hands (96 kept: the rest were hats, hair, headbands, held props and hands near the face).
- **Adding or removing one:** edit `data/sprites/trainer-parts.json`, then run `npm run generate:trainer-idles`.

## Assets (`npm run generate:trainer-idles`)

- `public/sprites/trainers_idle/<name>.gif`: one per selectable sprite (1,271; 6.1 MB with offsets and part motions). Each uses the sprite's exact palette, so the rest frame is pixel-identical to the PNG (loops start at the trainer's own phase, so it isn't always frame 0). One sprite with more than 255 colours (`ash-hoenn`) is quantised.
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
- **Cost:** an animated `/trainercard` renders in about 210 ms median (p95 300 ms with part motions) under the shared GIF gate of 2, against about 24 ms as a PNG; peak RSS about 120 MB.

**Previews:** `docs/design/previews/trainercard-breathing-{common,epic,legendary,mythic}.gif`.
