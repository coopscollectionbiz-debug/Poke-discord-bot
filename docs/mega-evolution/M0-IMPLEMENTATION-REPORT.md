# Mega Evolution: Phase M0 implementation report

| | |
|---|---|
| Branch | `feature/mega-evolution-m0` (local only; not pushed, no PR) |
| Worktree | `E:\Poke-discord-bot-mega-m0` |
| Based on | `f56631c3` (audit docs) = production master `5157cfe6` + `docs/mega-evolution/`. Master had not advanced (checked 2026-11-10), so no reconciliation was needed. |
| Production | Untouched: no deploy, no Fly.io change, no player data, no generation change. `MEGA_EVOLUTION_ENABLED` is unset everywhere. |

Phase M0 delivers the data foundation only. **No Mega can be unlocked, selected, battled with, caught, bought or granted.** Every gameplay entry point is either absent (M1/M2) or refuses while the flag is off. Even with the flag on, no form is launch-ready (D-5).

## 1. Files

### Created
| File | Purpose |
|---|---|
| `tools/generate-megas.mjs` | Builds the catalogue from `@pkmn/dex` 0.10.12. Cross-checks every stat and type against PokéAPI `e2710d30` and fails the build on any disagreement or count change |
| `tools/lib/megaRules.mjs` | Hand-kept rules the data can't express: blocked forms (D-8, D-9, D-16), variant groups (D-6, D-7), ability slot rule (D-11), the 69-ability classification and engine requirements |
| `tools/import-mega-sprites.mjs` | Imports audited sprites (SHA-1 checked), writes GIFs and the SHA-256 manifest. `--offline` rebuilds the manifest identically |
| `tools/lib/spriteCodec.mjs` | GIF/PNG helpers moved unchanged out of `tools/import-sprites.mjs` (shared by both importers) |
| `tools/lib/megaValidation.mjs`, `tools/validate-megas.mjs` | Release gate `npm run validate:megas` (also used by the tests) |
| `data/pokedex/megas.json` | **Catalogue:** 97 form records + 92 stones |
| `data/pokedex/mega-abilities.json` | **Ability implementation manifest** (69 abilities) |
| `data/sprites/mega-source-manifest.json` | Audited source per form (URL, SHA-1, kind) |
| `data/sprites/megas.json` | **Sprite manifest:** normal/shiny/grayscale per form, with file SHA-256 + SHA-1, source URL + SHA-1 + SHA-256, credit |
| `public/sprites/pokemon/mega/{normal,shiny,grayscale}/<id>.gif` | 285 sprite files (95 forms × 3), 7.8 MB |
| `utils/megas.js` | Read-only API: lookups, stone→form map, `megaAvailability()` (with every blocking reason), `megaSpritePath()` (placeholder, never the base sprite) |
| `services/megaUnlocks.js` | Additive line-bound unlock schema: read, normalize/quarantine, rule check, flag-gated record, preferred form, variant locks |
| `config/features.js` | `MEGA_EVOLUTION_ENABLED` (default off) and the `MEGA_FORMS` allowlist |
| `config/megaRewards.js` | Declarative economy (D-12 to D-15), `active: false`, read by nothing |
| `docs/mega-evolution/MEGA-ABILITY-MANIFEST.md` | Human-readable ability manifest and engine work list |
| `tests/megaCatalog.test.js`, `megaSprites.test.js`, `megaPersistence.test.js`, `megaSafety.test.js` | 186 new assertions |

### Modified
| File | Change |
|---|---|
| `catalog/items.js` | +95 `defined` items: 92 stones (`megastone_<showdown id>`), `mega_shard`, `mega_stone_voucher`, `mega_stone_voucher_legendary`. None has a shop entry, none is tradable, and `grantItem` refuses all of them |
| `tools/import-sprites.mjs` | Imports its codec from `tools/lib/spriteCodec.mjs`. Output verified identical to the original tool (offline rebuild compared byte-for-byte) |
| `run-tests.js` | Strips `MEGA_EVOLUTION_ENABLED` and `MEGA_FORMS` from test processes (like `POKEMON_GENERATIONS`) |
| `package.json` | `generate:megas`, `import:mega-sprites`, `validate:megas` scripts |
| `docs/mega-evolution/MEGA-ARCHITECTURE-AUDIT.md`, `MEGA-INVENTORY-AND-PERSISTENCE.md`, `MEGA-TEST-AND-ROLLBACK-PLAN.md` | Corrected gift statement (§5, deviation 6) |

Not modified: `pokemonData.json`, `battleData.json`, `data/sprites/sprites.json`, `data/pokedex/forms.json`, every species sprite, every command, route, service, dashboard page and achievement. The tests pin the first three files to production's content hashes.

## 2. Catalogue totals (reconciled; the build fails on any change)

