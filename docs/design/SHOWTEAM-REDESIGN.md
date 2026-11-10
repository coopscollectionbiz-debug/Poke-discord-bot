# `/showteam` Redesign

Milestones A (part 4) and B. This is a working prototype only: **production `/showteam` is unchanged** until a layout is approved.

## Prototype contents

| File | Role |
|---|---|
| `utils/render/teamView.js` | Read-only view model. The Team exactly as battles use it (`buildTeam`), plus real per-slot facts: types, tier, region, Level, EXP progress, stats at Level, the Moveset battles use, and Team Power. |
| `utils/render/showteam.js` | Three layouts (`grid`, `roster`, `hybrid`). Output is a PNG or an animated GIF. |
| `utils/render/{tokens,primitives,sprites,gif,names}.js` | Shared design system pieces (see DESIGN-SYSTEM.md) |
| `tests/fixtures/showteamFixtures.js` | Synthetic players: full, partial, stress, fallback, empty. No real player data. |
| `tests/showteamRender.test.js` | 64 assertions: view model, no mutation, scaling, fallbacks, every layout × fixture |
| `tools/preview-showteam.mjs` | Renders `docs/design/previews/*` and `timings.json` |

To regenerate the previews:

```bash
node tools/preview-showteam.mjs
```

## Data shown (and not shown)

Each slot shows: the slot number (1 = **Lead**, because the Team fights in slot order), sprite, name (display-corrected; see `names.js`), the shiny mark, Level, type chips, tier pips, and EXP progress toward the next Level. The header shows trainer name, rank, TP, Team Power (`teamPower`, the number battles use for the underdog surge), and Battle rating with W–L.

Nicknames, HP, status, abilities, natures and IV/EVs are **not shown, because the game has none of them** (VISUAL-UX-AUDIT §1). A test asserts the view model exposes no such fields. **Alternate forms** are disabled game-wide (`utils/forms.js`). If they are enabled later, the view model only needs a sprite id and display name from the form record. Layouts make no per-species assumptions.

## Behavior fixes included in the view model

| Today | Prototype |
|---|---|
| Shows raw `displayedPokemon`, including variants no longer owned (ghost slots) and duplicates | Uses `buildTeam`, so it shows exactly the Pokémon that will battle |
| No Team: first six keys as *normal*, even if only the shiny is owned | No Team: first six species with a normal copy, and the image **says** it's a fallback ("No Team set… Pick your Team on /dashboard") |
| Brand-new player: an empty grid of "Empty" | Six deliberate empty slots + "No Pokémon yet. Catch some by chatting…" |
| Sprites fetched over HTTP from the public URL (≤12 requests, with a `.png` miss each) | Read from local files through the manifest and cached (≤200 trimmed sprites, ~3 MB) |
| `✨` emoji and `✮` glyphs drawn into the canvas (no emoji font on Fly) | Vector sparkle and tier pips |
| "Sprite failed" debug text | Poké Ball placeholder |

The view model never mutates the player record (tested for every fixture).

## The three candidates

Every layout is 1200 px wide, with an aspect ratio of 1.46–1.54 so Discord's ~550 px preview stays tall enough to read. Sprites use one uniform 2× scale per image (3× for the hybrid's lead), with hard pixel edges.

| | A — Grid | B — Battle roster | C — Hybrid |
|---|---|---|---|
| Preview | `previews/grid-full.png` | `previews/roster-full.png` | `previews/hybrid-full.png` |
| Size | 1200 × 820 | 1200 × 800 | 1200 × 780 |
| Composition | Header, then six equal cards (3 × 2) with sprite stages | Battle stage: two side panels of three platforms, then a game text box with trainer, rank, Power and record | Trainer panel, a featured lead with moves, then five compact cards |
| Visual polish | High: clean, very legible | **Highest:** cinematic, unmistakably this game | High, but the compact cards are cramped |
| Info density | Medium (tier pips, types, Level, EXP per slot) | Medium (the same facts; tier pips added) | Highest (lead moves, trainer stats) |
| Phone legibility (360 px; `previews/readability-sheet.png`) | Good: names readable, chips readable by color | **Best:** biggest sprites, least chrome | Poor: compact names ~6 px, trainer stats unreadable |
| Consistency with battles | Medium (cards are a dashboard idiom) | **Direct:** same background, panels, platforms, text box, Poké Ball row | Medium |
| PNG render, cold / warm | 65 / 52 ms | 58 / 58 ms | 59 / 63 ms |
| Animated GIF, 24 frames | 829 ms, 465 KB | **428 ms, 478 KB** | 701 ms, 494 KB |
| Edge cases (stress/partial/fallback/empty) | All clean | All clean; a half-empty Team leaves one empty panel | All clean; empty is the weakest |

