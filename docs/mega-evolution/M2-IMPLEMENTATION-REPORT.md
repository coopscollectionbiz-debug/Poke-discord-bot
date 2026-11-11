# Mega Evolution: Phase M2 implementation report (battle engine)

| | |
|---|---|
| Branch | `feature/mega-evolution-m2` (local only; not pushed, no PR) |
| Worktree | `E:\Poke-discord-bot-mega-m2` |
| Based on | M1 `880ba6c8` (→ M0 `b685c88a` → audit `f56631c3` → production `5157cfe6`) |
| Commits | `08814e96` engine, abilities and tests · `2c0d3792` dashboard dialog fix (from the integration check) · this report |
| Production | Untouched. No push, no deploy, no Fly.io change, no player data, no generation change. Mega battles need `MEGA_EVOLUTION_ENABLED` **and** an explicit `MEGA_BATTLES_ENABLED=1`; neither is set. Rewards stay hard-off. |

## 1. Master drift and integration

`origin/master` moved from `5157cfe6` to `38884217` (not merged into M2):

| PR | What | M2 relevance |
|---|---|---|
| #55 `42f6ec83` | achievements test clock fix | Fixes the only failing test on this branch |
| #52 `9496d296` | battle result embed shows rating only; EXP sent privately (`commands/battle.js`, `utils/battle/playback.js`) | M2 doesn't touch either file; presentation changes went into `render.js` instead |
| #56 `1689357a` | visual/UX overhaul: design system, dashboard foundation (106 files) | Its new test forbids `alert()`/`confirm()` on the Pokémon page. My M1 Mega UI used both → **fixed in `2c0d3792`** (in-page status line and the page's own dialog) |
| #58 | animated compact cards; `utils/battle/power.js` gains `pokemonPower`/`powersFromLevels` | Auto-merges with M2's Mega-aware `teamPower` (reviewed: both kept) |

