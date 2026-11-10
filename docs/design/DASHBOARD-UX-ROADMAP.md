# Dashboard UX Roadmap, Architecture & Implementation Plan

Milestone A, parts 5–8. Read with VISUAL-UX-AUDIT.md (current state) and DESIGN-SYSTEM.md (tokens).

Mockups use synthetic data and are not served by the bot:

| File | What it shows |
|---|---|
| `mockups/team.html` | Source |
| `mockups/team-desktop.png` | 1280 px |
| `mockups/team-mobile.png` | Exact 390 px viewport, rendered through `mockups/phone-frame.html` |

---

## 1. Information architecture

**Today:** five emoji tab buttons (Manage Pokémon · Manage Trainers · Shop · Bag · Achievements). The login lands on Manage Pokémon. There is no home page.

**Proposed navigation** (every destination uses only existing APIs unless marked):

| Section | Content | Backend |
|---|---|---|
| **Overview** (new landing) | Team strip, Pokédex completion by region, rank progress, achievement progress + claimable count, CC/TP, shortcuts | `/api/user-pokemon`, `/api/achievements`, `/api/pokedex-status`. **Battle record needs** a field on an existing GET (see §6). |
| **My Team** | Six slots, reorder, add/remove, details (mockup) | `POST /api/set-pokemon-team` (existing; order = array order) |
| **My Pokémon** | Collection (owned first), filters, evolve/donate/convert modes | Existing endpoints |
| **Trainers** | Trainer collection and picker | Existing `picker` page |
| **Bag** | Inventory | `/api/inventory` |
| **Achievements** | Existing page, restyled | `/api/achievements`, claim |
| **Shop** | Existing | Existing |

A Pokédex view of unowned species stays a **filter** in My Pokémon (owned / unowned), as it works today, rather than a separate section.

**Layout:**

- **Desktop (≥ 821 px):** left sidebar with labeled icons, a wallet card (TP/CC), and `aria-current="page"`.
- **Phone:** bottom tab bar (Home · Team · Pokémon · Bag · More) with 48 px targets and safe-area padding. **More** opens Trainers, Achievements and Shop.
- Navigation becomes real `<a href>` links carrying `?id=`, replacing buttons that set `location.href`. This gives middle-click, back/forward and screen-reader semantics.

## 2. Overview (home)

Priority is information that brings players back. Each item is tied to a real field:

