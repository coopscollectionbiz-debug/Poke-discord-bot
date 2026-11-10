# Gen 6–9 Rollout Recommendations

Based on the verified counts in `SPRITE-AVAILABILITY-AUDIT.md` (2026-11-09) and the code findings in `BOT-EXPANSION-COMPATIBILITY.md`. **Nothing here is approved or implemented.**

## 1. Verified coverage the options are built on

| Generation (region) | Species | A (animated + animated shiny) | B (animated, shiny static or tracker-only) | C (static 2D only) | D/E/U |
|---|---:|---:|---:|---:|---:|
| Gen 6 (Kalos) | 72 | 48 | 6 | 18 | 0 |
| Gen 7 (Alola) | 88 | 74 | 0 | 14 | 0 |
| Gen 8 (Galar + Hisui) | 96 | 65 | 2 | 29 | 0 |
| Gen 9 (Paldea + DLC) | 120 | 25 | 0 | 95 | 0 |
| **Total** | **376** | **212** | **8** | **156** | **0** |

Because there are no D/E/U species, **every** species can be shown in the existing BW pixel-art style. The only question is whether it moves.

## 2. Options

### Option A — Animated only

Enable only species with a published animated front **and** animated shiny (class A). A′ also admits the 7 published B species, whose shiny would be static.

| | Gen 6 | Gen 7 | Gen 8 | Gen 9 | Total |
|---|---:|---:|---:|---:|---:|
| Eligible (A) | 48 (66.7%) | 74 (84.1%) | 65 (67.7%) | 25 (20.8%) | 212 (56.4%) |
| Eligible (A′) | 54 (75.0%) | 74 (84.1%) | 66 (68.8%) | 25 (20.8%) | 219 (58.2%) |

- **Visual consistency:** perfect. Every new Pokémon animates, like #1–649.
- **Missing shiny coverage:** none in A. In A′, 7 species have a static shiny.
- **Complexity:** low for sprites. **High for game design**: evolution lines get split (e.g. Chespin is C, Quilladin is A; Dartrix/Decidueye are C, Rowlet is A, so Rowlet could not evolve). Regions are never complete, so region achievements cannot be added.
- **Player experience:** gaps look arbitrary ("why is Sprigatito missing?"). A Gen 9 release of 25 species is thin.
- **Maintenance:** each newly published animation becomes a small release (data row + sprites + battle data).
- **Risk:** broken evolution chains need special-casing in `evolvesTo`. Partial regions confuse Pokédex completion.

### Option B — Animated preferred, static fallback

Enable species with animated sprites, and use a static BW sprite (shipped as a single-frame GIF) where no animation exists.

| | Gen 6 | Gen 7 | Gen 8 | Gen 9 | Total |
|---|---:|---:|---:|---:|---:|
| Eligible | 72 (100%) | 88 (100%) | 96 (100%) | 120 (100%) | 376 (100%) |
| …animated | 54 (75.0%) | 74 (84.1%) | 67 (69.8%) | 25 (20.8%) | 220 (58.5%) |
| …static | 18 | 14 | 29 | 95 | 156 |

- **Visual consistency:** same art style everywhere. Static species look like a paused BW sprite. That is mild for Gen 6–8 (16–30% static) and pronounced for Gen 9 (79% static).
- **Missing shiny coverage:** animated shiny for 213. Static shiny for the other 163. **No species lacks a distinct shiny.**
- **Complexity:** the same as A for code. No special-casing of evolution lines or regions.
- **Player experience:** complete regions, working region achievements, intact evolution lines.
- **Maintenance:** upgrading a static species to animated is a **file swap at the same path** (`normal/{id}.gif`, `shiny/{id}.gif`, grayscale), with no data or player change. Re-run `scripts/02`–`05` periodically to find newly published animations.
- **Risk:** low. Possible player comments about "frozen" sprites, mostly in Gen 9.

### Option C — Complete generation rollout

Enable entire generations at once with the best available 2D asset, and track missing animations for later.

- **Eligible:** the same 376 / 100% as Option B, because nothing is D/E/U, so "best available" is always pixel art. The real difference from B is **cadence**: C releases whole generations, while B could release any subset.
- **Visual consistency / shiny / maintenance:** as in Option B.
- **Complexity:** highest *per release*. All of a generation's battle data, tiers, regions and evolutions land together, and up to four regions' achievements would arrive at once if all generations shipped together.
- **Risk:** a large step change to spawn odds. Adding all 376 species roughly halves each existing species' per-tier odds, and the 46 new legendary/mythical species nearly double that pool (69 today). That is a big change for players mid-hunt.