The timings come from a Windows dev machine (PNG includes sprite decoding when cold). The Fly machine is a shared vCPU, so expect up to 2–3× longer. Whole-process RSS during the preview run was 108 MB.

Round 1 recommended B. You preferred A, so round 2 (below) builds a refined A/B hybrid. The round-1 phone column used a 360 px width; round 2 uses a more realistic 310 px (see "Viewing conditions").

---

## Round 2 — Refined A/B hybrid (`layout: "refined"`)

`utils/render/showteamRefined.js`, registered in `showteam.js`. A, B and C are unchanged and still render.

| Deliverable | File |
|---|---|
| Full resolution (1200 × 920) | `previews/hybrid-ab-refined-full.png` |
| Animated (24 frames) | `previews/hybrid-ab-refined-full.gif` |
| In Discord, desktop | `previews/hybrid-ab-refined-desktop.png` |
| In Discord, phone (390 × 844 screen at 2× density) | `previews/hybrid-ab-refined-phone.png` |
| A vs B vs refined, same Team and conditions | `previews/comparison-a-b-refined.png` |
| Edge cases | `previews/hybrid-ab-refined-{partial,stress,fallback,empty}.png` |

To regenerate the previews and re-run the benchmark:

```bash
node tools/preview-refined.mjs
```

```bash
node tools/bench-showteam.mjs
```

### Design rationale

The Pokémon are the subject, so the card exists to give them a stage. Everything that isn't sprite, name, Level or type was made smaller, merged, or moved to the card's edges.

### Changes from A

| A | Refined |
|---|---|
| Sprite in an inset sunken panel, 10 px inside the card | The stage runs edge to edge. The card *is* the stage, with a darker info band as its floor. |
| 2× sprites (median 108 px) | **3× sprites** (median 162 px), +50 % linear size |
| Tier as unlabeled diamonds | **Rarity pill:** the tier name ("LEGENDARY") in the tier color, the same pill as the catch card. The diamonds were dropped at the owner's request. |
| EXP as a rounded inset pill, similar to the battle HP bar | **EXP as a flat strip along the card's bottom edge** in the games' EXP blue. The HP bar is a rounded pill with an "HP" tag that goes green→yellow→red, so the two can't be confused. |
| Header: name, rank line, power stacked over "Rating · W–L" text | **Compact header:** name + Poké Ball row, rank · TP, and three aligned stat blocks (Team Power, Rating, Record) |
| Names 30 px, Level 24, type label 15 | Names **36**, Level **28**, type label **18** (chip 32 px tall) |
| Cards 3 px apart from a 32 px margin | 16 px margin and 12 px gaps, giving more of the width to cards |
| Shiny: gold ring + gold wash | Shiny: gold ring + **gold-lit platform** + sparkle by the name (no wash) |

### Features borrowed from B

- The battle platforms: lit **blue** for the lead and **gold** for a shiny. These are B's spotlights, inside A's cards.
- The Poké Ball nameplate row in the header (one ball per filled slot).
- Bigger sprites and less chrome, which is what made B legible on phones.
- A soft grounding shadow under each Pokémon's feet, sized to the sprite.

Not borrowed: B's game text box (the header carries the same facts more compactly) and its shared row panels (A's per-card separation was what you preferred).

### Sprite treatment

- Every Pokémon is drawn at the **same 3× scale**, so relative size is preserved: Pikachu stays smaller than Charizard, and small Pokémon aren't blown up.
- Edges stay hard (nearest-neighbor), so nothing is blurred.
- The few sprites taller than about 85 px (≈3 % of species) shrink just enough to fit their stage, for example Lugia at ~2.5×. They're never cropped.
- Missing sprite → Poké Ball placeholder. Normal and shiny variants both use the manifest. Animation is unchanged (the battle sprite player).

### Viewing conditions

Discord doesn't publish its image display sizes. These are the stated assumptions, applied identically to every layout:

- **Desktop:** a single image attachment is shown up to **550 CSS px** wide.
- **Phone:** a 390 px-wide screen. Messages are indented past the 40 px avatar column, so the image is about **310 CSS px** wide. Round 1's 360 px was optimistic.
- Downscaling uses high-quality smoothing, as the client does.
- **Unverified:** some Discord clients may also cap image *height* (≈350 px has been reported). If so, taller images display narrower: A (820 px tall) would show 512 px wide, B (800) 525 px, refined (920) 457 px. **Verify in a real client before Milestone C.** If the cap is real, the refined stage can drop to about 1200 × 840 by trimming 40 px from each card's stage.

