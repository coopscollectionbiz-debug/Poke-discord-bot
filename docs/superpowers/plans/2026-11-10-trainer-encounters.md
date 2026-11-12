# Trainer Encounters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a player chats, a computer-run Trainer can spot them and post a card asking for a fight; Battle! plays it out for Prize money and EXP, Run declines.

**Architecture:** Pure modules under `utils/encounter/` roll the Trainer (`generate.js`), gate spotting and settle the fight (`runEncounter.js`); `utils/encounter/service.js` owns the Discord side with an in-memory map of open encounters, reached through the bot's global button handler so clicks after a restart are answered. The card is a new renderer that reuses the challenge VS card's pieces; the replay reuses `utils/battle/playback.js`.

**Tech Stack:** Node ESM, discord.js 14.28.0, @napi-rs/canvas, the repo's test harness (`tests/harness.js`, `npm run test:safe`).

**Spec:** `docs/superpowers/specs/2026-11-10-trainer-encounters-design.md`

## Global Constraints

- Worktree `/Users/b/dev/Poke-discord-bot-challenges`, branch `feat/challenges`. Never push; never touch `local/test-challenges` except the TEMP step at the end; never start the bot against production.
- Tuning values (spec, decided): chance 0.01 per TP-earning message, 30-minute gap, 8 per UTC day, 2-minute answer window, tiers Under 0.7 [−15, −2], Even 0.2 [−2, +2], Over 0.1 [+5, +15], floor Lv 5, cap Lv 100, party 3–6, Ace share 0.5 of Over, surprise 0.03 of Under at [+10, +25].
- Prize money = class base × Level of the last Pokémon; bases 10, wealthy 40, Ace Trainer 30.
- Copy: American English, no em dashes, says only what the player can't see. All Trainer lines are original, in the games' voice, run through /unslop. Test fixtures use "Ash", never real handles.
- Rendering: pixel art at whole scales with smoothing off; text ≥22 px for what must be read, 18 px micro labels (docs/design/DESIGN-SYSTEM.md); blue = player, red = opponent.
- Run a single test file with `TRAINERDATA_DIR=<scratchpad>/td node tests/<file>`; the whole suite with `npm run test:safe`.
- Commit per task (approved for this branch); scan each diff for secrets and personal data before staging.

## Review Focus

- Two messages from one player that both hit the roll before the first card posts: exactly one card. (Task 6 test "one card for simultaneous hits".)
- A double click on Battle!, or Battle! racing the 2-minute timeout: exactly one outcome. (Task 6 test "one outcome per encounter".)
- The player spends CC between the card and Battle!: they pay at most what they hold at the click and never go negative. (Task 3 test "pays at most the balance at the click".)
- The card fails to render: the embed fallback carries the same buttons and the flow still works. (Task 6 test "embed fallback keeps the buttons".)
- A Team averaging Lv 5–7, where every band clamps to the floor: every class still has enough species. (Task 2 test "every class has species at every Level".)

---

### Task 1: Tuning, Trainer classes and lines

**Files:**
- Modify: `utils/battle/tuning.js` (append `ENCOUNTER`)
- Create: `utils/encounter/roster.js`, `utils/encounter/lines.js`
- Test: `tests/encounterRoster.test.js`

**Interfaces:**
- Produces:
  - `ENCOUNTER = { chance: 0.01, gapMs: 1_800_000, perDay: 8, answerMs: 120_000, tiers: [{ key: "under", share: 0.7, band: [-15, -2] }, { key: "even", share: 0.2, band: [-2, 2] }, { key: "over", share: 0.1, band: [5, 15] }], minLevel: 5, maxLevel: 100, partySize: [3, 6], aceShare: 0.5, surprise: { share: 0.03, band: [10, 25] } }`, with a comment citing the spec.
  - `TRAINER_CLASSES: Record<key, { key, title, spriteKey, gender: "m"|"f", types: string[] /* [] = any */, base: number, ace: boolean, lines: string /* LINES key */ }>`; `ACE_KEYS`, `REGULAR_KEYS` (string[]); `classSprite(key) => string` (first enabled file, via `enabledSprites` from `utils/challenge/roster.js`); `NAMES = { m: string[], f: string[] }` (at least 30 each, classic route-Trainer first names).
  - `LINES: Record<setKey, { intro: string[], lost: string[], won: string[] }>` (`lost`: the Trainer lost, `won`: the Trainer won); `OVER_INTRO: string[]`; `RAN: string[]` and `LOST_INTEREST: string[]` as templates with `{player}` and `{trainer}`; `STALE_LINE = "This Trainer lost interest."`; `fill(template, { player, trainer }) => string`.