1. **Your Team** strip: six sprites + Levels, linking to My Team.
2. **Rewards waiting:** claimable achievements count (`/api/achievements`), weekly pack availability (the dashboard already computes the weekly reset countdown client-side with `public/weeklyReset.js`; whether this week's pack is already claimed must be confirmed from `/api/user` before building), with one button each.
3. **Pokédex completion** per live region (`liveGenerations` + owned species), as progress bars. This uses the CONTEXT.md definition: owned now.
4. **Rank progress:** TP to the next rank (`getRankProgress` logic; computed client-side from `tp` and the rank table, or exposed by the API).
5. **Battle record:** rating, W–L. **Needs** `battle` added to `/api/user-pokemon` (read-only).

Decorative metrics such as "total clicks" or "days active" are left out because the backend doesn't record them.

## 3. My Pokémon (collection)

| Capability | Today | Proposed | Backend change? |
|---|---|---|---|
| Search by name | Yes | Keep. Match against display names (`names.js`) and stored names. | No |
| Type / rarity filter | Yes (selects) | Type chips (multi-select), tier pips | No |
| Owned / unowned | Toggles | Segmented control | No |
| Shiny filter | No | "Shiny only" toggle | No (data is already in `pokemon`) |
| Generation / region filter | No | Region chips (live regions only) | No (`pokemonData` has region/generation) |
| Sort | No | Dex #, name, Level, tier, recently caught | Dex/name/Level/tier: no. **"Recently caught": not supported** (no catch timestamps). |
| Team membership badge | Partly | Slot number badge on cards | No |
| Large collections | Renders all ≤1,025 cards with animated GIFs | Render 60 at a time with "Show more" via `IntersectionObserver`. Static first frame until hover/visible on phones. | No |
| Quick inspect | None | Side drawer (desktop) / sheet (phone): see §5 | Stats/moves: see §5 |
| Grid / list toggle | No | List view (dense, for bulk donate) | No |

Everything filters client-side, because the full collection is already downloaded by `/api/user-pokemon`. Server-side paging is not needed at 1,025 species.

## 4. My Team (flagship)

Shown in `mockups/team-*.png`.

- **Six slots** with slot 1 marked LEAD, plus the battle explanation: "Your Team fights in this order."
- **Reorder:**
  - **All devices:** ▲/▼ buttons. These are accessible, have 44 px targets and work on touch.
  - **Desktop:** drag-and-drop on top of the buttons (HTML5 DnD with keyboard parity through the buttons).
  - **Phone:** no DnD, because buttons are more reliable there.
- **Add:** an empty slot opens a picker sheet of owned variants not already on the Team. **Remove:** ✕, with no confirm dialog, because nothing is saved until **Save Team**.
- **Save bar:** a sticky text-box-styled bar summarizing unsaved changes, with Save and Discard. It is the only write, and it calls the **existing** `POST /api/set-pokemon-team`, so validation stays single-sourced (1–6 unique owned slots, under the user lock). Discord never writes the Team, so the two surfaces can't produce conflicting state. A battle that runs between load and save is unaffected, because battles read the Team when they start.
- **Stale-data guard:** after saving, re-render from the response's `currentTeam`. On 403 (expired), show "Your dashboard link expired — run /dashboard in Discord." On 503 (not ready / saves degraded), show the server's message.
- **Today's evolve rule:** `POST /api/pokemon/evolve` already blocks evolving a variant that is on the Team. The Team page links to My Pokémon → Evolve and explains why.

## 5. Pokémon detail (drawer / sheet)

Tabs:

- **Overview:** sprite with a normal/shiny toggle (only for owned variants), types, tier, region, #, owned counts.
- **Stats:** stats at Level.
- **Moves:** the battle moves (the auto moveset) plus upcoming level-up moves.
- **Progression:** Level, EXP bar, evolves to/from with requirements.

**Backend need:** stats and moves are computed only in bot code (`computeStats`, `autoMoveset`). **Proposal (NEEDS APPROVAL):** a read-only `GET /api/pokemon/detail?id=…&species=…&variant=…` that returns `slotView()` from `utils/render/teamView.js`, the same function the Discord images use. Discord and the dashboard can then never disagree. It would be session-checked like every route and would not mutate. The alternative, duplicating the formulas in browser JS, is rejected because it creates drift risk.

## 6. Backend additions (all read-only; each needs approval)

| # | Change | Why |
|---|---|---|
| B1 | Add `battle: {rating, wins, losses}` to `GET /api/user-pokemon` | Overview battle card |
| B2 | `GET /api/pokemon/detail` returning `slotView()` | Detail stats/moves without duplicated formulas |
| B3 | Serve display names (from `names.js`) with the species list, or ship `names.js` to the browser | Fix the 24 slug names on the dashboard |
| B4 | Optional: make `GET /api/user-pokemon` non-mutating (it runs `normalizeUserSchema` on read today) | Read paths shouldn't write. Coordinate with the data-integrity work. |
| B5 | Decision: dashboard session length (10 min today) | UX vs. token risk. A sliding expiry is one option. |

## 7. Responsive & accessibility standards

- **Breakpoints:** ≤ 520 (phone), ≤ 820 (tablet/phone landscape: tab bar), > 820 (sidebar).
- **No horizontal overflow at 360 px.** Grids use `repeat(auto-fill, minmax(…))`. Sprites use `image-rendering: pixelated` and integer `transform: scale()`.
- **Touch targets:** 44 × 44 minimum. Visible `:focus-visible` everywhere.
- Replace `alert()`/`confirm()` with in-page dialogs (`<dialog>`, focus-trapped). Use `role="status"` toasts.
- Icons get text labels or `aria-label`. Type chips get text, not color alone. Progress bars get `aria-label` with a percentage.
- Respect `prefers-reduced-motion`: show the static first frame of sprites (the server already has every sprite as a GIF, and the first frame can be served as PNG later if needed).

## 8. Technical architecture

```
                 ┌──────────── game logic (unchanged) ────────────┐
                 │ training.js · battle/{data,stats,moveset,power} │
                 │ runBattle.buildTeam · rankSystem · speciesCatalog│
                 └───────────────┬─────────────────────────────────┘
                                 │ read-only
                 utils/render/teamView.js  (view models: slotView, buildTeamView)
                 utils/render/names.js     (display names)
                    │                                   │
     Discord images │                                   │ dashboard (JSON over existing/approved APIs)
   utils/render/    ▼                                   ▼
   tokens · primitives · sprites · gif         public/shared/tokens.css + components.css
   showteam (+ future: inspect, profile)       vanilla JS pages (no build step)
```

- **Separation:** view models are pure and read-only. Renderers draw view models only. Commands fetch, build the view and render. No game rule lives in presentation code.
- **One sprite path:** the manifest (`utils/sprites.js`) for URLs, and local files for canvas (`utils/render/sprites.js`). No HTTP self-fetches.
- **One encoder:** `utils/render/gif.js`. Battle adopts it in Milestone C (a behavior-preserving refactor, guarded by the existing `battleRender.test.js`).
- **Consolidation:** the three tier palettes → `tokens.js` (keep the old exports as re-exports for compatibility). The two type maps → `battle/data.js` + `tokens.js`. Team normalization → `teamNormalize.js`.
- **No new runtime dependencies** in the prototype. The optional bundled font is the only proposed asset.

## 9. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Memory pressure from animated renders on the 512 MB machine | Medium | Bot restart | Concurrency cap (2) + PNG fallback; measure RSS on Fly before enabling GIFs |
| Font differences dev vs prod (DejaVu wider) | High | Cosmetic | Measured text fitting (already in place); bundle a font (approval) |
| Behavior change: `/showteam` stops showing ghost slots | Certain | Positive, but visible | Release note: "/showteam now shows exactly your battle Team" |
| Dashboard redesign breaks existing flows (evolve/donate/convert/bulk) | Medium | High | Restyle in place first (Milestone D) with the same DOM IDs and scripts; feature work later (E); manual test checklist per mode |
| Team writes from two surfaces conflict | Low | High | Discord never writes the Team; one endpoint, under the user lock |
| Slug-name display fix confuses search | Low | Low | Search matches display and stored names |
| Every master merge deploys | Certain | High | Work on `design/visual-ux-overhaul`; user merges; no Fly actions |

## 10. Prioritized implementation roadmap

| Milestone | Scope | Complexity | Depends on |
|---|---|---|---|
| **A — Audit & design** ✅ (this branch) | 4 docs, tokens, primitives | — | — |
| **B — `/showteam` prototype** ✅ (this branch) | 3 layouts, previews, tests, timings | — | — |
| **C1 — `/showteam` live** | Wire the approved layout, inspect select, owner-only Manage button, concurrency cap, retire `trainerCardCanvas.js` | M (2–3 days) | Layout approval |
| **C2 — Inspect & shared names** | `/inspectpokemon` → rendered card (C-style lead panel) + embed text fallback; display names across embeds | M | C1 |
| **C3 — Embed consistency** | One brand color; tier palette consolidation; `/daily` result as one rendered strip | S–M | C1 |
| **C4 — Battle encoder adoption** | Battle uses `gif.js` (no visual change) | S | C1 |
| **D — Dashboard foundation** | `shared/tokens.css`, `components.css`, new nav (sidebar/tab bar, real links), restyle all player pages in place, a11y baseline, error/expiry states | L (4–6 days) | — (can run in parallel with C) |
| **E1 — My Team page** | Mockup → real (reorder, add/remove, save bar) using the existing endpoint | M | D |
| **E2 — Collection upgrades** | Shiny/region filters, sort, incremental rendering, list view | M | D |
| **E3 — Overview + detail** | Home page; detail drawer | M | D, approvals B1–B3 |

### Acceptance criteria

**C1:** see SHOWTEAM-REDESIGN.md §"Acceptance criteria".

**C2:**
- `/inspectpokemon` shows the player's owned variants with real stats and moves (unchanged numbers vs. today's text, asserted in tests).
- Unowned species show base stats only.
- Ephemeral and permission behavior are unchanged.