### Readability findings

Effective size = drawn px × display width / 1200, in CSS px. Text below about 6 CSS px is not reliably readable; below 4 it reads as color only.

| Element | A desktop / phone | B desktop / phone | **Refined** desktop / phone |
|---|---|---|---|
| Pokémon sprite (median species) | 49 / 28 | 49 / 28 | **74 / 42** |
| Pokémon name | 13.8 / 7.8 | 13.8 / 7.8 | **16.5 / 9.3** |
| Level number | 11.0 / 6.2 | 11.0 / 6.2 | **12.8 / 7.2** |
| Type chip (height / label) | 12.8·6.9 / 7.2·3.9 | same as A | **14.7·8.3 / 8.3·4.6** |
| Rarity | pips only | pips only | pill: label 7.8 / 4.4 (desktop readable; reads by color on phone) |
| Team Power value | 15.6 / 8.8 | 14.7 / 8.3 | 14.7 / 8.3 |
| Trainer name | 18.3 / 10.3 | 13.8 / 7.8 | 17.4 / 9.8 |

Findings (see `comparison-a-b-refined.png`):

- **On phones, the refined layout beats both originals.** Sprites are 50 % larger than in either. Names and Levels are about 17–20 % larger. Every Pokémon is identifiable at a glance on the phone mock.
- **The mobile gap with B is closed and reversed.** B's round-1 advantage came from sprite and name prominence, and the refined layout now exceeds B on both.
- **Still small on phones:** the type-chip *labels* (~4.6 px), the rarity label (~4.1 px) and the header stat labels. On phones these read by **color** (type chips, rarity pill color + diamond count) rather than by text. That's acceptable for a summary image, and every one of them is readable on desktop. Making them phone-legible would mean roughly 2× text, which would no longer fit six cards. The planned "Inspect" follow-up (an ephemeral, single-Pokémon card) is where phone players get the details.

### Performance results

Same "full" Team, same machine, each layout in a **fresh process** (`tools/bench-showteam.mjs`). Static = PNG; warm = median of 5; GIF = median of 3, 24 frames × 100 ms.

| | A — Grid | B — Roster | **Refined** |
|---|---|---|---|
| Image size | 1200 × 820 | 1200 × 800 | 1200 × 920 |
| Static, cold (decodes 6 sprites from disk) | 70 ms | 64 ms | 65 ms |
| Static, warm | 52 ms | 50 ms | 58 ms |
| **Animated GIF** | 689 ms | 421 ms | **410 ms** |
| PNG size | 151 KB | 218 KB | 193 KB |
| GIF size | 465 KB | 478 KB | 712 KB |
| Frames | 24 | 24 | 24 |
| Peak RSS above baseline | 54 MB | 52 MB | 54 MB |
| Sprite loading | 6 GIFs read + first frame decoded and trimmed (5–6 ms total), then cached (LRU, 200 entries). GIF output reads each animated sprite again for playback (~1 ms) and decodes frames lazily. | same | same |

- **Why the refined GIF is the fastest:** it draws in layers. The background, cards, text and platforms are drawn **once**. Each frame copies that layer and redraws only the six sprites and the small badges on top. A and C redraw everything every frame, including blurred shadows. A could get the same speed-up.
- **Why its GIF is larger:** 3× sprites change about 2.25× more pixels per frame. At 712 KB it's still far below Discord's attachment limit.
- **About the round-1 numbers** (A 0.83 s, B 0.43 s, C 0.70 s): they were measured in one shared process. Fresh-process numbers are A 0.69 s and B 0.42 s.
- The timings are from a Windows dev machine. The Fly machine has a shared vCPU, so expect 2–3× longer. Peak memory is dominated by the GIF encoder's fixed buffers and is the same for all layouts.

### Remaining trade-offs

- **Height:** 920 px is the tallest of the three. This matters only if Discord caps image height (unverified, see above).
- **GIF bytes:** +50 % vs A/B (712 KB) because of the bigger animated sprites.
- **Phone-size labels:** type, rarity and stat *labels* are color-coded rather than readable on phones (see findings).
- **Lugia-class sprites** shrink to ~2.5× to fit, so they're slightly less dominant than their true size relative to the rest.
- **Wide, tall sprites can tuck under the corner badges.** The badges are drawn on top with an opaque backing, so no information is hidden, but the sprite edge is covered.
- **Fonts:** previews use Segoe UI. Production would use DejaVu Sans (wider) unless a font is bundled. All text is fitted by measurement, so nothing overflows, but names may drop a size step sooner.