The classes (key: title, spriteKey, gender, types, base, lines):

| key | title | spriteKey | g | types | base | lines |
|---|---|---|---|---|---|---|
| youngster | Youngster | youngster | m | Normal, Flying, Poison, Bug | 10 | youngster |
| lass | Lass | lass | f | Normal, Fairy, Grass | 10 | lass |
| bugcatcher | Bug Catcher | bugcatcher | m | Bug | 10 | bugcatcher |
| camper | Camper | camper | m | Ground, Normal, Fire | 10 | camper |
| picnicker | Picnicker | picnicker | f | Grass, Normal, Water | 10 | picnicker |
| hiker | Hiker | hiker | m | Rock, Ground | 10 | hiker |
| fisherman | Fisherman | fisherman | m | Water | 10 | fisherman |
| swimmer | Swimmer | swimmer | m | Water | 10 | swimmer |
| swimmerf | Swimmer | swimmerf | f | Water | 10 | swimmer |
| sailor | Sailor | sailor | m | Water, Fighting | 10 | sailor |
| birdkeeper | Bird Keeper | birdkeeper | m | Flying | 10 | birdkeeper |
| blackbelt | Black Belt | blackbelt | m | Fighting | 10 | blackbelt |
| battlegirl | Battle Girl | battlegirl | f | Fighting | 10 | battlegirl |
| psychic | Psychic | psychic | m | Psychic | 10 | psychic |
| psychicf | Psychic | psychicf | f | Psychic | 10 | psychic |
| channeler | Channeler | channeler | f | Ghost | 10 | channeler |
| hexmaniac | Hex Maniac | hexmaniac | f | Ghost, Dark | 10 | hexmaniac |
| juggler | Juggler | juggler | m | Psychic, Electric | 10 | juggler |
| engineer | Engineer | engineer | m | Electric, Steel | 10 | engineer |
| supernerd | Super Nerd | supernerd | m | Poison, Electric, Fire | 10 | supernerd |
| burglar | Burglar | burglar | m | Fire, Poison, Dark | 10 | burglar |
| biker | Biker | biker | m | Poison, Dark | 10 | biker |
| firebreather | Firebreather | firebreather | m | Fire | 10 | firebreather |
| pokemaniac | PokéManiac | pokemaniac | m | Dragon, Ground, Rock | 10 | pokemaniac |
| dragontamer | Dragon Tamer | dragontamer | m | Dragon | 10 | dragontamer |
| skier | Skier | skier | m | Ice | 10 | skier |
| skierf | Skier | skierf | f | Ice | 10 | skier |
| rocketgrunt | Team Rocket Grunt | teamrocketgruntm | m | Poison, Normal, Dark | 10 | rocket |
| rocketgruntf | Team Rocket Grunt | teamrocketgruntf | f | Poison, Normal, Dark | 10 | rocket |
| gentleman | Gentleman | gentleman | m | Normal, Fire | 40 | gentleman |
| lady | Lady | lady | f | Fairy, Normal | 40 | lady |
| richboy | Rich Boy | richboy | m | Normal | 40 | richboy |
| beauty | Beauty | beauty | f | Normal, Water, Grass | 40 | beauty |
| acetrainer | Ace Trainer | acetrainer | m | any | 30 | ace |
| acetrainerf | Ace Trainer | acetrainerf | f | any | 30 | ace |

- [ ] **Step 1: Write the failing test** `tests/encounterRoster.test.js`:

```js
section("Classes");
assertEqual(Object.keys(TRAINER_CLASSES).length, 35, "35 classes");
assertEqual(ACE_KEYS, ["acetrainer", "acetrainerf"], "two Ace Trainer classes");
assertTrue(REGULAR_KEYS.every((k) => !TRAINER_CLASSES[k].ace) && REGULAR_KEYS.length === 33, "the rest are regular");
const challengeKeys = new Set(Object.values(CHALLENGES).flatMap((c) => c.opponents.map((o) => o.trainerKey)));
assertTrue(Object.values(TRAINER_CLASSES).every((c) => !challengeKeys.has(c.spriteKey)), "never a /challenge opponent");
assertTrue(Object.keys(TRAINER_CLASSES).every((k) => fs.existsSync(new URL(`../public/sprites/trainers_2/${classSprite(k)}`, import.meta.url))), "every sprite file exists");
assertEqual(classSprite("youngster"), "youngster-gen3.png", "the first enabled sprite, like the leaders");
assertEqual(["gentleman", "lady", "richboy", "beauty"].map((k) => TRAINER_CLASSES[k].base), [40, 40, 40, 40], "wealthy classes pay 40");
assertEqual([TRAINER_CLASSES.acetrainer.base, TRAINER_CLASSES.youngster.base], [30, 10], "Ace Trainer 30, the rest 10");
assertTrue(Object.values(TRAINER_CLASSES).every((c) => c.types.every((t) => Object.values(TYPE_ID_TO_NAME).includes(t))), "themes are real type names");

section("Names and lines");
assertTrue(NAMES.m.length >= 30 && NAMES.f.length >= 30, "30+ names each");
assertTrue(Object.values(TRAINER_CLASSES).every((c) => LINES[c.lines]), "every class has a line set");
assertTrue(Object.values(LINES).every((s) => s.intro.length >= 3 && s.lost.length >= 1 && s.won.length >= 1), "3 intros, 1+ after-battle each way");
assertTrue(OVER_INTRO.length >= 10 && RAN.length >= 4 && LOST_INTEREST.length >= 4, "the shared pools");
const all = [...Object.values(LINES).flatMap((s) => [...s.intro, ...s.lost, ...s.won]), ...OVER_INTRO, ...RAN, ...LOST_INTEREST, STALE_LINE];
assertTrue(all.every((l) => !/[—–]/.test(l)), "no em or en dashes in copy");
assertTrue(RAN.every((t) => t.includes("{player}") && t.includes("{trainer}")) && LOST_INTEREST.every((t) => t.includes("{trainer}")), "templates name who they're about");
assertEqual(fill("{player} ran away from {trainer}.", { player: "Ash", trainer: "Youngster Joey" }), "Ash ran away from Youngster Joey.", "fill");
```

- [ ] **Step 2: Run it** — `TRAINERDATA_DIR=<scratchpad>/td node tests/encounterRoster.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Write `ENCOUNTER`, `roster.js`, and `lines.js`.** Lines are original copy in each class's voice (the Youngster's shorts-and-Rattata enthusiasm, the Hiker's mountains, the Gentleman's manners), short enough for one line of a text box (about 60 characters). `OVER_INTRO` lines are calm, too-confident, or slightly off, and fit any class ("I don't usually battle on this route. Today I'll make an exception."). The Ace Trainer's own lines are openly confident. Run all copy through /unslop.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add utils/battle/tuning.js utils/encounter/roster.js utils/encounter/lines.js tests/encounterRoster.test.js && git commit -m "Add Trainer encounter classes, lines, and tuning"`

### Task 2: Rolling a Trainer

**Files:**
- Create: `utils/encounter/generate.js`
- Test: `tests/encounterGenerate.test.js`

**Interfaces:**
- Consumes: Task 1's `ENCOUNTER`, `TRAINER_CLASSES`, `ACE_KEYS`, `REGULAR_KEYS`, `NAMES`, `LINES`, `OVER_INTRO`, `classSprite`; `createRng` (`utils/battle/rng.js`); `floorLevel`, `catchBand` (`utils/training.js`); `isAcquirable` (`utils/speciesCatalog.js`); `getSpecies`, `TYPE_ID_TO_NAME` (`utils/battle/data.js`); `pokemonData.json`.
- Produces:
  - `teamAverage(team: {level}[]) => number` (rounded mean).
  - `candidates(classKey, level) => number[]`: acquirable species in the battle data, on theme (any type in `types`; `[]` = any), not `catchBand === "legendary"`, with `floorLevel(id) <= level` and no acquirable evolution (`evolvesTo`) whose `floorLevel <= level`. Cached per (classKey, level).
  - `surprisePool(level) => number[]`: the same rule with no theme and legendaries allowed.
  - `prizeMoney(classKey, party) => number`: `base × party.at(-1).level`.
  - `rollTrainer({ team, seed }) => { classKey, title, name, spriteFile, tier: "under"|"even"|"over", surprise: boolean, party: { speciesId, level }[], prize, lines: { intro, lost, won } }`. Deterministic for a seed. Distinct species within a party when the candidates allow. Party sorted by Level ascending (stable), so the surprise is last. Over-tier non-Ace Trainers take `intro` from `OVER_INTRO`.

- [ ] **Step 1: Write the failing test** `tests/encounterGenerate.test.js` (20,000 seeds for shares):

