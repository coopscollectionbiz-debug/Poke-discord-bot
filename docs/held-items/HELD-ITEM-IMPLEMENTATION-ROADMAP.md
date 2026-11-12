# Held Items: Implementation Roadmap and Final Recommendation

Nothing in this roadmap starts until the owner approves the decisions in §1. Each phase is its own branch and PR. Merging to master deploys to Fly, so every phase ships with its flags **off**.

## 1. Decisions for approval

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| **D-H1** | Equipment granularity | **Per line (`species:variant`), shared by Display + Battle teams.** One physical item on one Pokémon. | Per-team loadouts like movesets (doubles copies and UI) |
| **D-H2** | Item Clause | **On for both teams** (no duplicate item within a team) | Battle team only |
| **D-H3** | Ownership model | **Stack counts + reservations** (`items` unchanged; `heldItems` bindings) | Item instances |
| **D-H4** | Consumables | **Reusable; berries/Sash once per battle, reset after** | Truly consumed |
| **D-H5** | Mega and items | **A slot battling as a Mega ignores its item** (Champions: the stone fills the slot) | The item works on Megas |
| **D-H6** | Launch catalog | **33 items** (§4) | Larger or smaller set |
| **D-H7** | Deferred outliers | **Life Orb, Rocky Helmet, Assault Vest deferred.** Helmet candidate rule: once per battle. | Launch mainline rules |
| **D-H8** | Prices | **Basic 2,500 · Standard 5,000 · Premium 8,000 CC; `maxStack` 2** | — |
| **D-H9** | Free acquisition | **Starter Basic voucher; achievement vouchers; weekly-pack 25% Basic; season-end Premium voucher.** No per-battle drops. | Shop only |
| **D-H10** | Surge Power | **Items excluded from `teamPower`** | Include an item factor |
| **D-H11** | Staged audience | **Add `HELD_ITEMS_TESTERS` allowlist** for owner verification in production | Global flags only (as Mega) |
| **D-H12** | Equip on non-team lines | **Allowed** | Team members only |

## 2. Phases