## Recommendation: **the refined A/B hybrid**

- It improves on A in every dimension you asked about: sprites +50 %, larger names, Level and type text, clearer rarity, EXP that can't be mistaken for HP, and a tighter header. It keeps A's card structure, lead and shiny highlights, and stats.
- It closes and reverses B's phone-readability advantage.
- It has the fastest animated render of the three.
- It costs a taller image and larger GIFs.

### Decisions for you

1. **Approve the refined layout as the Milestone C design**, or request another round of changes.
2. **Static or animated:**
   - **Recommended:** animated GIF (0.41 s, 712 KB), capped at 2 concurrent renders, with PNG as the fallback when busy.
   - **Alternative:** PNG only.
3. **Font:** bundle Inter (DESIGN-SYSTEM §7), or keep the system fallback.
4. **Fallback when no Team is set:** keep it (labeled), or show the empty state.
5. **Image height:** check whether Discord caps image height in your clients. If it does, approve a 40 px shorter stage.

---

## Related: the random-catch message (prototype)

Added on request in round 2. The prototype is `utils/render/catchCard.js`. It is **not wired to the live catch code** (`bot_final.js` passive reward and `utils/broadcastReward.js`).

### Today (confirmed in code and in your screenshot)

| Problem | Where |
|---|---|
| The sprite is an 80 px embed **thumbnail**, and Discord overlays a "GIF" badge on it, covering much of the Pokémon | `createPokemonRewardEmbed` → `.setThumbnail()` (`utils/embedBuilders.js:93`) |
| The catch is said **twice**: the content line "@Coop caught **Cubchoo**!" and then the embed's "You caught **Cubchoo!**" | `bot_final.js:1046` + the embed description |
| Generic title ("🎁 Pokémon Reward!"), footer emoji ("🌟 Coop's Collection Reward"), tier as "⚬ Common Tier" text | `embedBuilders.js:86-96` |
| No types, no Level, no first-catch indication. `grantCatch()` already returns `{ level, isNew, expGained }`, and the passive catch code **discards it**. | `bot_final.js:1020` |
| Slug names: "Giratina-altered", "Mr-mime" | `reward.name` used raw |
| The global or rare-sightings broadcast uses **different wording** for the same event ("Common Pokémon Found! … 🌿 A wild Pokémon appeared!") and a different footer | `utils/broadcastReward.js:157-175` |

### Proposal

