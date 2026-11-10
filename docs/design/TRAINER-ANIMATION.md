# Trainer animation

Every trainer sprite gets the same **procedural breathing idle**, built only from the sprite's own pixels. This was the owner's decision (2026-11-10). Authentic game animations exist for some Gen 4/5 trainers but are deliberately not used, so all trainers look consistent. The community artists gave permission for their sprites to be animated this way.

## The breathing idle (`utils/trainerIdle.js`)

- **Poses:**
  - **rest:** the unchanged PNG.
  - **exhale:** the upper body drops 1 px.
  - **clean steps** (owner-approved 2026-11-10): up to 3 in-between poses where only the rows above a "step" row have dropped. On the out-breath the head settles first and the drop works down to the waist; on the in-breath the waist rises first and the head last.
- No colours are added, nothing is redrawn, and there are no blended or faded frames (tried and rejected: they looked like ghosting).
- **Cut lines** are chosen where the 1 px change is invisible:
  - the waist row whose dropped row equals the row above it;
  - the neck row whose repeated row equals the row below it;
  - step rows, one per band of the torso between neck and waist, by the same rule as the waist, each no more visible than the sprite's own seam (min 4 px) and at least 3 rows apart.
- Of 1,271 sprites, 987 get 1–3 clean steps. The other 284 have no clean step row and use the classic head-lag as their one step (the body drops first, the neck row is repeated), which is the earlier loop.
- The leftover difference is the "seam", in pixels.
- **Loops** (`breathLoop`, `poseAtFrame` in `utils/trainerIdle.js`):
  - **Standalone GIFs** (embeds, web): rest about 900 ms, the out-breath steps over 360 ms (eased: they gather in the middle, each ≥ 60 ms), exhale about 700 ms, the in-breath steps over 360 ms. The holds scale per trainer (below); the steps don't.
  - **Cards** (24 frames, 100 ms): the same 2.4 s breath sampled at 100 ms, shifted per trainer. At that speed a 3-step trainer shows 2–3 of its steps each way.

## Offsets and part motions (`utils/trainerMotion.js`, pass 2)

### Offsets

Every trainer gets its own breath **tempo** (0.85× to 1.2×) and **starting point**, both from a hash of its file name. They're stable for that trainer, but trainers shown together (the dashboard, the picker, the leaderboard podium) never breathe in step. On cards, `cardSchedule` shifts the breath by the trainer's phase.

### Part motions (`data/sprites/trainer-parts.json`, 410 trainers)

- **How a move works:** a part moves exactly 1 px. Each vacated pixel takes the colour of the pixel just behind it, so arms stay attached and clear background stays clear.
- **Wind sway** (`kind: "sway"`): only the rows of the rect from `from` down move, so hair or cloth bends where it hangs instead of sliding as a block. It is one hard 1-px step, held about 0.6 s (smoother bending and a gust band were tried and rejected).
- **Several parts in one event all move the same way.** A cape or hair sways one way like wind; it never bulges.
- **Blinks:** each eye rect (one per eye, covering its white and pupil) closes for about 120 ms: the eye takes the lid colour above it and its bottom row becomes the eye's own darkest colour, a lash line.
- **Event timing:** events sit at a trainer-specific point in the loop. Frames shorter than 60 ms are folded away, so nothing flickers.

| Motion | Sprites | Source |
|---|---|---|
| Blink | 359 of the 397 Epic+ sprites (tiers as of the 2026-11-10 re-tier), plus `sailor-gen3` | Eyes proposed by a detector or placed by hand on labelled grids; every one checked open vs closed |
| Held Poké Ball lifts 1 px and settles | 58 | Detected, then each one reviewed close-up at 6× |
| Wind sway of hair, cape, skirt or sleeves | 8 Legendary showcase: `cynthia`, `lance`, `iris-masters`, `diantha`, `geeta` (replaces her ball lift), `wallace-gen6`, `n`, `caitlin-masters` | Hand-placed on zoomed grids, reviewed |
| Salute snap (`sailor-gen3`), wave (`hiker`), cape and hair in the wind (`leon`) | 3 | Hand-made |

- **Blinks are Epic and above only.** Blink events sit at 0.62–0.82 of the loop (per trainer), after Poké Ball lifts and sways, so they never overlap.
- **38 Epic+ sprites don't blink**, because there's no eye to close: masks (Allister, Koga, Will, the Pokéstar masks), silhouettes (`unknown`, `unknownf`), sunglasses or glasses glare (Malva, Maxie Gen 6, Lorelei LGPE), eyes shaded by a cap or hat brim (Red, Red Gen 3, Ingo, Kukui, Giovanni…), costumes (the Conquest heroines, Elaine), eyes drawn closed (Brock Masters, Hala, Hau, Volo, Mustard Master), or eyes that can't be told apart from hair (some Miku and Wallace sprites). The full list is in the PR that added them.
- **Eye detection only proposes.** A detector suggested eyes for every sprite. About 40 % were wrong (hair strands, mouths, hat bands) and were placed by hand on labelled pixel grids, then checked again.
- **If a sprite is re-tiered to Epic+ later**, it needs its eyes added to `trainer-parts.json` by hand (`kind: "blink"`, one rect per eye, at most 5×4 px).
- **Detection:** `tools/detect-trainer-parts.mjs <out.json>` proposes Poké Ball candidates; it never writes the data file.
  - Of 206 ball candidates, 59 were kept after a 6× close-up review (the rest were ties, scarves, shoes, belt balls, trays, skirts and shoulders). Raised-hand nudges were dropped entirely: at 1 px they read as fingers or elbows jutting out.
- **Adding or removing one:** edit `data/sprites/trainer-parts.json`, then run `npm run generate:trainer-idles`.

## Assets (`npm run generate:trainer-idles`)

- `public/sprites/trainers_idle/<name>.gif`: one per selectable sprite (1,271; 10 MB with clean steps, offsets, part motions and blinks). Each uses the sprite's exact palette, so the rest frame is pixel-identical to the PNG (loops start at the trainer's own phase, so it isn't always frame 0). One sprite with more than 255 colours (`ash-hoenn`) is quantised.
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
- **Cost:** an animated `/trainercard` renders in about 230 ms (measured on the four preview cards) under the shared GIF gate of 2, against about 24 ms as a PNG; peak RSS about 120 MB.

**Previews:** `docs/design/previews/trainercard-breathing-{common,epic,legendary,mythic}.gif`.
