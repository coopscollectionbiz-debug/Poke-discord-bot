# Teams, Collection & Battle-mode dashboard redesign: mockup options

Design phase only. Nothing here changes the bot, battles, team validation, API routes, player data, Fly settings or feature flags. Every mockup uses synthetic data (`mockups/teams-collection/mock-data.js`, generated from `public/pokemonData.json` and the real stat/move functions) and only the existing tokens and components (`public/shared/tokens.css`, `components.css`). It also uses the existing sprites (`public/sprites/pokemon/{normal,shiny}`, and `…/mega` for Mega forms).

Base: master `b5a81f43` (PR #59, Mega M0–M3, Fly v28). Supersedes roadmap item E1 and reshapes E2/E3; see the updated `DASHBOARD-UX-ROADMAP.md` §11.

## How to view

- **Sources:** `docs/design/mockups/teams-collection/*.html`. They open straight from disk. Add `?state=add` or `?state=empty` (Teams) and `?state=detail` (Collection A) to see the other states.
- **Renders:** run `node docs/design/mockups/teams-collection/render.mjs` (headless Edge; desktop 1280 px, phone exactly 390 px through `frame.html`).
- **Discord cards:** `node docs/design/mockups/teams-collection/ranked-card.mjs`.
- **Checked:** all 14 page states at 360 px and 1280 px. None scrolls sideways, every button, link and field is at least 44 × 44 px, and every control has a label.

Every page shows the moved-over-team notice, unsaved changes, the mythic-limit error, a shiny Pokémon (Pikachu), a Mega on both teams (Mega Charizard X), mythic-tier Pokémon (Mewtwo, Lugia, Rayquaza, Mew), and empty states.

## Mockups

### Teams: 3 options

| | Desktop 1280 | Phone 390 | Add flow | Empty state |
|---|---|---|---|---|
| **A. Stacked**: both teams stacked, box below | [teams-a-desktop](previews/redesign-teams-a-desktop.png) | [teams-a-phone](previews/redesign-teams-a-phone.png) | [teams-a-add-desktop](previews/redesign-teams-a-add-desktop.png) (pick → "which team?" menu; Battle option locked) | [teams-a-empty-phone](previews/redesign-teams-a-empty-phone.png) (new player) |
| **B. Switcher**: one team at a time, box pinned beside it | [teams-b-desktop](previews/redesign-teams-b-desktop.png) | [teams-b-phone](previews/redesign-teams-b-phone.png) | [teams-b-add-phone](previews/redesign-teams-b-add-phone.png) (box sheet; mythic tiles locked) | [teams-b-empty-phone](previews/redesign-teams-b-empty-phone.png) (no Battle team yet → "Copy my Display team") |
| **C. PC box**: box left, both teams as a party column; pick up and place | [teams-c-desktop](previews/redesign-teams-c-desktop.png) | [teams-c-phone](previews/redesign-teams-c-phone.png) (both teams as sticky 3×2 grids; slot toolbar) | [teams-c-add-desktop](previews/redesign-teams-c-add-desktop.png) (holding Garchomp; every slot is a drop target) | [teams-c-empty-phone](previews/redesign-teams-c-empty-phone.png) |

**Shared by all three options:**

- **Slot 1 is the lead.** Reorder uses buttons on every device (▲▼ or ◀▶, each with an `aria-label` naming the Pokémon) and drag on desktop. Remove is ✕ with no confirm dialog, because nothing is saved until **Save teams**.
- **Battle team rule strip:** "Battles at Lv 50", "Mythic 1/1", "Mega 1/1", "Slots n/6". Each Battle slot shows **Lv 50** large with "yours Lv 58" small.
- **Mythic error:** shown as an inline `role="alert"` panel that names the blocking Pokémon and the two ways out. In the box, mythic-tier tiles are marked locked ("Mythic limit") wherever the target team is known.
- **Changed slots** are dashed, with a MOVED or NEW tag. One sticky save bar with **Discard** and **Save teams** summarises every change across both teams.
- **Box tiles** carry D1/B3 badges showing which team slot each copy is in.

### Collection / Pokédex: 2 options

| | Desktop 1280 | Phone 390 | Detail |
|---|---|---|---|
| **A. Dex grid**: dense tiles, dex numbers, unowned silhouettes, region chips with counts | [collection-a-desktop](previews/redesign-collection-a-desktop.png) | [collection-a-phone](previews/redesign-collection-a-phone.png) | Drawer on desktop (open in the desktop render). Sheet on phone: [collection-a-sheet-phone](previews/redesign-collection-a-sheet-phone.png). |
| **B. List / table**: region sections with completion bars, sortable columns, checkboxes for bulk donate (shown in Donate mode) | [collection-b-desktop](previews/redesign-collection-b-desktop.png) | [collection-b-phone](previews/redesign-collection-b-phone.png) | Inline row expansion (Charizard) |

Both options keep Browse / Evolve / Donate / Convert as one mode control. Mega forms appear **only** as forms of their Pokémon: the drawer's Forms row, or a "+2 Mega" chip in the list. They are never dex entries and never counted (274/649 excludes them).

### Discord `/showbattlecard`: 2 options

Both are drawn with the existing `utils/render` primitives: `drawCard`, `drawPlatform`, `drawSlotBadge`, `drawLevel`, `drawTypeChips`, `drawMegaTag`, `drawShinyMark`, `drawTag`, and `loadStaticSprite`/`loadTrainerSprite`.

| Option | Preview | Notes |
|---|---|---|
| **1. Trainer-card layout**: rating column on the left, 3×2 team | [ranked-card-1](previews/redesign-ranked-card-1.png) | Same skeleton as `/trainercard`, so the two read as a pair. 1200×680. |
| **2. Banner + team row**: identity and rating banner, six cards in a row | [ranked-card-2](previews/redesign-ranked-card-2.png) | Shorter (1200×560), so the rating is larger at Discord's phone scale, and the team row matches `/showteam`. |

### Optional pages

| Page | Desktop | Phone |
|---|---|---|
| Overview (home) | [overview-desktop](previews/redesign-overview-desktop.png) | [overview-phone](previews/redesign-overview-phone.png) |
| Achievements: Ranked / Casual split (Collection tab unchanged) | [achievements-desktop](previews/redesign-achievements-desktop.png) | [achievements-phone](previews/redesign-achievements-phone.png) |

**Navigation:**
- **Sidebar:** Overview · Teams · Collection · Trainers · Bag · Achievements · Shop.
- **Phone tab bar:** Home · Teams · Pokédex · Bag · More.

## Comparison

### Teams

| | A. Stacked | B. Switcher + pinned box | C. PC box (pick & place) |
|---|---|---|---|
| **Both teams visible together** | Yes, full cards | Partly: the inactive team shows only as a mini strip in its tab | Yes. Desktop: party column. Phone: sticky 3×2 grids. |
| **Add flow** | Tap a box Pokémon → menu "Display / Battle", with rule-blocked choices locked. Two taps, and the menu explains blocks. | Tap a box Pokémon → it joins the team on screen. One tap. Locked tiles show why before tapping. | Tap a box Pokémon → tap a slot in either team. Two taps, and you choose the exact slot (replace or fill). |
| **Reorder** | ◀▶ (desktop) / ▲▼ (phone) on every card; drag a card on desktop | ▲▼ on every card; drag | ▲▼ on rows (desktop) / ◀▶ in the slot toolbar (phone); drag |
| **Rule feedback** | Rule strip and inline error under the Battle team | Strongest: box tiles locked in context, plus strip and error | Strip and error; the error is in the sticky phone header |
| **Phone usability** | Weakest. About 2,300 px tall: the box is far below both teams, and three buttons per row crowd the name. | Good. Compact, and one thing at a time. Comparing teams needs a tab switch. | Good. Both teams stay pinned at the top, the box is one scroll, and slot names appear on selection. The sticky header takes about 330 px. |
| **Accessibility** | Simple: lists of buttons | Simple: tabs (`role="tablist"`) and a dialog sheet | Needs care. Pick and place must be fully keyboard-driven (Enter to pick, arrows to move between slots, Enter to place, Esc to cancel), with `aria-live` "Holding Garchomp" and a non-drag fallback. Each slot's **Add** button also opens the box, as in B. |
| **Mega / mythic / shiny** | Full card tags | Full card tags | Rows: full tags. Phone grids: colour cues (gold, Mega underline, blue lead), with the full detail in the toolbar and labels |
| **Build effort** | **S–M**: closest to today's grid | **M**: tabs, sheet, per-team box filtering | **M–L**: held state, drop targets, sticky header |

### Collection

| | A. Dex grid + drawer | B. List / table |
|---|---|---|
| **Strengths** | Feels like a Pokédex: gaps (silhouettes) are visible at a glance. The drawer keeps context. The sprite-forward look matches the Discord cards. | Most information per row (Level, Power, Teams); best for **bulk donate** and sorting; reads well on phone |
| **Weaknesses** | Fewer numbers on screen; tiles at 4 per row on phone are small, but still 44 px+ | Less "collection" delight; inline expansion pushes rows down |
| **Phone** | 4-column grid and a bottom sheet | Rows with checkbox, sprite, name and #, count, expand |
| **Accessibility** | Tiles are labelled buttons; the drawer and sheet are dialogs with focus return | Native checkboxes; `aria-expanded` rows |
| **Build effort** | **M**: grid, drawer and sheet; the B2 endpoint for stats and moves | **M**: list, expansion and bulk bar (bulk donate already exists) |

### Discord card

| | 1. Trainer-card layout | 2. Banner + team row |
|---|---|---|
| **Strengths** | Pairs with `/trainercard`; the trainer sprite is large | Rating and position dominate; the team row matches `/showteam`; shorter image |
| **Weaknesses** | Taller; the rating is in a narrow column | Smaller trainer sprite |
| **Effort** | S (a variant of `trainerCard.js`) | S (new layout, same primitives) |

## Owner choice (2026-11-10)

- **Teams: B** (team switcher, box pinned beside it on desktop, box sheet on phone).
- **Collection: A** (dex grid + detail drawer/sheet).
- Still open: the Discord card option, Overview / Achievements scope, backend approvals (B2, B6–B11) and the open questions below.

## Recommendation (before the choice)

- **Teams: C (PC box)**, keeping B's "Add" sheet as the second way in.
  - It is the only option that keeps both teams visible on desktop **and** phone.
  - Choosing the exact slot removes A's "which team?" question.
  - It matches the storage-box idea the brief asks for.
  - The extra build effort goes into one well-tested interaction (held state plus keyboard).
  - From B, keep the locked tiles: once a Pokémon is held, Battle slots that would break a rule show the reason before you tap.
  - **If you want the lowest risk instead, A** is the safe choice. It needs the least new behaviour, but it is the weakest on phone.
- **Collection: A (grid + drawer)** as the page, with **B's list as a "List" view toggle**, the default in Donate mode for bulk work. The detail drawer (B2) is shared by both.
- **Discord: card 2 (banner + team row).** It is more legible at Discord's phone scale, and the rating and position are what a ranked card is for.
- **Overview and the Achievements split:** build them as mocked. Each uses one layout only.

## Backend needs (for approval; not built)

| # | Change | Notes |
|---|---|---|
| **B6** | Store the second team as `battleTeam` (same shape as `displayedPokemon`: `[{id, variant, mega?}]`). Keep `displayedPokemon` as the Display team. | `displayedPokemon` keeps today's meaning, so a rollback to v28 keeps working; v28 ignores `battleTeam`. |
| **B7** | Move existing teams over once: copy `displayedPokemon` into `battleTeam`, keep the first mythic-tier slot and drop later ones, and record `battleTeamMigration: { droppedIds, at }` so the dashboard can show the notice once. | Idempotent: only when `battleTeam` is missing. Dry run on a production-shaped copy first. Needs data-change approval. |
| **B8** | `POST /api/set-pokemon-team` gains `teamType: "display" \| "battle"` (default `display`, so old clients still work). For `battle`, the server also checks **at most one `tier: "mythic"`** next to today's checks (1–6 unique owned slots, Mega rules from `services/megaTeam.js`). | One write path, under the user lock. Errors return a message the page shows as-is (e.g. the mythic text in the mockups). |
| **B9** | Optional: a single "save both" request (`{display, battle}`), so one Save keeps both teams consistent. | Or two calls in sequence: the first succeeds, the second fails, and the page shows which one. Decide during implementation. |
| **B10** | `GET /api/user-pokemon` adds read-only `battleTeam`, `battleTeamMigration`, `ranked: { rating, wins, losses, position, players, streak }` and `casual: { wins, losses, bestStreak }`. | Position uses the same ranking as `/leaderboard` (`rankBattleRatings`). Requires the new record fields (B11). |
| **B11** | Split battle records: `user.battle` (today's single record) becomes ranked; add `user.casual`. Reset ranked ratings at launch (per the decision). Streak counters are needed for streak achievements. | Game-logic change outside the dashboard; listed so the dashboard fields have a source. |
| **B2** (unchanged) | `GET /api/pokemon/detail?id&species&variant` returning `slotView()` (stats, moves, Mega form), read-only and session-checked. | Unchanged from the old roadmap; used by the Collection drawer and row. |
| — | Discord: `/showbattlecard` renders the battle team at Lv 50 from a `battleCardView` built like `buildTeamView`, with `level: 50` and `realLevel`. Existing displays keep reading `displayedPokemon`. | Rendering only; the battle team must come from B6. |

## Open questions for you

1. **Same Pokémon on both teams?** The mockups allow it: the same normal Charizard is Display slot 1 and Battle slot 1. If not, the box needs a third tile state ("on your Display team").
2. **One Mega per team, or per player?** The mockups assume one per team, so Mega Charizard X is on both. Does a Mega on the Display team block the same base Pokémon's Mega on the Battle team? Does the Mega unlock apply to both teams?
3. **Battle team empty state:** offer "Copy my Display team" (applying the mythic rule and saying who was left out), or require a manual pick?
4. **Ranked and wagers with no Battle team:** block with a link to the dashboard, or fall back to the Display team at Lv 50?
5. **Evolving or donating a Battle team member:** today the server blocks donating a team member and evolving a team variant. Should both rules apply to Battle team members too? (The mockups assume yes.)
6. **Existing battle achievements** (wins, rating, streaks, from Release C): ranked, casual, or both? Do they reset with the ratings?
7. **Rating display:** a plain number (as mocked), or named divisions (e.g. Bronze/Silver)? Divisions would need tier art and thresholds.
8. **Leaderboard:** `/leaderboard` ranks the ranked rating only. Is casual win count ever shown?
9. **Unowned Pokédex entries:** show their names (as mocked), or "???" until caught?
10. **Underdog surge text:** say anything on the Battle team page ("no surge in ranked"), or keep that in battle rules only?
11. Still undecided, not designed around: extra protection for defenders losing rating without consent.
