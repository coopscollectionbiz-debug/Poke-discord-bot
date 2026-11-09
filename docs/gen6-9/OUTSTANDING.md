# Outstanding work, known issues and open decisions

## Not implemented (by design or scope)

| Item | State | Notes |
|---|---|---|
| Alternate forms in gameplay (regional variants, Megas, Primal, Gigantamax, Terastal, gender appearances, totems, cosmetic) | **Architecture only** | `data/pokedex/forms.json` holds 361 forms with keys, types, stats, kinds and Showdown sprite ids. `utils/forms.js` handles identity. Achievement metrics count forms toward their base species. Every form is disabled. Not built: form sprites in `public/`, catching or granting forms, form display in the dashboard and embeds, form battles, Mega/Gigantamax/Primal/Terastal mechanics (deliberately not simulated). Sprite coverage per form is in the audit (`pokemon-sprite-inventory.csv`) |
| Form-dependent evolutions (10) | Gated | They need regional forms enabled first |
| Abilities, held items, status conditions | Not modelled | Same as before. The sim has no abilities (except Shedinja's Wonder Guard) |
| Moves whose effect the sim can't model | Excluded | Gen 6+ examples: First Impression, Belch, Steel Roller, Upper Hand, Poltergeist, Mind Blown, Steel Beam, Chloroblast, signature form-dependent moves (Aura Wheel, Ivy Cudgel, Raging Bull, Tera Starstorm, Revelation Dance, Multi-Attack). Variable-power moves such as Last Respects and Rage Fist use their listed base power |
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

1. **Approve releasing Generation 7 first** (`POKEMON_GENERATIONS=7`) after the code release. See `RELEASE-CHECKLIST.md`.
2. **Level requirements on Gen 6–9 evolutions** (`ENFORCE_LEVEL_EVOLUTIONS`). This is implemented because the bot has Levels. Turn it off for pure Stone evolutions, matching Gen 1–5.
3. **Balance proposals** in `BALANCE.md` §3 (none implemented).
4. **Fixing the Arceus shiny** (known issue 1).
5. **Gen 9 timing.** It is 79% static today.
6. **`RENDER_EXTERNAL_URL` in production.** If it is set to an `onrender.com` host it is now ignored. Confirm `PUBLIC_URL` or `FLY_APP_NAME` before the code release.