| Phase | Scope | Depends on | Complexity | Testing gate | Deploy |
|---|---|---|---|---|---|
| **H0** Approval | Decisions D-H1…D-H12 | this audit | — | — | — |
| **H1** Data + service | Catalog entries (status `defined`), `heldGroup`/`restrictTo`/`battle.text`; `services/heldItems.js` (equip/unequip/release/normalize/clause); `consumeItems` reservation guard; `releaseLine` at the 5 `resetLevelIfGone` sites; `normalizeHeldItems` in `validateUserSchema`; `tools/held-items-audit.mjs`; flags in `config/features.js` incl. tester allowlist | H0 | **M** (≈ 600 lines + tests) | Invariant fuzz test (10k random op sequences keep I-1…I-4, never change `items`/`cc`); per-call-site release tests (donate, bulk, evolve carry, shiny carry, `/gift`); rollback fixture test; dry run on production copy = 0 changes; suite green | Merge with all flags off (dark). Verify boot log and fingerprints |
| **H2** Battle engine | `utils/battle/items.js` registry; hooks in `effects.js` (§5.3 of architecture); routing "ability **or** item"; `buildTeam` copies `member.item`; Item Clause fail-closed; Mega ignore; result `members[].item`; playback notes | H1 | **M–L** | **No-item corpus 0 diffs** + no-Mega corpus 0 diffs; one exact-number unit test per item (multipliers, once-per-battle, clamping, no revive, Helmet-vs-Helmet no chain, Choice lock draws nothing, Quick Claw draws only with holder); determinism (same seed twice); **balance gates**: single-holder ≤ 68%, smart-clause mirror ≤ 80%, turn cap ≤ 1%, cross-tier "both itemized" ≥ "no items" for lower tier (port `analysis/held-items/run.mjs` scenarios to a synthetic-only test, no player data) | Dark (`HELD_ITEMS_BATTLES` off) |
| **H3** Dashboard | `GET /api/held-items`, `POST /api/held-items/equip` (rev + requestId); Teams slot badge + Item button + item dialog (desktop + sheet); Battle-team rules strip `Items`; set-pokemon-team clause check; Bag category; Collection read-only; item icons (asset sourcing approved first) | H1 | **M** | Route tests: 403/400/404/409 stale/409 unavailable, replay, concurrent equips of last copy (Promise.all → exactly one succeeds), takeFrom atomicity, flags off → hidden; `dashboardFoundation` style checks (no alert/confirm); manual phone pass at 375 px (touch-only, no hover dependency) | Dark (`HELD_ITEMS_DASHBOARD/EQUIP` off) |
| **H4** Economy | `POST /api/shop/buy-held-item`; shop section; vouchers (3 catalog items) + redeem route; starter voucher grant; achievement rewards (needs reward approval); weekly-pack chance; event-log entries (`held_item_purchase`, `held_item_equip`) | H1, H3 | **S–M** | Purchase replay/insufficient CC/maxStack tests; voucher consume+grant atomic; event log aggregates; economy watch script | Dark (`HELD_ITEMS_SHOP` off) |
| **H5** Discord display | Battle playback item notes; `/showbattlecard` + `/showteam` item icons; `/inventory` "Equipped on" | H2 | **S** | Render tests; visual regression: no-item cards byte-identical to master (`tools/dev/visual-regression.mjs`) | Dark |
| **H6** Launch | Tester allowlist → owner verifies equip, shop, battle notes in prod → global flags on in order: DASHBOARD → EQUIP+SHOP → BATTLES | H1–H5 | **S** | Pre-deploy backup + dry run; post-flag snapshot diff; watch metrics 7 days | Flag flips (Fly secrets) — each a production action needing owner approval |
| **H7** Wave 2 | Scope Lens, Leek/Lucky Punch, Wide/Zoom Lens, Metronome, Big Root, Air Balloon, Oran/pinch berries, resist berries; tuned Rocky Helmet; revisit Life Orb/Assault Vest | H6 + 2–4 weeks telemetry | **M** | Same gates per item | Per-item `status` flip |
| **H8** Mechanics | Status system (Lum + status berries), flinch (King's Rock), stat stages in all battles (White Herb, Weakness Policy) | separate design | **L** | New corpus + balance pass | Separate release |

Critical path: H0 → H1 → (H2 ∥ H3) → H4 → H5 → H6. H2 and H3 touch different files and can run in parallel sessions.

## 3. Acceptance criteria (release-level)

Ownership and persistence
- [ ] Equipping/replacing/removing/moving never changes any `items` count or `cc`.
- [ ] I-1…I-4 hold after any sequence of API calls, restarts and normalizer runs (fuzz).
- [ ] Donating/gifting/evolving/converting the last copy releases or carries the item exactly as specified, and the response tells the player.
- [ ] A purchase retried with the same requestId grants once; `maxStack` 2 enforced.
- [ ] Two simultaneous equips of the last free copy: exactly one 200, one 409 `unavailable`.
- [ ] Stale tab: 409 `stale` with current equipment; UI reconciles.
- [ ] Save failure: change stays in memory, queue retries, response says "saved with a delay" (existing A2 behaviour), replay never applies twice.

Battle
- [ ] No-item battles: 0 diffs on both corpora.
- [ ] Each launch item matches its specified numbers in unit tests.
- [ ] Once-per-battle items trigger at most once and are available again next battle.
- [ ] Items snapshot at battle start; equipment changes during playback don't alter the shown result.
- [ ] Item Clause duplicates and Mega slots fail closed.
- [ ] Balance gates (H2) pass.

Dashboard and UX
- [ ] Every equipment action works with touch only at 375 px; no hover-only info.
- [ ] Sprite visibility unchanged (badge within stage padding); no-item Teams page visually unchanged when flags off.
- [ ] No Discord command can equip or manage items (command contract test: no new commands).

Migration and rollback
- [ ] First boot changes 0 records (fingerprints).
- [ ] Old-release normalizers keep `heldItems` and held ids (rollback test).
- [ ] Flags off fully hides and disables the feature without data loss.

Economy
- [ ] Prices read from the catalog only; event log records every purchase and voucher redemption.
- [ ] Watch report: % active players with ≥ 1 equipped item, days to first equip, CC sunk per week.

## 4. Initial release catalog (exact effects, prices)

| Item | Group | Effect in Coop battles | Activation | Price |
|---|---|---|---|---|
| Leftovers | Recovery | Heals ⌊maxHP/16⌋ (min 1) at end of each turn | Every turn | 8,000 |
| Sitrus Berry | Recovery | Heals ⌊maxHP/4⌋ when a hit leaves it at ≤ 50% HP | Once per battle | 8,000 |
| Choice Band | Offense | Attack ×1.5; locked into its first move until it faints | Always | 8,000 |
| Choice Specs | Offense | Sp. Atk ×1.5; same lock | Always | 8,000 |
| Choice Scarf | Speed | Speed ×1.5; same lock | Always | 8,000 |
| Focus Sash | Defense | At full HP, survives a hit that would KO with 1 HP | Once per battle | 5,000 |
| Eviolite | Defense | Def and Sp. Def ×1.5 if the holder can still evolve | Always | 5,000 |
| Shell Bell | Recovery | Heals ⌊damage dealt/8⌋ (min 1) after its move | Every hit move | 5,000 |
| Black Sludge | Recovery | Poison types heal ⌊maxHP/16⌋; others lose ⌊maxHP/8⌋ each turn | Every turn | 5,000 |
| Light Ball | Species | Pikachu: Attack and Sp. Atk ×2 | Always | 5,000 |
| Thick Club | Species | Cubone/Marowak: Attack ×2 | Always | 5,000 |
| Expert Belt | Offense | Super-effective damage ×1.2 | SE hits | 2,500 |
| Muscle Band | Offense | Physical move power ×1.1 | Always | 2,500 |
| Wise Glasses | Offense | Special move power ×1.1 | Always | 2,500 |
| Quick Claw | Speed | 20% chance to move first within its priority bracket | Each turn | 2,500 |
| 18 type boosters (Charcoal, Mystic Water, Miracle Seed, Magnet, Never-Melt Ice, Black Belt, Poison Barb, Soft Sand, Sharp Beak, Twisted Spoon, Silver Powder, Hard Stone, Spell Tag, Dragon Fang, Black Glasses, Metal Coat, Silk Scarf, Fairy Feather) | Type | Moves of that type ×1.2 power | Always | 2,500 each |

Champions alignment: 27 of the 33 are reported legal in Champions; Sitrus Berry is reported by one source only, and Choice Band, Choice Specs, Eviolite, Black Sludge and Thick Club are not in Champions. Choice Band/Specs and Eviolite are deliberate traditional-game additions: Choice items measured well-behaved here, and Eviolite is the best newcomer equalizer.

## 5. Final recommendation

1. **Architecture.** Keep `user.items` counts as the only ownership record. Add a per-line `heldItems` reservation map guarded by four invariants, enforced on every write and repaired (bindings only) on load. This can't mint items, needs no data migration, and rolls back to the previous release without loss.
2. **Dashboard → Team.** Put an item badge on each slot's sprite stage and an **Item** button beside **Moves**. The button opens an immediate-save item dialog (a full-height sheet on phones) with the current item and its exact effect, Equip / Replace / Move here / Remove, Own · Equipped counts with holder names, compatibility states, search, and group/type filters. Writes are server-authoritative, atomic, replay-safe and stale-safe. No Discord commands.
3. **Battle mechanics.** Add a data-driven item registry with hooks in the effect engine, which I verified is identical to the legacy loop when no effects are present. Route item battles to it, and snapshot items at battle start. Launch needs no new mechanics. Status, flinch and stat-stage items wait for H8.
4. **Launch items.** Leftovers, Sitrus, Focus Sash, Choice Band/Specs/Scarf, Eviolite, Shell Bell, Black Sludge, Expert Belt, Muscle Band, Wise Glasses, Quick Claw, Light Ball, Thick Club and the 18 type boosters. Defer Rocky Helmet (an outlier in auto-battles), Life Orb (a net loss in long battles) and Assault Vest (its drawback does nothing here).
5. **Balance.** Use the Item Clause and Mega-ignores-item, keep items out of surge Power, and change no tier bonus, stat or formula. Simulations show that a full loadout is worth about 1 Level, items slightly *compress* species-tier gaps, rank and wealth gain nothing extra, and nothing stalls.
6. **Economy.** Use a one-time, finite sink: 2,500 / 5,000 / 8,000 CC with `maxStack` 2, no resale and no trading. Add free vouchers (first Battle team, ranked achievements, weekly pack, season end), so a new player can itemize in 2–3 weeks without donating.
7. **Sequence.** H1 data and service (dark) → H2 engine and H3 dashboard in parallel (dark) → H4 economy → H5 Discord display → H6 staged flag flips: testers, then dashboard, then equip and shop, then battles, each approved by the owner. A backup and a dry run come before every deploy. The first response to any problem is to turn the flags off.

## 6. Could not be verified

- **Pokémon Champions item data.** I found no official Champions item list. Item names and prices come from fan sites (champdex.com, as of 2026-11-08; VGC; games.gg; gamingpromax), and they conflict on Sitrus/Lum, Rocky Helmet, Life Orb timing and prices (catalog CSV, `source_confidence`). One source (Deltia's) couldn't be fetched. Mainline mechanics (Showdown rules) were used for effects, with every adaptation noted.
- **Player activity and economy rates** are lower bounds, and the flows come from a 23-hour log.
- **Battle-team behaviour** is modelled with each player's best legal Lv 50 team. No player had set a Battle team at the snapshot time.
- **Mega and ability interactions with items** weren't simulated, because Megas are off in production.
- **Item icon licensing** needs the owner's decision.