| Measure | Count |
|---|---:|
| Catalogue records | 97 |
| Official Mega forms (Meowstic M/F, Tatsugiri ×3 and Magearna/Original counted once) | 93 |
| Base species | 87 |
| Mega Stones | 92 (82 regular, 10 Legendary/Mythical, milestone/event only) |
| Eligible records | 93 (= 90 official forms) |
| Blocked records | 4: Mega Rayquaza (D-9), Mega Floette (D-16), Mega Zygarde (D-16 + no sprite), Mega Magearna Original (D-8) |
| Launch-ready | 0 (D-5) |
| By introduction | X/Y 30 · ORAS 18 · Legends: Z-A 26 · Mega Dimension 23 records (19 forms) |

**Reconciliation with the audit's "88 eligible":** the audit counted 88 eligible rows plus 6 "needs decision" rows (Meowstic ×2, Tatsugiri ×3, Magearna Original). D-6 and D-7 resolve 5 of those into eligible, and D-8 blocks Magearna Original: 88 + 5 = **93 eligible records**. Blocked records went from 3 to 4. In official-form terms that's 93 − Rayquaza − Floette − Zygarde = **90 eligible forms**.

Every record carries: stable id, base dex id, display name, stone or special prerequisite, official base stats and types (cross-checked), ability (and all slots), sprite references, source metadata, eligibility status, block reasons, launch blockers, introduction group, official status and variant data. It also links to its existing `forms.json` key: all 97 link, and the 6 the audit called "missing" exist there under kind `battle-only`.

## 3. Sprites

| | Count |
|---|---:|
| Forms with sprites | 95 (all except Mega Zygarde and Mega Magearna Original) |
| Animated normal / animated shiny (BW-style 2D) | 24 / 24 |
| Static pixel-art fallback (normal and shiny) | 71 |
| Re-encoded to drop GIF disposal 3 (same rule as species) | 12 animations |
| 3D sources used | 0 |
| Base-form substitutions | 0 (a missing sprite resolves to the Poké Ball placeholder) |

- **Checks per file:** SHA-1 of the source equals the audit probe; stored GIF89a SHA-256 and SHA-1 are recorded; the file decodes; 32–160 px; transparent pixels present; ≤ 64 colours; grayscale is truly gray; under 1 MB; shiny differs from normal in bytes and first-frame pixels.
- **Delivery:** under the existing `/public` static route (`/public/sprites/pokemon/mega/...`). They ship only with a future deploy. `data/sprites/sprites.json` (the live species manifest) is unchanged.
- **Missing assets:** Mega Zygarde (no acceptable 2D sprite anywhere audited) and Mega Magearna Original (not imported, per D-8).
- **Attribution gap:** Mega Meowstic M/F. The imported PokéAPI pixel sprite has no artist in the audited Smogon trackers (the Gen 6–9 audit only found official artwork for it). The manifest credits the source project and sets `creditVerified: false` rather than inventing an artist. The M and F files are byte-identical upstream (already noted in the audit).

## 4. Special cases

| Form | M0 handling |
|---|---|
| Mega Rayquaza | `prerequisite: { kind: "move", move: "dragonascent" }`, no stone, `blocked`. **Audit of Dragon Ascent:** the move exists in `battleData.json` (Flying, physical, 120 power), but **no species learns it by level-up in the bot**, and Rayquaza keeps its Gen 5 level-up list (Twister … Dragon Pulse). `autoMoveset(384, level)` never contains it at any Level, so the prerequisite can't be met today. Options for a later phase: (a) Rayquaza always knows Dragon Ascent (a fixed signature slot), (b) a move-tutor item, (c) add it to Rayquaza's level-up list at Lv 1 (modern games), which changes nothing for current movesets because Lv 1 moves are the oldest and are pushed out. All need approval and battle tests. |
| Mega Floette | Blocked: needs Floette-Eternal, which the bot doesn't have (D-16) |
| Mega Zygarde | Blocked: needs Complete Forme (base HP 216 vs 108) and has no sprite (D-16) |
| Mega Meowstic | Two records (`mega-meowstic-m`, `-f`), one stone. The unlock stores `choice: { gender }`, and the first choice is permanent per line (D-6) |
| Mega Tatsugiri | Three records (curly/droopy/stretchy), one stone. The unlock stores `choice: { appearance }`, permanent per line (D-7) |
| Magearna | Standard Mega eligible. Original Color record kept for completeness but blocked, with no sprite imported (D-8) |
| Mega Heatran / Tatsugiri ability | Slot 0 (Flash Fire / Commander) per D-11. **Not verifiable:** Legends: Z-A has no abilities in play, and Serebii's Mega Dimension and Pokédex pages list none for these Megas. Recorded as `abilityVerification: unverified …; slot 0 chosen per D-11`. Every Z-A Mega ability is likewise flagged unverified (Showdown "Future" data). |

## 5. Persistence schema (additive)

```jsonc
user.megaUnlocks = {
  "6:normal":  { "forms": { "mega-charizard-x": { "at": 1794272276757, "stone": "megastone_charizarditex", "req": "req-aaaa-0001" } }, "preferred": null },
  "678:shiny": { "forms": { "mega-meowstic-f": { "at": 1794272276757, "stone": "megastone_meowsticite", "choice": { "gender": "f" } } }, "preferred": null }
}
```