- **One message:** the ping line, then a 1000 × 360 rendered **catch card** as an attachment, with no embed text repeating it. The content line keeps the mention so the player is still notified, for example "@Coop caught a wild **Cubchoo**!" or "…caught a ✨ shiny **Dragonite**!".
- **Card contents:**
  - the sprite at 3× on a tier-lit platform (gold for shiny)
  - "WILD POKÉMON CAUGHT!" or "SHINY POKÉMON CAUGHT!"
  - the display name, Level (the real catch Level), type chips and a rarity pill
  - **NEW** for a first catch of that species + variant, or **+EXP · ×N owned** for a duplicate (grantCatch's own numbers)
  - "Caught by …"
  - **regional Pokédex completion** ("Unova Pokédex 47/156"), using the CONTEXT.md definition and the achievements catalog's region sizes
- **Broadcast channels** reuse the same image, with a no-ping line ("Coop caught …"), so all channels match.

| Preview | File |
|---|---|
| Cards | `previews/catch-{newCommon,shinyDuplicate,newLegendary}.png` (+ `.gif`) |
| In Discord | `previews/catch-discord-desktop.png`, `previews/catch-discord-phone.png` |

**Performance** (`previews/catch-timings.json`): PNG 16–19 ms, ~55 KB. Animated GIF (20 frames) 95–126 ms, 65–130 KB. Catches are frequent, so the recommendation is **animated for shiny and Rare-or-better, PNG for Common/Uncommon**. That's a decision for you.

**Implementation (Milestone C, after approval):**

1. Capture `grantCatch`'s return value.
2. Render the card.
3. Send `{ content, files: [card] }`.
4. Pass the same buffer to `broadcastReward`.
5. If rendering fails, send today's embed.

There is no change to catch odds, rewards or saving.


## Interaction proposal (Milestone C, after approval)

These are presentation-side only. No new team-editing path is added in Discord.

| Control | Who | Does | Implementation |
|---|---|---|---|
| Select menu "Inspect a Team member…" (≤6 options) | Anyone viewing | Ephemeral reply: the C-style featured card for that slot (sprite, types, tier, Level + EXP, stats at Level, battle moves, region/#) | `showteam:${nonce}:inspect`, message-scoped collector, read-only |
| Button "Manage Team" | Team owner only (others get an ephemeral "This is X's Team") | Ephemeral dashboard link, using the same one-time token flow as `/dashboard` | Reuses existing token code. **Does not** add a Discord write path, so team state stays single-sourced in `POST /api/set-pokemon-team`. |

- **Expiry:** the collector stops after 10 minutes, then components are disabled (the pattern in `/inventory` and `/achievements`).
- **Not proposed:** reordering or changing slots from Discord. That would be a second write path for the Team, and the brief requires no conflicting team state. If wanted later, it must call the same validation as `/api/set-pokemon-team` (extracted to a service), and it needs approval.

## Acceptance criteria for Milestone C (the `/showteam` part)

- [ ] `/showteam` renders the approved layout from `buildTeamView`, with the same command name, options, visibility (public) and permissions.
- [ ] Slots equal `buildTeam(user)` for every fixture. There are no ghost or duplicate slots.
- [ ] No network fetches during render. A missing sprite becomes the placeholder, never an error.
- [ ] p95 render on Fly ≤ 300 ms (PNG) or ≤ 1.5 s (GIF), and peak extra RSS ≤ 60 MB per render. Measured on the staging machine before release.
- [ ] The inspect select and owner-only Manage button work and expire cleanly. Tests cover the custom-ID routing.
- [ ] Regression screenshots are regenerated in `docs/design/previews/` and reviewed.
- [ ] `utils/trainerCardCanvas.js` (only `/showteam` uses it) is retired along with its latent missing-import crash.
- [ ] No change to battle mechanics, levels, teams or any stored data.

---

## Milestone C1 — `/showteam` live on the branch (2026-11-10)

The owner approved the refined layout and asked for the rarity pill to show the tier name only. This is implemented on `design/visual-ux-overhaul` and **not merged or deployed**.

| Item | Status |
|---|---|
| `commands/showteam.js` renders `buildTeamView` → `renderShowteam(…, { layout: "refined" })`. The name, description, visibility (public) and permissions are unchanged (tested). | Done |
| **Animated GIF, at most one render at a time** (`utils/render/renderGate.js`). Anyone else gets the PNG immediately. A failed GIF falls back to the PNG. `SHOWTEAM_ANIMATED=0` forces PNG with no deploy of code. The cap is 1, not the 2 proposed earlier, because the 512 MB machine has about 220 MB free and battle GIFs render alongside. | Done |
| "Inspect a Team member…" select (anyone): an ephemeral 1000 × 440 card (`utils/render/inspectCard.js`) with Level, EXP %, types, rarity, region and #, **stats at Level** and **battle moves**. These come from `slotView()`, so they're the battle's own numbers. Previews: `previews/inspect-lead.png`, `previews/inspect-shiny.png`. | Done |
| "Manage Team" button (owner only; others get "This is X's Team…"): an ephemeral one-time dashboard link from the same token flow as `/dashboard`. **No new write path.** | Done |
| Controls are nonce-scoped (`showteam:<nonce>:…`) and expire after 10 minutes, then are disabled. An empty Team shows no controls. | Done |
| `utils/trainerCardCanvas.js` removed (only `/showteam` used it). This also removes its latent missing-import crash. | Done |
| Tests: `tests/showteamCommand.test.js` (definition, components, routing and permissions, Manage token, GIF gate and fallbacks, inspect card) + `tests/showteamRender.test.js` | Done |
| Not done in C1: fonts (system fallback kept), the catch card (prototype only, awaiting approval), other commands, dashboard | — |

### Behavior changes players will notice

- The image shows exactly the Pokémon that battle. "Ghost" slots (variants no longer owned) and duplicates are gone.
- When no Team is set, the image still shows the first Pokémon owned, now labeled, and never a variant the player doesn't own.
- Slug names display properly ("Mr. Mime", "Giratina").
- New Inspect and Manage Team controls appear under the image.

### Before release (owner's call)

1. Check Discord's height cap in a real client (see "Viewing conditions").
2. Measure on Fly: p95 render time and RSS during a GIF.
3. Merge. Every merge to master deploys.