```js
const team = (lv, n = 6) => Array.from({ length: n }, () => ({ level: lv }));
const rolls = Array.from({ length: 20000 }, (_, i) => rollTrainer({ team: team(30), seed: i }));
const share = (f) => rolls.filter(f).length / rolls.length;
section("Tiers");
assertTrue(Math.abs(share((r) => r.tier === "under") - 0.7) < 0.015 && Math.abs(share((r) => r.tier === "even") - 0.2) < 0.015, "70 / 20 / 10");
const regular = (r) => r.party.filter((_, i) => !(r.surprise && i === r.party.length - 1));
assertTrue(rolls.filter((r) => r.tier === "under").every((r) => regular(r).every((m) => m.level >= 15 && m.level <= 28)), "Under: avg -15 to -2");
assertTrue(rolls.filter((r) => r.tier === "even").every((r) => r.party.every((m) => m.level >= 28 && m.level <= 32)), "Even: avg -2 to +2");
assertTrue(rolls.filter((r) => r.tier === "over").every((r) => r.party.every((m) => m.level >= 35 && m.level <= 45)), "Over: avg +5 to +15");
assertTrue([5, 100].every((lv) => Array.from({ length: 500 }, (_, i) => rollTrainer({ team: team(lv), seed: i })).every((r) => r.party.every((m) => m.level >= 5 && m.level <= 100))), "never below Lv 5 or above 100");
assertEqual(teamAverage([{ level: 10 }, { level: 11 }]), 11, "the rounded mean");
section("Party");
assertTrue(rolls.every((r) => r.party.length >= 3 && r.party.length <= 6) && [3, 4, 5, 6].every((n) => share((r) => r.party.length === n) > 0.2), "3 to 6, each common");
assertTrue(rolls.every((r) => r.party.every((m, i) => i === 0 || m.level >= r.party[i - 1].level)), "weakest to strongest");
section("Ace Trainers");
assertTrue(rolls.filter((r) => ACE_KEYS.includes(r.classKey)).every((r) => r.tier === "over"), "only in Over");
const over = rolls.filter((r) => r.tier === "over");
assertTrue(Math.abs(over.filter((r) => ACE_KEYS.includes(r.classKey)).length / over.length - 0.5) < 0.06, "half of Over");
section("The surprise");
const surprised = rolls.filter((r) => r.surprise);
assertTrue(surprised.every((r) => r.tier === "under") && Math.abs(surprised.length / rolls.filter((r) => r.tier === "under").length - 0.03) < 0.008, "3% of Under");
assertTrue(surprised.every((r) => { const lv = r.party.at(-1).level; return lv >= 40 && lv <= 55; }), "avg +10 to +25, sent out last");
section("Species");
assertTrue(rolls.every((r) => regular(r).every((m) => catchBand(m.speciesId) !== "legendary")), "regular Pokémon are never legendary or mythic");
assertTrue(rolls.every((r) => r.party.every((m) => floorLevel(m.speciesId) <= m.level && !hasFittingEvolution(m.speciesId, m.level))), "the furthest form that fits");
assertTrue(rolls.every((r) => regular(r).every((m) => onTheme(r.classKey, m.speciesId))), "on the class's theme");
assertTrue(Object.keys(TRAINER_CLASSES).every((k) => Array.from({ length: 96 }, (_, i) => i + 5).every((lv) => candidates(k, lv).length >= 3)), "every class has species at every Level");
section("Prize money");
assertTrue(rolls.every((r) => r.prize === TRAINER_CLASSES[r.classKey].base * r.party.at(-1).level), "base × the last Level");
assertEqual(rollTrainer({ team: team(30), seed: 7 }), rollTrainer({ team: team(30), seed: 7 }), "same seed, same Trainer");
```

(`hasFittingEvolution` and `onTheme` are small helpers in the test that read `pokemonData.json`, `floorLevel`, and `isAcquirable`.)

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `generate.js`.** One `createRng(seed)` drives every roll in a fixed order (tier, class, name, size, Levels, species, surprise, lines) so a seed reproduces a Trainer. Levels are uniform integers in the band, clamped. If a class fails the coverage assertion at some Level, widen that class's `types` in `roster.js` and say so in the commit message.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add utils/encounter/generate.js tests/encounterGenerate.test.js && git commit -m "Roll encounter Trainers from the player's Team"`

### Task 3: Who can be spotted, and the fight

**Files:**
- Create: `utils/encounter/runEncounter.js`
- Test: `tests/runEncounter.test.js`