## 3. Recommendation

**Use Option B, released region by region, ordered by verified animation coverage.** Option A's partial regions and split evolution lines cost more in game design than static sprites cost in looks. Option C's all-at-once release is an unnecessary shock to spawn odds.

### Phase 0 — prerequisites (no species enabled)

1. Owner decisions: non-profit status (licensing), legacy Fairy retyping, region naming for Hisui/DLC species, cross-generation evolutions (18 existing species), shiny-static acceptance.
2. Send the Gen 6 notice to Layell, and add a credits page (project threads + per-sprite artists from the CSV).
3. Enabled-species allow-list in `getAllPokemon()`, replacing `RECRUIT_MAX_DEX`.
4. `battleData.json` generator extended to the allow-listed species; type 18 + icon; tests updated; battle balance re-run.
5. Confirm `RENDER_EXTERNAL_URL` on Fly points at the host that serves `public/`.
6. Sprite import script: download the preferred URL, check SHA-1 against the CSV, trim, convert static → single-frame GIF, generate grayscale, write to `public/sprites/pokemon/...`.

### Phase 1 — Gen 7 / Alola (recommended first expansion)

- **88 species: 74 fully animated (84.1%), 14 static.** This is the highest animated share of any generation, and every species has a distinct shiny.
- **Static in this phase (14):** Dartrix, Decidueye, Torracat, Oricorio, Mareanie, Salandit, Salazzle, Tsareena, Oranguru, Passimian, Golisopod, Tapu Fini, Guzzlord, Poipole. Note that three starter evolutions are static. The tracker shows Dartrix and Decidueye reserved by an animator, so they may arrive soon.
- **Legendaries:** 24 of 27 legendary/mythical/Ultra Beast species are animated (static: Tapu Fini, Guzzlord, Poipole).
- **Adds one region** ("Alola", 88), with its two region achievements (+ `CATALOG_REVISION` bump).
- **Cross-generation evolution:** none in Gen 7. Alolan regional forms are not needed for any Gen 7 species.
- **Fairy types needed:** Comfey, Tapu Koko/Lele/Bulu/Fini, Primarina, Mimikyu, Magearna, Cutiefly/Ribombee, Morelull/Shiinotic (so Phase 0 item 4 still applies).

**Alternative Phase 1 if the owner prefers Option A:** the 212 class-A species across all four generations, with no region achievements and with `evolvesTo` filtered to enabled targets. This is not recommended, for the reasons above.

### Phase 2 — Gen 6 / Kalos

72 species: 54 animated (75%; 48 with animated shiny), 18 static. Brings Sylveon (Eevee's evolution, edited onto existing Eevee). Gen 6 notice must have been sent.

### Phase 3 — Gen 8 / Galar (+ Hisui decision)

96 species: 67 animated (69.8%), 29 static. Includes 12 of the 18 cross-generation evolutions, and the regional-form evolutions need the Phase 0 decision. Spectrier's animation is tracker-only. Ship it static until it is published.

### Phase 4 — Gen 9 / Paldea

120 species, but **only 25 animated (20.8%)**. Recommendation: hold Gen 9 until either the owner accepts a mostly static region, or coverage improves. Re-run the probe each quarter. The Smogon Gen 9 project is active, but animations lag the statics (0 Gen 9 back sprites so far). If shipped static, every later upgrade is a no-data file swap.

### Later — forms

The data model has no forms. If they are wanted, Megas (24 of 48 X/Y/ORAS animated, 0 of 43 Z-A) and Gigantamax (11 of 34) are the weakest. Alolan forms (19 of 21) and Galarian forms (13 of 20) are the strongest. Treat forms as a separate design project.

## 4. Per-phase checks

- Spawn odds: recompute per-tier pool sizes and decide whether new species get a temporary featured weight or the plain tier pool.
- Achievements: one new region per phase. Verify retro evaluation on a copy of production data (`npm run test:safe`, plus a dry run).
- No species is ever removed once enabled (see the rollback risk in compat §8). To pause a species, use the allow-list to stop it spawning.