**Trial merge** (throwaway worktree: M2 + `origin/master` `38884217`, discarded afterwards): no conflicts, **60/60 test files pass, 2,028/2,028 assertions**, including the no-Mega regression gate (0 differences in 3,000 battles on top of master's changes). The Mega dashboard section was checked in a browser inside master's redesigned dashboard: cards, dormant state, team add, the "Only one Mega per team" dialog → Replace. No console errors.

## 2. Battle lifecycle audit (pre-M2 → M2)

| Stage | Pre-M2 engine | M2 |
|---|---|---|
| Team loading/validation | `runBattle.buildTeam`: `normalizeTeam` (id+variant, ≤ 6), owned variants only | + `resolveBattleMega` (fail-closed, §4) |
| Move selection | Automatic: best expected damage (90%) or random (10%); moves = last 4 level-up damaging moves | Same; in Mega battles the expected damage uses the effects pipeline (abilities, weather, stages, immunities) |
| Participant creation | `buildMon`: Gen 5 stat formula, IV 15, no EVs/natures; Shedinja HP 1 | + battle-only profile (Mega stats, types, ability, name) |
| Type effectiveness | Modern 18-type chart | + Scrappy, strong winds, ability immunities (Mega battles) |
| Damage | Gen 5 formula, 80–100% roll, crit 1/12 (1/8 high) ×2, STAB 1.5 | + abilities, stages, weather, terrain, burn (Mega battles) |
| Turn order | Priority → Speed → coin flip | Speed includes stages and Swift Swim (Mega battles) |
| Status | none | burn (Mega battles; caused only by Flame Body / Spicy Spray) |
| Abilities | Shedinja's Wonder Guard hard-coded | Registry; legacy Wonder Guard path unchanged for ordinary battles |
| Weather / terrain | none | sun, rain, sand, snow, strong winds; Electric Terrain (Mega battles) |
| Switching | Next battler only on faint | Unchanged; entry effects run when a battler comes in |
| Result | All fainted, or turn cap 300 (HP fraction) | Unchanged |
| EXP / Elo | `teamExp` from the foe's base-species BST; Elo | Unchanged (base species, D-10) |
| Logging | Per-turn hit events, HP snapshots, knockouts | Mega battles add `preNotes` / `notes` / `endNotes` on events and `turnNotes`; ordinary logs unchanged |
| Player-data writes | Only after the simulation: EXP, Elo, W/L, caps, achievements, pot (plus the pre-existing neutral daily `battle` record created before the sim) | Unchanged; nothing Mega is ever written |

## 3. Architecture

- **Two engines, one entry point.** `simulateBattle` keeps its legacy loop **byte-for-byte**. If any battler has an ability (a Mega), the battle goes to `simulateBattleFx` in `utils/battle/effects.js`. It is the same model (same constants, damage roll, crits, priority, multi-hit, drain, recoil, crash, knockout and turn-cap rules) plus effects. Ordinary battles can't execute new code, which the corpus test proves (§8).
- **Reusable ability registry** (`utils/battle/abilities.js`): one entry per ability with `status` (`implemented` / `no-effect`), `source`, and hooks called at fixed points:
  - `onModifyType`, `onBasePower`, `onModifyAtk`, `onSourceModifyAtk`, `stab`, `onTryHit` (immunities/absorbs)
  - `critImmune`, `noGuard`, `multihit`, `onFinalDamage`, `onDamagingHit`, `onFaintedBy`, `onSourceKO`, `onAnyFaint`
  - `onBeforeMove`, `onEntry`, `onResidual`, `onModifySpe`, `onFoeLoweredStat`
  - flags: `breakable` (Mold Breaker), `noTrace`, `blocksIntimidate`, `invertsBoosts`, `weatherImmune`, `statusImmune`, `aura`/`auraBreak`, `ownWeather`, `grounded`.

  Nothing is species-specific. Adding an ability is one entry; an unknown ability name is ignored safely.
- **Battle state** (`createField`): stat stages −6…+6 (atk–spe 2/(2−n)…(2+n)/2; accuracy/evasion 3/(3−n)…(3+n)/3; crits ignore unfavourable stages). Weather has kind, turns and source, with replacement rules; strong winds can't be replaced and end when the setter faints. Terrain lasts 5 turns. Burn: Fire-types immune, one status at a time, physical damage ×0.5, 1/16 per turn. Notes collect player-facing messages. All of it lives in battle memory only.
- **Phases:**
  - Entry: battle start and each replacement, faster first (ties: challenger side, no random draw).
  - Moves: as before.
  - End of turn: sand chip → ability residuals (Solar Power, Speed Boost) → burn → weather/terrain countdown.
- **Move flags** for abilities (contact, punch, bite, pulse, slicing, bullet, secondary) are generated from `@pkmn/dex` into `data/battle/move-flags.json` (`npm run generate:move-flags`). **`battleData.json` is unchanged.**
- **Rule source:** Pokémon Showdown Gen 9 mechanics (the same source as the type chart and Mega data). Coop's own simplifications stay: no EVs or natures, 80–100% roll, 1/12 crit. Modifiers are applied as plain multipliers (power rounded, stats floored, final damage floored), not Showdown's 4096-based chain. This is documented and covered by exact-value tests.

## 4. Mega participants and gates

- **Capability:** `battle` is now built but **opt-in**. It needs `MEGA_EVOLUTION_ENABLED` plus `MEGA_BATTLES_ENABLED=1`; any other value, or the sub-switch alone, is off. `rewards` can't be enabled by any environment. Tests enable battles only in isolated fixtures (`run-tests.js` strips the flags from test processes).
- **`resolveBattleMega(user)`** (services/megaTeam.js), called by `buildTeam` under the battle lock. It is **fail-closed**: if anything is wrong, *every* slot battles as its base form, so nobody gets an unearned advantage. The battle still happens, and the reason is logged server-side only. It checks, in order:
  1. Mega battles switched on.
  2. Exactly one Mega slot in the stored team.
  3. The form exists and belongs to that species.
  4. The line is owned.
  5. The form is unlocked on that exact normal/shiny line.
  6. `megaBattleEligibility` passes: not blocked, verified profile, ability implemented or explicitly no-effect, sprite present, generation live, `MEGA_FORMS`.
- **The battler:** Mega base stats and types, plus its ability, at the base line's Level. Moves, variant (shiny), `speciesId`, EXP key and ownership stay the base line's. Name "Mega Charizard X" (`baseName` "Charizard"). HP is computed from the profile's base HP. **For all 47 battle-eligible forms that equals the base form's HP.** The three HP exceptions (Chimecho 65→75, Floette 54→74, Zygarde 108→216) are all out of battle (unverified or blocked).
- **Power rating** (underdog surge) uses the Mega's stats. **EXP** uses the base species' BST (`rewards.teamExp` gets `speciesId`), so knocking out a Mega Venusaur pays exactly what Venusaur would.

## 5. Verification and eligibility

| | Forms | Battle |
|---|---:|---|
| X/Y + ORAS, verified profile (official games with abilities; Showdown + PokéAPI agree) | 48 | **47 eligible** (Mega Rayquaza blocked) |
| — of which battle-eligible **today** (Gens 1–5 live) | — | **46** (Mega Diancie waits for Gen 6) |
| Legends: Z-A + Mega Dimension (no abilities in that game; Showdown "Future" data) | 49 records | **Never**, until a verified profile is approved; unlock, cards and sprites stay |
| Blocked: Rayquaza (Dragon Ascent, D-9), Floette, Zygarde (D-16), Magearna Original (D-8) | 4 | Never |

Every form carries `battleProfile { verified, confidence, source }` in `data/pokedex/megas.json`. **Mega Heatran and Mega Tatsugiri** (D-11, slot 0) are Z-A forms, so unverified and kept out of battle. Their abilities (Flash Fire, Commander, plus the alternate slots Flame Body and Storm Drain) are implemented in the engine anyway, so they're ready if a profile is later approved.

## 6. Abilities

- **69** distinct Mega abilities (all slots) plus **Wonder Guard** (Shedinja) = 70 registry entries:
  - **57 implemented** (56 Mega + Wonder Guard), each exercised by `tests/megaAbilities.test.js`;
  - **13 no-effect** in Coop's format, each with an explicit reason and no hooks.
- The M0 manifest classification was reconciled with the code. Trace now has an effect (copying another Mega's ability), and Inner Focus blocks Intimidate. That gives 35 current-engine / 21 new-system / 13 no-effect.
- **Battle-eligible forms use 37 abilities:** 31 implemented and 6 with no effect in this format (Shadow Tag, Steadfast, Insomnia, Magic Bounce, Prankster, Healer).
- The task's examples include abilities **no Mega has**: Drizzle, Moxie, Competitive, Poison Touch, Static and Solid Rock. Per the "don't implement unrelated mechanics" rule they aren't added. The registry takes each as one entry when needed. Magic Bounce is registered but has no effect, since no status moves exist to reflect.
- Showdown agreement is tested: every implemented ability's Mold Breaker `breakable` flag and the Trace exclusions match `@pkmn/dex` (this test caught three missing flags during development).

### Ability coverage

| Ability | Forms using it | Verification | Implemented effect | Test coverage | Remaining limitations | Form battle-eligible |
|---|---|---|---|---|---|---|
| Adaptability | Mega Beedrill, Mega Lucario, Mega Glimmora | verified + unverified forms | ✅ STAB multiplier 2 instead of 1.5. | megaAbilities.test.js (exact damage / state) | — | Beedrill: yes, Lucario: yes, Glimmora: no |
| Aerilate | Mega Pinsir, Mega Salamence | verified (X/Y/ORAS) | ✅ Normal-type moves become Flying-type and get ×1.2 power. | megaAbilities.test.js (exact damage / state) | — | Pinsir: yes, Salamence: yes |
| Aura Break | Mega Zygarde | unverified (Z-A) | ✅ Reverses Fairy Aura/Dark Aura (only matters against Mega Floette, which is blocked). | megaAbilities.test.js (exact damage / state) | — | Zygarde: no |
| Aura Guard | Mega Lucario Z | unverified (Z-A) | ✅ Contact damage taken ×0.5 (Showdown, Future). | megaAbilities.test.js (exact damage / state) | Z-A rule from Showdown 'Future' data | Lucario Z: no |
| Bad Dreams | Mega Darkrai | unverified (Z-A) | ➖ No effect: Damages sleeping foes; no move or ability causes sleep. | megaAbilities.test.js (no-effect, explicit) | — | Darkrai: no |
| Berserk | Mega Drampa | unverified (Z-A) | ✅ +1 Sp. Atk when an attack drops it below half HP. | megaAbilities.test.js (exact damage / state) | — | Drampa: no |
| Bulletproof | Mega Chesnaught | unverified (Z-A) | ✅ Immune to ball and bomb moves. | megaAbilities.test.js (exact damage / state) | — | Chesnaught: no |
| Commander | Mega Tatsugiri (Curly), Mega Tatsugiri (Droopy), Mega Tatsugiri (Stretchy) | unverified (Z-A) | ➖ No effect: Doubles-only interaction with Dondozo. | megaAbilities.test.js (no-effect, explicit) | — | Tatsugiri (Curly): no, Tatsugiri (Droopy): no, Tatsugiri (Stretchy): no |
| Contrary | Mega Staraptor, Mega Malamar | unverified (Z-A) | ✅ Stat changes are inverted (only matters once moves or abilities change stats). | megaAbilities.test.js (exact damage / state) | — | Staraptor: no, Malamar: no |
| Defiant | Mega Falinks | unverified (Z-A) | ✅ +2 Attack when an opponent lowers its stats (e.g. Intimidate). | megaAbilities.test.js (exact damage / state) | — | Falinks: no |
| Delta Stream | Mega Rayquaza | verified (X/Y/ORAS) | ✅ Sets strong winds (removes Flying weaknesses). Only Mega Rayquaza, which stays blocked. | megaAbilities.test.js (exact damage / state) | only Mega Rayquaza (blocked) | Rayquaza: no |
| Dragonize | Mega Feraligatr | unverified (Z-A) | ✅ Normal-type moves become Dragon-type and get ×1.2 power (Showdown, Future). | megaAbilities.test.js (exact damage / state) | Z-A rule from Showdown 'Future' data | Feraligatr: no |
| Drought | Mega Charizard Y | verified (X/Y/ORAS) | ✅ Sets harsh sunlight on entry. | megaAbilities.test.js (exact damage / state) | — | Charizard Y: yes |
| Eelevate | Mega Eelektross | unverified (Z-A) | ✅ Ground immunity, plus +1 to its highest stat after a KO (Showdown, Future). | megaAbilities.test.js (exact damage / state) | Z-A rule from Showdown 'Future' data | Eelektross: no |
| Electric Surge | Mega Raichu X | unverified (Z-A) | ✅ Sets Electric Terrain on entry. | megaAbilities.test.js (exact damage / state) | — | Raichu X: no |
| Fairy Aura | Mega Floette | unverified (Z-A) | ✅ Fairy-type moves of both battlers ×4/3. | megaAbilities.test.js (exact damage / state) | — | Floette: no |
| Filter | Mega Aggron | verified (X/Y/ORAS) | ✅ Super-effective damage taken ×0.75. | megaAbilities.test.js (exact damage / state) | — | Aggron: yes |
| Fire Mane | Mega Pyroar | unverified (Z-A) | ✅ Attacking stat ×1.5 for Fire-type moves (Showdown, Future). | megaAbilities.test.js (exact damage / state) | Z-A rule from Showdown 'Future' data | Pyroar: no |
| Flame Body | Mega Heatran (alt.) | alternate slot only (D-11) | ✅ 30% chance to burn an attacker on contact. | megaAbilities.test.js (exact damage / state) | — | — |
| Flash Fire | Mega Heatran | unverified (Z-A) | ✅ Fire immunity; after absorbing one, own Fire moves ×1.5 (per-battler flag, no stat stages). | megaAbilities.test.js (exact damage / state) | — | Heatran: no |
| Healer | Mega Audino | verified (X/Y/ORAS) | ➖ No effect: Cures an ally in doubles; battles are singles. | megaAbilities.test.js (no-effect, explicit) | — | Audino: yes |
| Huge Power | Mega Starmie, Mega Mawile | verified + unverified forms | ✅ Attack ×2. | megaAbilities.test.js (exact damage / state) | — | Starmie: no, Mawile: yes |
| Infiltrator | Mega Chandelure | unverified (Z-A) | ➖ No effect: Ignores screens and substitutes; none are simulated. | megaAbilities.test.js (no-effect, explicit) | — | Chandelure: no |
| Innards Out | Mega Victreebel | unverified (Z-A) | ✅ When KO'd by a move, the attacker loses HP equal to the damage taken. | megaAbilities.test.js (exact damage / state) | — | Victreebel: no |
| Inner Focus | Mega Gallade | verified (X/Y/ORAS) | ✅ Blocks Intimidate (Gen 8+), implemented with Intimidate in Phase M2. Flinching isn't simulated. | megaAbilities.test.js (exact damage / state) | flinch not simulated | Gallade: yes |
| Insomnia | Mega Mewtwo Y | verified (X/Y/ORAS) | ➖ No effect: Prevents sleep; no move or ability causes sleep. | megaAbilities.test.js (no-effect, explicit) | — | Mewtwo Y: yes |
| Intimidate | Mega Manectric, Mega Scrafty | verified + unverified forms | ✅ On entry, lowers the opponent's Attack by 1. | megaAbilities.test.js (exact damage / state) | — | Manectric: yes, Scrafty: no |
| Iron Fist | Mega Crabominable | unverified (Z-A) | ✅ Punching moves ×1.2. | megaAbilities.test.js (exact damage / state) | — | Crabominable: no |
| Levitate | Mega Chimecho, Mega Latias, Mega Latios, Mega Garchomp Z, Mega Delphox | verified + unverified forms | ✅ Immune to Ground-type moves. | megaAbilities.test.js (exact damage / state) | — | Chimecho: no, Latias: yes, Latios: yes, Garchomp Z: no, Delphox: no |
| Lightning Rod | Mega Sceptile | verified (X/Y/ORAS) | ✅ Electric immunity, plus +1 Sp. Atk when hit by one. | megaAbilities.test.js (exact damage / state) | — | Sceptile: yes |
| Magic Bounce | Mega Clefable, Mega Sableye, Mega Absol, Mega Diancie | verified + unverified forms | ➖ No effect: Reflects status moves; movesets hold only damaging moves. | megaAbilities.test.js (no-effect, explicit) | — | Clefable: no, Sableye: yes, Absol: yes, Diancie: yes once its gen is live |
| Mega Launcher | Mega Blastoise | verified (X/Y/ORAS) | ✅ Pulse moves ×1.5. | megaAbilities.test.js (exact damage / state) | — | Blastoise: yes |
| Mega Sol | Mega Meganium | unverified (Z-A) | ✅ Own moves act as in harsh sunlight: Fire ×1.5, Water ×0.5 (Showdown, Future). | megaAbilities.test.js (exact damage / state) | Z-A rule from Showdown 'Future' data | Meganium: no |
| Mold Breaker | Mega Gyarados, Mega Ampharos, Mega Emboar | verified + unverified forms | ✅ Ignores the target's ability (only relevant against another battler with an ability). | megaAbilities.test.js (exact damage / state) | matters only against another Mega | Gyarados: yes, Ampharos: yes, Emboar: no |
| Multiscale | Mega Dragonite | unverified (Z-A) | ✅ Damage taken ×0.5 while at full HP. | megaAbilities.test.js (exact damage / state) | — | Dragonite: no |
| No Guard | Mega Pidgeot, Mega Raichu Y, Mega Hawlucha | verified + unverified forms | ✅ Every move used by or against this battler hits. | megaAbilities.test.js (exact damage / state) | — | Pidgeot: yes, Raichu Y: no, Hawlucha: no |
| Parental Bond | Mega Kangaskhan | verified (X/Y/ORAS) | ✅ Single-hit damaging moves hit a second time at ×0.25. | megaAbilities.test.js (exact damage / state) | — | Kangaskhan: yes |
| Piercing Drill | Mega Excadrill | unverified (Z-A) | ➖ No effect: Hits through protection; no protecting moves are simulated. | megaAbilities.test.js (no-effect, explicit) | — | Excadrill: no |
| Pixilate | Mega Gardevoir, Mega Altaria | verified (X/Y/ORAS) | ✅ Normal-type moves become Fairy-type and get ×1.2 power. | megaAbilities.test.js (exact damage / state) | — | Gardevoir: yes, Altaria: yes |
| Prankster | Mega Banette | verified (X/Y/ORAS) | ➖ No effect: Priority for status moves; movesets hold only damaging moves. | megaAbilities.test.js (no-effect, explicit) | — | Banette: yes |
| Protean | Mega Greninja | unverified (Z-A) | ✅ Before attacking, its type becomes the move's type (always STAB; defensive type changes). Gen 9: once per entry. | megaAbilities.test.js (exact damage / state) | — | Greninja: no |
| Pure Power | Mega Medicham | verified (X/Y/ORAS) | ✅ Attack ×2. | megaAbilities.test.js (exact damage / state) | — | Medicham: yes |
| Refrigerate | Mega Glalie | verified (X/Y/ORAS) | ✅ Normal-type moves become Ice-type and get ×1.2 power. | megaAbilities.test.js (exact damage / state) | — | Glalie: yes |
| Regenerator | Mega Dragalge | unverified (Z-A) | ➖ No effect: Heals on switching out; battlers only leave by fainting. | megaAbilities.test.js (no-effect, explicit) | — | Dragalge: no |
| Sand Force | Mega Steelix, Mega Garchomp | verified (X/Y/ORAS) | ✅ Rock/Ground/Steel moves ×1.3 in a sandstorm; immune to sand damage. | megaAbilities.test.js (exact damage / state) | — | Steelix: yes, Garchomp: yes |
| Sand Stream | Mega Tyranitar | verified (X/Y/ORAS) | ✅ Sets a sandstorm on entry. | megaAbilities.test.js (exact damage / state) | — | Tyranitar: yes |
| Scrappy | Mega Lopunny | verified (X/Y/ORAS) | ✅ Normal- and Fighting-type moves hit Ghost-types. | megaAbilities.test.js (exact damage / state) | — | Lopunny: yes |
| Shadow Tag | Mega Gengar | verified (X/Y/ORAS) | ➖ No effect: Prevents switching; there is no voluntary switching. | megaAbilities.test.js (no-effect, explicit) | — | Gengar: yes |
| Sharpness | Mega Absol Z | unverified (Z-A) | ✅ Slicing moves ×1.5. | megaAbilities.test.js (exact damage / state) | — | Absol Z: no |
| Sheer Force | Mega Camerupt | verified (X/Y/ORAS) | ✅ Moves with secondary effects ×1.3 (secondary effects are not simulated anyway). Secondary effects aren't simulated, so only the 1.3× power applies. | megaAbilities.test.js (exact damage / state) | secondary effects not simulated | Camerupt: yes |
| Shell Armor | Mega Slowbro, Mega Scolipede | verified + unverified forms | ✅ Can't be hit by critical hits. | megaAbilities.test.js (exact damage / state) | — | Slowbro: yes, Scolipede: no |
| Skill Link | Mega Heracross | verified (X/Y/ORAS) | ✅ Multi-hit moves always hit the maximum number of times. | megaAbilities.test.js (exact damage / state) | — | Heracross: yes |
| Snow Warning | Mega Abomasnow, Mega Froslass | verified + unverified forms | ✅ Sets snow on entry. Gen 9: snow (Ice-types' Defense ×1.5; no chip damage). | megaAbilities.test.js (exact damage / state) | — | Abomasnow: yes, Froslass: no |
| Solar Power | Mega Houndoom | verified (X/Y/ORAS) | ✅ Sp. Atk ×1.5 in sun, loses 1/8 HP each turn. | megaAbilities.test.js (exact damage / state) | — | Houndoom: yes |
| Soul-Heart | Mega Magearna, Mega Magearna (Original Color) | unverified (Z-A) | ✅ +1 Sp. Atk whenever any battler faints. | megaAbilities.test.js (exact damage / state) | — | Magearna: no, Magearna (Original Color): no |
| Speed Boost | Mega Blaziken | verified (X/Y/ORAS) | ✅ +1 Speed at the end of each turn. Activates at the end of every turn: battlers only enter at the start of a turn in Coop (no mid-turn switching), which matches Showdown's 'first full turn' rule. | megaAbilities.test.js (exact damage / state) | — | Blaziken: yes |
| Spicy Spray | Mega Scovillain | unverified (Z-A) | ✅ Burns any attacker that hits it (Showdown, Future). | megaAbilities.test.js (exact damage / state) | Z-A rule from Showdown 'Future' data | Scovillain: no |
| Stalwart | Mega Skarmory | unverified (Z-A) | ➖ No effect: Ignores redirection; singles battles have none. | megaAbilities.test.js (no-effect, explicit) | — | Skarmory: no |
| Steadfast | Mega Mewtwo X | verified (X/Y/ORAS) | ➖ No effect: Speed up on flinch; flinching isn't simulated. | megaAbilities.test.js (no-effect, explicit) | — | Mewtwo X: yes |
| Storm Drain | Mega Tatsugiri (Curly) (alt.), Mega Tatsugiri (Droopy) (alt.), Mega Tatsugiri (Stretchy) (alt.) | alternate slot only (D-11) | ✅ Water immunity, plus +1 Sp. Atk when hit by one. | megaAbilities.test.js (exact damage / state) | — | — |
| Strong Jaw | Mega Sharpedo | verified (X/Y/ORAS) | ✅ Biting moves ×1.5. | megaAbilities.test.js (exact damage / state) | — | Sharpedo: yes |
| Swift Swim | Mega Swampert | verified (X/Y/ORAS) | ✅ Speed ×2 in rain. No Mega or Coop battler can set rain yet. | megaAbilities.test.js (exact damage / state) | no rain setter exists | Swampert: yes |
| Technician | Mega Scizor | verified (X/Y/ORAS) | ✅ Moves with power ≤ 60 get ×1.5. | megaAbilities.test.js (exact damage / state) | — | Scizor: yes |
| Thermal Exchange | Mega Baxcalibur | unverified (Z-A) | ✅ +1 Attack when hit by a Fire move; can't be burned. | megaAbilities.test.js (exact damage / state) | — | Baxcalibur: no |
| Thick Fat | Mega Venusaur | verified (X/Y/ORAS) | ✅ Fire- and Ice-type damage taken ×0.5. | megaAbilities.test.js (exact damage / state) | — | Venusaur: yes |
| Tough Claws | Mega Charizard X, Mega Aerodactyl, Mega Metagross, Mega Barbaracle, Mega Golisopod | verified + unverified forms | ✅ Contact moves ×1.3. | megaAbilities.test.js (exact damage / state) | — | Charizard X: yes, Aerodactyl: yes, Metagross: yes, Barbaracle: no, Golisopod: no |
| Trace | Mega Alakazam, Mega Meowstic (Female), Mega Meowstic (Male) | verified + unverified forms | ✅ Copies the opposing battler's ability on entry (Phase M2); ordinary battlers have none, so it only matters against another Mega. | megaAbilities.test.js (exact damage / state) | matters only against another Mega | Alakazam: yes, Meowstic (Female): no, Meowstic (Male): no |
| Unseen Fist | Mega Golurk | unverified (Z-A) | ➖ No effect: Ignores protection; no protecting moves are simulated. | megaAbilities.test.js (no-effect, explicit) | — | Golurk: no |
| Volt Absorb | Mega Zeraora | unverified (Z-A) | ✅ Electric immunity; heals 1/4 max HP when hit by an Electric move. | megaAbilities.test.js (exact damage / state) | — | Zeraora: no |
| Wonder Guard | Shedinja (non-Mega) | n/a (Shedinja, legacy rule) | ✅ Legacy Wonder Guard: only super-effective hits damage the holder. | megaAbilities.test.js (exact damage / state) | — | n/a |

Legend: ✅ implemented and tested · ➖ explicitly no effect in Coop's battle format · "(alt.)" = a non-chosen ability slot (D-11).

## 7. Logging and presentation

- **Battle images** (`utils/battle/render.js`):
  - A Mega uses its own sprite: `mega/normal|shiny/<form>.gif`, and `mega/grayscale/<form>.gif` once fainted. Normal and shiny stay distinct (tested).
  - A purple **MEGA** tag, and the label "Charizard Y" so it fits the tile.
  - Verified by rendering real frames.
- **Text box:** entry, ability, weather, stat and burn messages follow the move line in Showdown's wording ("Mega Charizard Y's Drought: The sunlight turned harsh!", "Mega Manectric's Intimidate: Mega Gallade's Attack fell!", "The harsh sunlight faded."). They are de-duplicated and contain no internal details (tested).
- **Opening screen** (`playback.js`, untouched): the lead's name is already the Mega name ("Mega Charizard Y lead off").
- **Ordinary battles:** text, sprites and sprite keys unchanged (tested).

## 8. No-Mega regression gate (acceptance)

`tools/dev/battle-corpus.mjs` builds 3,000 deterministic battles: random species from all 1,025, including Shedinja and multi-hit, recoil, crash and drain users; random Levels; normal and shiny; open and wager modes; surges; a turn-cap battle; wins for both sides. Each runs through the real `runBattle`. One digest per battle covers:
- winner, turns, end reason;
- the full log, knockouts and HP snapshots;
- surge, power, EXP and Elo;
- both players' post-battle training, battle record, CC, stats and achievements.

The digests were recorded from the **pre-M2 engine (the untouched M1 worktree, `880ba6c8`)** into `tests/fixtures/battle-corpus-pre-m2.json`.

| Run | Differences |
|---|---:|
| M2, Mega switched off (production default) | **0 / 3,000** |
| M2, every Mega switch on, teams without Megas | **0 / 3,000** |
| M2 + current master (trial merge), both runs | **0 / 3,000** |

The existing scripted-RNG battle tests (`battleSim`, `battleBalance`, `runBattle`, `battleRender`, `wager`) also pass unchanged.

## 9. Performance (Fly: 512 MB shared CPU)

`tools/dev/battle-bench.mjs`, 3,000 battles per run, 3 runs each, separate Node processes, `--expose-gc`:

| Engine / battles | ms per battle | battles/s | Peak heap | Heap after GC | Peak RSS |
|---|---:|---:|---:|---:|---:|
| Pre-M2 (M1), ordinary | 0.313–0.320 | ~3,170 | ~41 MB | 13.1 MB | ~104 MB |
| M2, ordinary | 0.317–0.323 | ~3,130 (−1%, noise) | ~41 MB | 13.4 MB (+0.3: registry, flags, profiles) | ~104 MB |
| M2, Mega vs Mega | 0.440–0.448 | ~2,250 | ~45 MB | 15.1 MB | ~109 MB |

A Mega battle costs about 0.13 ms more to simulate, negligible next to rendering the battle images (seconds). There are no persistent battle state, no new writes and no external services.

## 10. Tests

| Suite | Result |
|---|---|
| `tests/megaAbilities.test.js` (new) | 117/117: every implemented ability (coverage-enforced), stages, weather, terrain, burn, entry/residual order, Mold Breaker, Showdown flag agreement, move-flag spot checks |
| `tests/megaBattle.test.js` (new) | 50/50: valid Mega battler (stats/types/ability/Level/HP), 12 fail-closed cases, all 46/47 eligible forms built correctly, type change (Charizard X), EXP/power, shiny/grayscale Mega sprites, text, determinism, 300 random Mega battles, crash mid-battle, restart replay, invalid state, missing sprite, generation independence |
| `tests/megaBattleRegression.test.js` (new) | 4/4: the 3,000-battle corpus, Mega off and fully on |
| Earlier Mega suites (`megaCatalog`, `megaSprites`, `megaPersistence`, `megaSafety`, `megaUnlock`, `megaCardsTeam`) | all pass; the assertions that encoded "battles not built" were rewritten to the M2 rules (opt-in battles; 47/46 eligible; Z-A excluded; the allowlist now includes the battle engine, and EXP/rewards/playback/acquisition code must still never mention Mega) |
| **Full suite on this branch** | **53/54 files**, 1,818/1,819 counted assertions. The one failure is `achievements.test.js` (date pinned to 2026-11-09); it fails identically on M1 and on the pre-#55 master, and **master fixed it in #55** |
| **Full suite on M2 + current master** | **60/60 files, 2,028/2,028 assertions** |
| `validate:megas`, `validate:catalog` | ✅ |

## 11. Known limitations (no architectural blockers)

- **Z-A Megas can't battle** until verified profiles are approved. This is a data decision; the engine already implements their abilities.
- **Mega Rayquaza** needs the Dragon Ascent acquisition rule (D-9); it stays blocked.
- **Abilities with no effect:** Prankster and Magic Bounce need status moves, Shadow Tag and Regenerator need voluntary switching, Insomnia and Bad Dreams need sleep, Steadfast needs flinch. Adding any of those systems is a separate battle-design decision for all Pokémon, and would also give these abilities effects.
- **Simplifications:** Showdown's 4096-based modifier rounding is approximated (consistent and tested). Entry-ability speed ties go to the challenger instead of a coin flip, to keep the random stream unchanged.
- **Ordinary Pokémon still have no abilities.** Giving them abilities would change ordinary battles and needs its own approval (compatibility control: only battlers with an `ability` use the effects engine).
- **`/showteam`, the trainer card and the battle result embed** still show base sprites for a Mega slot. These are owned by the visual overhaul (master) and are M3 integration work.

## 12. Ready for M3

- Rebase/merge onto current master (clean in the trial; keep the `2c0d3792` dialog change).
- Mega display in `/showteam`, the trainer card and the result embed (master's new card renderers).
- Owner decisions: activation of `MEGA_BATTLES_ENABLED`, a verification path for Z-A profiles, Dragon Ascent (Rayquaza), the Discord `/mega` command and inventory category (from M1).
- Rewards and shards stay M4.
