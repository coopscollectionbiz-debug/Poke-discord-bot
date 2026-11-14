# Outstanding work, known issues and open decisions

## Not implemented (by design or scope)

| Item | State | Notes |
|---|---|---|
| Alternate forms in gameplay (regional variants, Megas, Primal, Gigantamax, Terastal, gender appearances, totems, cosmetic) | **Architecture only** | `data/pokedex/forms.json` holds 361 forms with keys, types, stats, kinds and Showdown sprite ids. `utils/forms.js` handles identity. Achievement metrics count forms toward their base species. Every form is disabled. Not built: form sprites in `public/`, catching or granting forms, form display in the dashboard and embeds, form battles, Mega/Gigantamax/Primal/Terastal mechanics (deliberately not simulated). Sprite coverage per form is in the audit (`pokemon-sprite-inventory.csv`) |
| Form-dependent evolutions (10) | Gated | They need regional forms enabled first |
| Abilities, held items, status conditions | Not modelled | Same as before. The sim has no abilities (except Shedinja's Wonder Guard) |
| Moves whose effect the sim can't model | Excluded on today's engines; all included under `FULL_SIM_ENABLED` (Showdown's engine, `docs/superpowers/specs/2026-11-12-full-sim-design.md`) | Gen 6+ examples: First Impression, Belch, Steel Roller, Upper Hand, Poltergeist, Mind Blown, Steel Beam, Chloroblast, signature form-dependent moves (Aura Wheel, Ivy Cudgel, Raging Bull, Tera Starstorm, Revelation Dance, Multi-Attack). Variable-power moves such as Last Respects and Rage Fist use their listed base power |
| Species with no damaging level-up move | Fallback move | 4 new species (Spewpa, Pyukumuku, Cosmog, Cosmoem) use the type fallback move, like 11 existing species (Abra, Ditto, Metapod…) |
| Togepi, Azurill | No Fairy moves | Retyped to Fairy, but they learn no Fairy damaging move by level-up in their latest game |
| Trading / market (Release F) | Not built | Gifting works for every species. No new trade logic |
| Grayscale `normal/grayscale`, `shiny/grayscale` folders | Not produced for #650+ | No code reads them. Only `grayscale/` is used |
| Female sprite variants (`normal/female/`) | Not produced for #650+ | No code reads them |

## Known issues

1. **Arceus (#493) shiny is identical to its normal sprite.** This was already shipped this way, and PokéAPI `black-white/animated/shiny/493.gif` has the same defect. The catalogue reports it (`KNOWN_LEGACY_SPRITE_ISSUES`) but doesn't block on it. Fix option: replace it with Showdown `gen5ani-shiny/arceus.gif` after checking it. That changes an existing sprite, so it needs approval.
2. **Spectrier and Calyrex-Shadow animations** come from the Smogon tracker (imgur), not a published mirror. Their QC status is unknown. Spectrier ships animated (normal and shiny). Calyrex-Shadow is a form, so nothing ships. Consider re-checking with the animator listed in the tracker (Antiant).
3. **Dashboard region header after a rollback.** If a generation is turned off while a player owns some of its species, the dashboard shows that region with only the owned species, so the header reads e.g. "Kalos 2/2" instead of "2/72". Cosmetic only.
4. **Showdown/PokéAPI canvas sizes.** Some animated sprites keep a 96×96 canvas (the original bot sprites are cropped). They display correctly but look smaller in tight thumbnails. Re-encoding to crop was avoided so files stay byte-identical to the audited sources.
5. **Minior** uses Showdown's Core forme (matches its sprite). PokéAPI's default is Meteor.
6. **Release C is not merged.** This branch depends on PR #51. If #51 changes before merging, rebase this branch and re-run the suite.

## Decisions for the owner

Decided on 2026-11-09:
- Keep the level requirements (113 evolutions).
- Gen 1–5 evolutions unchanged.
- Gen 7 is the first release; Gens 6, 8 and 9 stay off.
- All forms stay off.
- Sprite use is authorised, with credits.
- No balance change without before/after numbers.

Still open:
1. **Merge Release C (PR #51)**, then this PR, and approve the code release (generations off).
2. **Approve the Gen 7 release** (`GEN7-RELEASE-CHECKLIST.md`) after reviewing `GEN7-ENCOUNTER-COMPARISON.md`.
3. **Balance proposals** in `BALANCE.md` §4. None are implemented. Each needs its own before/after numbers.
4. **Fixing the Arceus shiny** (known issue 1).
5. **Gen 9 timing.** It is 79% static today.
6. **`PUBLIC_URL`.** Optionally set it to the Fly URL to make the embed host explicit (see qualification finding 2).

## Release qualification findings (2026-11-09)

1. **PR #51 is still open.** Head `0d4bbea9` is the same commit this branch is built on, GitHub reports it mergeable ("CLEAN"), there are no reviews, and there are **no CI checks** (the repository has no workflows). `master` (`440f9c73`) has not moved, so no reconciliation was needed.
2. **The production secret `RENDER_EXTERNAL_URL` exists; its value can't be read.**
   - The app has no custom domains; only `poke-discord-bot-49shta.fly.dev` serves `/public` (200 `image/gif` to Discord's crawler user-agent).
   - The old Render hosts return 503/404.
   - If the secret holds an `onrender.com` address, today's embeds already point at a dead host, and this release fixes that by falling back to `FLY_APP_NAME`.
   - If it holds the Fly URL, it keeps being used.
3. **`master` is unprotected and merges deploy production.** Run the suite on the merge commit before merging.
4. **Correction:** an earlier balance draft said tier odds don't change when species are added. They do, because weights are per species. The corrected exact figures are in `BALANCE.md` / `GEN7-ENCOUNTER-COMPARISON.md`, verified against the live selector (`tests/gen69Balance.test.js`).
5. **Achievement migration (revision 2 → 3)** was qualified against Release C's real code on 3,000 synthetic players (`tools/qualify-migration.mjs`, `MIGRATION-QUALIFICATION.json`):
   - 0 existing unlocks removed or re-dated, AP always equals the sum of unlocks, and a second boot is a no-op.
   - Rolling back to Release C loses 0 unlocks.
   - Expected new unlocks, measured on the synthetic population (real shares depend on actual collections): Fairy Specialist (about 5%), Type Encyclopedia II (about 5%), and Decorated milestones crossed through that AP (about 0.1%).
6. **Quests pick Pokémon uniformly** (7.4% Legendary today). That's existing behaviour, unaffected by this work, and listed as a proposal.