**Interfaces:**
- Consumes: Task 1's `ENCOUNTER`; Task 2's `rollTrainer` output shape; `buildTeam`, `applyGains` (`utils/battle/runBattle.js`); `simulateBattle` (`utils/battle/sim.js`); `teamExp`, `utcDay` (`utils/battle/rewards.js`); `getTraining`, `speciesName` (`utils/training.js`); `trackProgress` (`progression/achievements.js`).
- Produces:
  - `getEncounterRecord(user, day) => { day, count, lastAt }` (creates `user.encounter`, resets `count` on a new day, keeps `lastAt`).
  - `spotBlock({ user, open, now: Date }) => null | "no_team" | "run_open" | "pending_wager" | "open" | "gap" | "cap"`. Read-only. `open` is whether this player already has an encounter open.
  - `recordSpot(user, now: Date) => void`: count + 1, `lastAt = now.getTime()`.
  - `fightEncounter({ trainerData, userId, encounter: { team: { speciesId, variant }[], trainer }, seed, now = new Date() }) => { ok: false, reason: "no_team" | "run_open" | "pending_wager" } | { ok: true, userId, trainer, sides: [{ userId, members }, { userId: "trainer", members }], surge: null, result, winnerId, won, exp: { [userId]: entries }, prize, paid }`. Members are the card's Team still owned, at their current Levels; foes are `variant: "normal"` with `name`. `paid` is the CC the player paid on a loss (0 on a win). Mutates only `trainerData[userId]`: EXP, CC, and a `pokemon` event to `trackProgress`. Never touches `user.battle` or `user.challenge`.

- [ ] **Step 1: Write the failing test** `tests/runEncounter.test.js`:

```js
section("Who can be spotted");
const now = new Date("2026-11-10T12:00:00Z");
assertEqual(spotBlock({ user: player([]), open: false, now }), "no_team", "no Team");
assertEqual(spotBlock({ user: { ...player(), challenge: { run: {} } }, open: false, now }), "run_open", "an open Elite Four run");
assertEqual(spotBlock({ user: { ...player(), pendingWager: {} }, open: false, now }), "pending_wager", "a wager waiting for an answer");
assertEqual(spotBlock({ user: player(), open: true, now }), "open", "one at a time");
const recent = player(); recordSpot(recent, new Date(now - 29 * 60_000));
assertEqual(spotBlock({ user: recent, open: false, now }), "gap", "within 30 minutes");
const full = player(); for (let i = 0; i < 8; i++) recordSpot(full, new Date(now - (i + 1) * 3_600_000 + 0));
assertEqual(spotBlock({ user: full, open: false, now }), "cap", "8 a day");
assertEqual(spotBlock({ user: full, open: false, now: new Date("2026-11-11T09:00:00Z") }), null, "a new UTC day");
assertEqual(Object.keys(validateUserSchema(full, "A", "A").encounter), ["day", "count", "lastAt"], "the record survives the validator");
section("The fight");
// win: STRONG Team vs a weak rolled Trainer; loss: WEAK Team vs an Over Trainer at Lv 100.
assertTrue(win.ok && win.won && user.cc === before + win.prize && win.paid === 0, "a win pays the prize money");
assertTrue(loss.ok && !loss.won && loser.cc === ccBefore - loss.prize && loss.paid === loss.prize, "a loss pays the same");
assertTrue(poor.paid === 37 && poorUser.cc === 0, "pays at most the balance at the click");
assertTrue(win.exp.A.some((e) => e.gained > 0) && loss.exp.A.some((e) => e.gained > 0), "EXP win or lose");
assertEqual(donated.sides[0].members.map((m) => m.speciesId), [6, 445], "a Pokémon no longer owned sits out");
assertEqual(fightEncounter({ ...allDonated }).reason, "no_team", "none left: refused");
assertEqual(fightEncounter({ ...withRun }).reason, "run_open", "re-checked at the click");
assertEqual([user.battle, user.challenge], [beforeBattle, beforeChallenge], "never the Battle record or challenges");
assertEqual(win.sides[1].members.map((m) => [m.speciesId, m.level]), trainer.party.map((m) => [m.speciesId, m.level]), "the Trainer's party, as rolled");
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `runEncounter.js`.** `spotBlock` order: no_team, run_open, pending_wager, open, gap (`now - lastAt < gapMs`), cap (`count >= perDay` on today's record, read without writing). `fightEncounter` uses `simulateBattle({ sides: [{ members }, { members: foes }], seed, surge: null })`; knockouts by side 0 feed `teamExp`; `paid = min(prize, max(0, cc))`.
- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add utils/encounter/runEncounter.js tests/runEncounter.test.js && git commit -m "Gate who a Trainer can spot and settle encounter fights"`

### Task 4: The encounter card