**C3:**
- Every player-facing embed uses the brand color or a semantic color from tokens.
- `rarityPalette.js`/`colors.js`/`spriteconfig.js` re-export from `tokens.js`.
- Existing tests are green.

**C4:**
- `battleRender.test.js` passes unchanged.
- Battle GIF byte size stays within ±5 % on fixtures.

**D:**
- All player pages use `tokens.css`. No page has its own `:root` palette.
- Nav works by keyboard and screen reader (`aria-current`).
- No horizontal scroll at 360 px on any page.
- 44 px targets.
- Expired-session message on every page.
- Every existing action still works: team save, evolve, donate, bulk donate, convert, set trainer, unlock trainer, shop purchases, weekly pack, achievement claim. This is checked against a local bot with synthetic data.

**E1:**
- Reorder by buttons and by drag.
- Saved order equals the battle order (`buildTeam`).
- Save is disabled until something changes.
- 403/503 are handled.
- Works at 390 px.

**E2:**
- Filters combine.
- 1,025-card worst case is interactive in < 1 s on a mid-range phone (Lighthouse, throttled).
- Shiny and region filters are correct against fixtures.

**E3:**
- Every Overview number matches its API field.
- Detail stats and moves equal the Discord inspect output for the same Pokémon (same `slotView`).
