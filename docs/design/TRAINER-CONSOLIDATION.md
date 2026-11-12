# Trainer generation consolidation

**Decided:** 2026-11-11 (owner).

**Rule:** game and generation redraws of the same outfit fold into one sprite per group.
- For example, `twins-gen3`, `-gen3rs`, `-gen4`, `-gen4dp` and `-gen6` fold into `twins.png`.
- **Outfits never fold.** Masters, contest, festival, anime and regional Ash outfits stay their own collectibles. Many are already separate registry entries, such as `stevenmasters`.
- **Female variants are their own groups.** `acetrainerf.png` never folds into `acetrainer.png`.
- **Kept sprite:** the version with an existing animation where there is one (B2W2 preferred over Platinum/HGSS and PokéRogue), otherwise the base sprite.

**Owner decisions:**
- **Beauty:** `beauty-gen4dp`, `beauty-gen5bw2` and `beauty-gen8` stay their own collectibles.
- **Protagonists and rivals:**
  - Blue: the animated B2W2 Blue is the only Blue. Gen 3, Gen 7 and LGPE fold into `blue.png`.
  - Red: the same. Gen 3, Gen 7 and LGPE fold into `red.png`.
  - Cheren: the B2W2 version (`cheren-gen5bw2`) is kept.
  - Dawn: `dawn.png` is kept; `dawn-gen4pt` folds into it.
  - Lucas: `lucas-gen4pt` is kept.
  - May: `may.png` is kept.
  - Wally: `wally-gen3` is kept.
  - Brendan, Elio and Selene keep every version.
- Outfits inside these entries stay their own: Blue's and Red's Masters outfits, Blue's FRLG Champion versions.

**Size:** 362 files fold into 148 kept sprites. With Weird Light added, 910 trainer sprites are offered (1,271 before).

## B2W2 art (owner-approved 2026-11-11)
**Switched:** Blaine, Chuck, Clair, Erika, Pryce, Lance, Lt. Surge, Misty, Red, Roark and Blue now use their B2W2 drawing.
- Each one's file name stays the same, so player data needs no change.
- The image is the B2W2 animation frame that best matches the old pose (frame 0 for Blue, whose B2W2 drawing is different). It's placed where the old figure sat on the same 80×80 canvas.
- For the HGSS-based ones the switch is mostly B2W2's palette and small edits.
- Grayscale copies were regenerated.
- Blue's old blink was removed, because its pose changed. The others keep theirs.

**Not switched:**
- **Janine:** her B2W2 poses are a crouch, a motion smear, or 93 px wide, so she keeps her HGSS art.

**New collectible:**
- **Weird Light** (B2W2 Pokéstar Studios, Uncommon): frame 0 of the B2W2 animation.

**Not added:**
- **Mecha Cop:** its B2W2 sprite is 86–109 px tall and doesn't fit the 80×80 trainer canvas.

The real B2W2 animations aren't wired in yet. These sprites use the procedural idle for now.

## Data and tools
- `data/sprites/trainer-consolidation.json`: `{ into: { foldedFile: keptSprite } }`.
- `tools/apply-trainer-consolidation.mjs [--check]`: writes the map into `trainerSprites.json` and its public copy.
  - Each folded file becomes `{ "file": "twins-gen3.png", "disabled": true, "mergedInto": "twins.png" }`.
  - It's no longer offered by recruit, the shop or the picker.
  - Its PNG stays on disk, so old links still load.
  - Taking a file out of the map puts it back on offer.
- The idle generator only builds selectable sprites, so folded files have no idle GIF.
- Part motions on folded files were removed from `data/sprites/trainer-parts.json`; their groups keep their own.

## Player migration (`services/trainerConsolidation.js`)
This runs for every player in `normalizeUserSchema`, at boot and on load. Running it twice changes nothing.

- **Owned copies:** each owned folded file is removed, and its kept sprite is granted if the player doesn't already own it. Owning `cynthia-gen4.png` becomes owning `cynthia.png`.
- **Duplicates:** several versions of one group collapse to a single copy.
- **Displayed trainer:** a displayed trainer that folded becomes its kept sprite.
- **No refunds:** there's no currency refund, because most trainers were collected before they could be bought.
- **Achievements:** earned achievements are never revoked. The retro evaluator only adds.
- **Notice:** one notice per affected player (`NOTICE_KINDS.TRAINER_CONSOLIDATION`). It's sent as a private follow-up to their next `/trainercard`.
- **Boot log:** `🧩 Trainer collections consolidated…` counts the players changed on that boot.
- **New grants:** `grantTrainer` of a folded file grants its kept sprite, so an old reward or admin command can't hand one out again.

Tests: `tests/trainerConsolidation.test.js`.