**Files:**
- Create: `utils/render/encounterCard.js`
- Modify: `utils/render/primitives.js` (add the "!"), `utils/render/challengeCard.js` (export `drawHalves`, `drawTrainer`, `drawVs`, `eyebrowAndTitle`; extract the Team grid from `drawPlayer` into exported `drawTeamGrid(ctx, team, gx, gy)` with no change in output)
- Test: `tests/encounterCard.test.js`; `tests/challengeCard.test.js` must still pass unchanged.

**Interfaces:**
- Consumes: Task 2's Trainer shape; `buildTeamView` (`utils/render/teamView.js`).
- Produces:
  - `ALERT_BUBBLE: string[]` (16 strings of 16 chars: `.` clear, `o` outline, `w` white, `x` mark) and `drawAlertBubble(ctx, x, y, scale) => void` in `primitives.js`.
  - `ENCOUNTER_CARD_SIZE = { w: 1200, h: 600 }`.
  - `encounterCardView({ trainer, team, user, displayName }) => { player: { name, trainerFile, team: { id, variant, shiny }[] }, trainer: { title, name, trainerFile, partySize }, heading, line, prize }`, with `heading = "<title> <name> challenged <displayName>!"`. No Levels anywhere in the view.
  - `encounterAltText(v) => string`: `"Youngster Joey challenged Ash! \"<line>\" Win or lose: 260 CC."`
  - `encounterSlots(v) => { player: { cx, floor, box }, trainer: { cx, floor, box }, bubble: { x, y, size }, textBox: { x, y, w, h }, stakes: { x, y, w, h } }`.
  - `renderEncounterCard(v) => Promise<Buffer>` (PNG).

Layout: the challenge card's split field (blue left, `COLOR.red` right) at 1200 × 430, the player's trainer at 4× with their Team grid, the Trainer at 4× on the right with the "!" at 4× (64 px) just above the sprite's opaque top, the class as eyebrow, the name as title, Poké Balls for the party, and the VS on the seam. Below, a games-style text box (light fill, dark border) with the heading at 26 px and the line at 22 px, and a stakes block at its right: "WIN OR LOSE" (18 px) over the amount in gold (30 px).

- [ ] **Step 1: Write the failing test** `tests/encounterCard.test.js`:

```js
section("What the card shows");
assertEqual(v.heading, "Youngster Joey challenged Ash!", "the games' wording");
assertEqual([v.trainer.trainerFile, v.trainer.partySize, v.prize], ["youngster-gen3.png", trainer.party.length, trainer.prize], "sprite, party, prize money");
assertTrue(!JSON.stringify(v).includes('"level"'), "no Levels: disguises hold");
assertEqual(encounterAltText(v), `Youngster Joey challenged Ash! "${trainer.lines.intro}" Win or lose: ${trainer.prize.toLocaleString("en-US")} CC.`, "alt text");
section("Render");
assertEqual(dims(png), [1200, 600], "size");
assertTrue(whiteAt(px, slots.bubble), "the ! sits in its slot");
assertTrue(differing(px, noTrainer, slots.trainer.box) > 1000 && differing(px, noPlayer, slots.player.box) > 1000, "both trainers stand in their boxes");
assertTrue(goldIn(px, slots.stakes), "the amount is gold");
assertTrue(ALERT_BUBBLE.length === 16 && ALERT_BUBBLE.every((r) => r.length === 16 && /^[.owx]+$/.test(r)), "the ! is a 16×16 grid");
// CHALLENGE_CARD_OUT-style env var ENCOUNTER_CARD_OUT writes previews: under, ace, surprise, no trainer/no Team, long names.
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Draw the bubble from the bitmap with smoothing off. Run `tests/challengeCard.test.js` after the extraction.
- [ ] **Step 4: Run both** — Expected: PASS. Write previews to `docs/design/previews/encounter-card-*.png` with `ENCOUNTER_CARD_OUT=docs/design/previews` and look at them.
- [ ] **Step 5: Commit** — `git add utils/render/encounterCard.js utils/render/primitives.js utils/render/challengeCard.js tests/encounterCard.test.js docs/design/previews/encounter-card-*.png && git commit -m "Render the Trainer encounter card"`

### Task 5: The replay and its result embed

**Files:**
- Modify: `utils/battle/playback.js`
- Test: `tests/encounterFlow.test.js` (section "Playback"; the file grows in Task 6)

**Interfaces:**
- Consumes: Task 3's outcome shape.
- Produces:
  - `encounterNames(outcome, playerName) => { [userId]: playerName, trainer: "<title> <name>" }`.
  - `buildEncounterEmbed(outcome, names) => EmbedBuilder`: line 1 `💬 <trainer>: "<lost or won line>"`; line 2 `💰 <player> got <n> CC for winning!` or `<player> whited out!` (never an amount on a loss).
  - `playEncounter(channel, outcome, names, { maxUpdates, delayMs, queue = replays, trainers }) => Promise<Message|null>`: heading `⚔️ <@id> vs <trainer>!`, `waitForSlot` then `replayFight` with `theme: null`, `award: null`, the embed as `finalEmbed`; releases the slot in `finally`; a failed first post throws.

- [ ] **Step 1: Write the failing test** (section "Playback" in `tests/encounterFlow.test.js`): with a stub channel and `PLAYBACK.delayMs = 0`, a won outcome posts one message whose final edit carries the embed with `"💰 Ash got 260 CC for winning!"`; a lost one carries `"Ash whited out!"` and no digits on that line; the replay waits on a full queue (`createQueue(1)` held) and runs once it's released.
- [ ] **Step 2: Run it** — Expected: FAIL (`playEncounter` is not exported).
- [ ] **Step 3: Implement** in `playback.js` next to `playBattle`; update the header comment.
- [ ] **Step 4: Run it, and `tests/challengePlayback.test.js`** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add utils/battle/playback.js tests/encounterFlow.test.js && git commit -m "Replay Trainer encounters with the Trainer's after-battle line"`