- Keyed by line `species:normal|shiny` (D-1). Normal and shiny lines are independent, and a line can hold several forms. `preferred` holds the selected Mega form.
- **Absent on every existing player.** Readers default to "nothing unlocked". `normalizeMegaUnlocks` never creates the field. Malformed entries go to `user.megaLegacy`, never silently dropped. Prototype keys are removed.
- Gameplay never deletes unlocks: emptying a line (donate, evolve, shiny craft, or gifting the last normal while a shiny remains) only makes them dormant.
- Writes (`recordMegaUnlock`, `setPreferredMega`) refuse while the flag is off. They don't consume stones: M1 wraps them in `runInventoryTransaction` with `consumeItems`.
- **Not wired** into load, save, commands or routes. `tests/megaSafety.test.js` scans the 119 live files to prove it.
- **v21 compatibility (tested):** with `megaUnlocks`, stones, shards and a `mega` team slot present, `validateUserSchema`, `normalizeInventory`, `normalizeProgression`, `listInventory`, `normalizeTeam` and `buildTeam` don't throw. Unlocks stay byte-identical, items are kept (shown "not usable yet"), and the team slot battles as the base form. A real local snapshot round trip preserves everything. No individual Pokémon ids were introduced.

## 6. Deviations from the design documents

1. **Stones use the existing `evolution` category**, not a new `mega` one. A new category would appear immediately in the `/inventory` and bag category menus, a visible change while disabled. Revisit at activation.
2. **The catalogue lives in `data/pokedex/megas.json`; `forms.json` is unchanged.** All 97 records already link to existing form keys, so regenerating `forms.json` (and its 361-record tests) wasn't needed.
3. **Sprite folder is `public/sprites/pokemon/mega/`** (the plan said `forms/`), so Megas stay separate from any future regional/other form import.
4. **`normalizeMegaUnlocks` is not called from `validateUserSchema` yet.** M0 must not touch the live load path. M1 wires it in, together with the unlock transaction.
5. **`preferred` form field added** (M0 brief §6). It coexists with the owner's team-slot design: the team slot remains the battle selection, and `preferred` is the default Mega shown for a line.
6. **Gift policy wording corrected:** `/gift` refuses only the species' last copy across normal + shiny, so a normal line can be emptied by gifting while a shiny remains. Behaviour is still safe (the unlock stays with the sender, dormant). The docs said "never the last copy".
7. **Eligible count is 93 records / 90 forms, not 88** (see §2). Nothing was forced to match.

## 7. Tests

| Suite | Result |
|---|---|
| `tests/megaCatalog.test.js` | 65/65 |
| `tests/megaSprites.test.js` | 23/23 |
| `tests/megaPersistence.test.js` | 66/66 |
| `tests/megaSafety.test.js` | 32/32 |
| **Full suite `npm run test:safe`** | **48 of 49 files pass**; 1,492 of 1,493 counted assertions |
| `npm run validate:catalog` (existing gate) | ✅ generations 1–9 valid |
| `npm run validate:megas` (new gate) | ✅ |
| Generator / importer determinism | Re-running both produces byte-identical output |

**The one failure is pre-existing and not caused by M0:** `tests/achievements.test.js`, assertion "exactly 500 CC granted, claim recorded today". The test pins `NOW` to 2026-11-09, but the claim handler stamps the real date. It started failing on 2026-11-10 and **fails identically on production master `5157cfe6`** (verified in `E:\Poke-discord-bot-clean`). It was left unchanged, per the instruction not to weaken existing tests. It needs a separate fix (pass `now` through the claim handler, or compare against `dayNumber(Date.now())`).

## 8. Remaining work for Phase M1

1. `services/mega.js`: `unlockMega` through `runInventoryTransaction` (consume 1 stone + `recordMegaUnlock` in one synchronous mutation; `requestId` replay; concurrency tests from `MEGA-TEST-AND-ROLLBACK-PLAN.md`).
2. Call `normalizeMegaUnlocks` from `validateUserSchema`.
3. `GET /api/mega`, `POST /api/mega/unlock`, `/mega list|info|unlock`, and the variant picker for Meowstic/Tatsugiri. Keep `/api/updateUser` closed to Mega fields.
4. Inventory usage text for stones; decide the `mega` category (deviation 1).
5. `/credits`: add Mega sprite artists, and resolve the Mega Meowstic attribution gap.
6. Before any gameplay launch (M2, D-5): move flags in `battleData.json`; `utils/battle/abilities.js` with the 34 current-engine abilities; and the new systems for the other 20 (stat stages, switch-in and end-of-turn phases, weather, terrain, burn). See `MEGA-ABILITY-MANIFEST.md`.
7. Decisions still open: Mega Rayquaza's Dragon Ascent route (§4); reward values (D-17); the `mega` inventory category.