### Task 6: The Discord flow

**Files:**
- Create: `utils/encounter/service.js`
- Test: `tests/encounterFlow.test.js`

**Interfaces:**
- Consumes: Tasks 1–5; `renderExpCard`, `expMembers` (`utils/render/expCard.js`); `logEvent` (`utils/eventLog.js`); `PLAYBACK` (`utils/battle/tuning.js`).
- Produces:
  - `isEncounterButton(customId) => boolean` (prefix `encounter:`); custom IDs `encounter:<nonce>:battle` and `encounter:<nonce>:run`.
  - `createEncounterService({ getTrainerData, lockUser, enqueueSave, random = Math.random, now = () => new Date(), seed = () => randomInt(2 ** 31), setTimer = setTimeout, clearTimer = clearTimeout, render = renderEncounterCard, renderExp = renderExpCard, play = playEncounter, log = logEvent }) => { maybeSpot(message): Promise<void>, handleButton(interaction): Promise<void>, openCount(): number }`.

Behavior:
- `maybeSpot(message)`: return unless the bot has ViewChannel, SendMessages, AttachFiles and EmbedLinks in `message.channel` (`permissionsFor(message.guild.members.me)`; a null member returns). Then `random() < ENCOUNTER.chance`, else return. Under `lockUser`: `spotBlock` with `open` from the map; on null, snapshot `buildTeam(user)`, `rollTrainer({ team, seed })`, put the entry in the map. Outside the lock: post `{ content: "<@id>", files: [card with alt text], components: [Battle!, Run] }` (embed fallback when `render` throws). Posted: under the lock `recordSpot`, `enqueueSave`, log `spotted`, start the `answerMs` timer. Not posted: drop the entry.
- `handleButton(i)`: no entry for the nonce: `i.update({ content: STALE_LINE, embeds: [], attachments: [], components: [] })`. Someone else: ephemeral "This Trainer has their eye on <name>." Run: drop entry and timer, shrink to a filled `RAN` line, log `answered: run`. Timeout: shrink to a filled `LOST_INTEREST` line, log `answered: timeout`. Battle!: under the lock run `fightEncounter`; a refusal replies ephemerally and keeps the entry; otherwise drop the entry and timer, `enqueueSave`, `i.update({ components: [] })`, log `answered: battle` and `result`, `play(...)` the replay, then `i.followUp` the ephemeral EXP message captioned "You got <n> CC for winning." or "You paid <trainer> <paid> CC." (text fallback when the card can't render).
- The entry is removed from the map before any await that could let a second click or the timer in, so each encounter settles once.

- [ ] **Step 1: Write the failing tests** (stub `message`, `channel`, `interaction` objects as in `tests/challengeCommand.test.js`): "no permission, no roll" (random never called, count unchanged); "a miss posts nothing"; "a hit posts the card" (mention, file `encounter.png` with alt text, two buttons, count 1, `lastAt` set, one save); "a failed post uses nothing up"; "one card for simultaneous hits"; "someone else's click"; "Run shrinks the card"; "no answer in 2 minutes" (fake timer); "Battle! plays it out" (buttons removed, replay posted, CC moved by the prize, ephemeral follow-up with the EXP card); "one outcome per encounter" (double click, and click racing the timer); "a refused Battle! keeps it open"; "a stale click after a restart" (a fresh service); "embed fallback keeps the buttons"; "the event log" (spotted, answered, result).
- [ ] **Step 2: Run** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `service.js`.**
- [ ] **Step 4: Run `tests/encounterFlow.test.js`** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add utils/encounter/service.js tests/encounterFlow.test.js && git commit -m "Post Trainer encounters and answer their buttons"`

### Task 7: Wiring into chat and the button handler

**Files:**
- Modify: `utils/passiveChat.js`, `bot_final.js`
- Test: `tests/startupReadiness.test.js`

**Interfaces:**
- Consumes: Task 6's `createEncounterService`, `isEncounterButton`.
- Produces: `createMessageHandler({ ..., spot })`: after `giveRandomReward` resolves to `"missed"`, calls `spot(message)` (errors logged, never thrown). `tryGiveRandomReward` resolves to `"cooldown"`, `"missed"`, or `"caught"`.

- [ ] **Step 1: Write the failing test** in `tests/startupReadiness.test.js`, section "Trainer encounters roll only after a miss": `spot` is called once for a `"missed"` reward, never for `"caught"` or `"cooldown"`, and never before the bot is ready.
- [ ] **Step 2: Run it** — Expected: FAIL (`spot` never called).
- [ ] **Step 3: Implement.** In `bot_final.js`: return the three results from `tryGiveRandomReward`; build the service once with `getTrainerData: () => trainerData`, `lockUser`, `enqueueSave`; pass `spot: (m) => encounters.maybeSpot(m)`; in `interactionCreate`, route `isEncounterButton(id)` to `encounters.handleButton(interaction)` before the no-op check, after the `isReady` gate (not ready: the same "starting up" ephemeral reply slash commands get).
- [ ] **Step 4: Run it and `npm run test:safe`** — Expected: PASS, whole suite green.
- [ ] **Step 5: Commit** — `git add utils/passiveChat.js bot_final.js tests/startupReadiness.test.js && git commit -m "Roll Trainer encounters from chat and route their buttons"`

### Task 8: Balance and pace measurements

**Files:**
- Create: `tests/encounterBalance.test.js`
- Modify: the spec's Open checks become a Measured section with the printed numbers and the command.

**Interfaces:**
- Consumes: Task 2's `rollTrainer`, Task 3's fight (through `simulateBattle` directly on stand-in Teams, like `tests/challengeBalance.test.js`), `teamExp`, `levelForExp`, `expForLevel`.

- [ ] **Step 1: Write the test.** Stand-in Teams as in `challengeBalance.test.js` (fully evolved, non-legendary, one Level). Print win rate per tier at average Lv 10, 30, 60 and 90 for Team sizes 1 to 6 (200 each), and for a Lv 100 Pokémon carrying five Lv 5 Pokémon. Assert only the order Under ≥ Even ≥ Over at every size and Level. Print expected net CC per day at 8 encounters (win rate × prize − loss rate × prize, by tier share) for each average Level, and days from the gate Level to Lv 100 with 8 encounters added to the pace scenario in `challengeBalance.test.js`.
- [ ] **Step 2: Run it** — Expected: PASS; numbers printed.
- [ ] **Step 3: Write the numbers into the spec** under "Measured (stand-in Teams, 200 per case)", each with the command.
- [ ] **Step 4: Commit** — `git add tests/encounterBalance.test.js docs/superpowers/specs/2026-11-10-trainer-encounters-design.md && git commit -m "Measure Trainer encounter win rates, CC and leveling pace"`

### Task 9: Docs

**Files:**
- Modify: `README.md` (feature, project structure, tests), `docs/design/COMMAND-CARDS.md` (the encounter card), and grep root docs for stale entries (`tryGiveRandomReward`, `passiveChat`, button prefixes).

- [ ] **Step 1: Re-read the README's feature, structure and test sections; add Trainer encounters, the new files, and the new tests.**
- [ ] **Step 2: Add the encounter card to `COMMAND-CARDS.md` with the previews from Task 4.**
- [ ] **Step 3: Run `npm run test:safe`** — Expected: PASS.
- [ ] **Step 4: Commit** — `git add README.md docs/design/COMMAND-CARDS.md && git commit -m "Document Trainer encounters"`

### After the tasks (not committed to feat/challenges)

- Restack `local/test-challenges` onto the new tip and add to its TEMP commit: `ENCOUNTER.chance: 1`, `gapMs: 0`, `perDay: 1000`, each marked `// TEMP local testing, do not commit`. Restart the test bot loop.
- Show the user the lines, names, class list and "!" preview before anything ships.
