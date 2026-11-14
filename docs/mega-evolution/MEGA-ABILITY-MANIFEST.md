# Mega Evolution: ability implementation manifest (Phase M0)

> **Full sim.** With `FULL_SIM_ENABLED` on, Mega abilities run on Pokémon Showdown's engine, and its behavior is the rule. Six differ from `utils/battle/abilities.js`: Sheer Force also removes secondary effects, Berserk ignores multi-hit moves, Intimidate is blocked by more abilities (Clear Body, Oblivious, Own Tempo, Guard Dog, Mirror Armor and others), Trace copies a random foe's ability with Showdown's ban list, and Protean and Speed Boost re-arm and skip the switch-in turn now that Pokémon switch. The 13 no-effect abilities (Prankster, Magic Bounce, Regenerator and the rest) take effect. See `docs/superpowers/specs/2026-11-12-full-sim-design.md`.
>
> **Superseded in Phase M2.** Abilities are now implemented in `utils/battle/abilities.js` (57 implemented, 13 no-effect). The current per-ability coverage table is in `M2-IMPLEMENTATION-REPORT.md` §6; the classification changed for Trace (now has an effect) and Inner Focus (blocks Intimidate). The text below is the M0 plan.

Generated from `data/pokedex/mega-abilities.json` (authoritative; built by `tools/generate-megas.mjs` from `tools/lib/megaRules.mjs`). **No ability is implemented in M0.** Per D-5, Mega gameplay cannot launch until every battle-relevant ability (categories 2 and 3) is implemented and tested.

## Reconciliation with the code

- `utils/battle/sim.js` (master 5157cfe6) models no abilities. Its only ability-like rule is Shedinja's Wonder Guard, hard-coded by species id (`SHEDINJA = 292`). Wonder Guard is not a Mega ability, so **category 1 has 0 entries**.
- Battlers have no ability field, no stat stages, no status, no weather or terrain, no switch-in or end-of-turn phase, no protection, and no voluntary switching. Movesets hold only damaging moves (`tools/generate-battle-data.mjs` drops status moves).
- `battleData.json` moves carry only name, type, category, power, accuracy, critRatio, priority, drain, recoil, crash, multihit, multiaccuracy and risingPower. **No move flags.** Eight abilities need flags added: contact, punch, bite, pulse, slicing, bullet, plus a secondary-effect marker.
- The 69 abilities cover every listed slot. 67 are primary (slot 0, D-11). Flame Body (Mega Heatran) and Storm Drain (Mega Tatsugiri) are alternate slots, kept in the manifest for completeness.
- Abilities of Legends: Z-A Megas are Showdown "Future" data. Legends: Z-A has no ability mechanics, so they are recorded as **unverified** on each form (`abilityVerification`).

| Category | Abilities |
|---|---:|
| Already supported by the engine | 0 |
| Implementable in the current engine | 34 |
| Needs a new battle system | 20 |
| No effect in the current battle format | 15 |
| **Total** | **69** |

## 1. Already supported by the engine (0)

None.

## 2. Implementable in the current engine (34)

| Ability | Megas | Rule in the Coop engine | Needs |
|---|---|---|---|
| Adaptability | Mega Beedrill, Mega Lucario, Mega Glimmora | STAB multiplier 2 instead of 1.5. | — |
| Aerilate | Mega Pinsir, Mega Salamence | Normal-type moves become Flying-type and get ×1.2 power. | — |
| Aura Break | Mega Zygarde | Reverses Fairy Aura/Dark Aura (only matters against Mega Floette, which is blocked). | — |
| Aura Guard | Mega Lucario Z | Contact damage taken ×0.5 (Showdown, Future). | move flag: contact |
| Bulletproof | Mega Chesnaught | Immune to ball and bomb moves. | move flag: bullet |
| Dragonize | Mega Feraligatr | Normal-type moves become Dragon-type and get ×1.2 power (Showdown, Future). | — |
| Fairy Aura | Mega Floette | Fairy-type moves of both battlers ×4/3. | — |
| Filter | Mega Aggron | Super-effective damage taken ×0.75. | — |
| Fire Mane | Mega Pyroar | Attacking stat ×1.5 for Fire-type moves (Showdown, Future). | — |
| Flash Fire | Mega Heatran | Fire immunity; after absorbing one, own Fire moves ×1.5 (per-battler flag, no stat stages). | — |
| Huge Power | Mega Starmie, Mega Mawile | Attack ×2. | — |
| Innards Out | Mega Victreebel | When KO'd by a move, the attacker loses HP equal to the damage taken. | — |
| Iron Fist | Mega Crabominable | Punching moves ×1.2. | move flag: punch |
| Levitate | Mega Chimecho, Mega Latias, Mega Latios, Mega Garchomp Z, Mega Delphox | Immune to Ground-type moves. | — |
| Mega Launcher | Mega Blastoise | Pulse moves ×1.5. | move flag: pulse |
| Mega Sol | Mega Meganium | Own moves act as in harsh sunlight: Fire ×1.5, Water ×0.5 (Showdown, Future). | — |
| Mold Breaker | Mega Gyarados, Mega Ampharos, Mega Emboar | Ignores the target's ability (only relevant against another battler with an ability). | — |
| Multiscale | Mega Dragonite | Damage taken ×0.5 while at full HP. | — |
| No Guard | Mega Pidgeot, Mega Raichu Y, Mega Hawlucha | Every move used by or against this battler hits. | — |
| Parental Bond | Mega Kangaskhan | Single-hit damaging moves hit a second time at ×0.25. | — |
| Pixilate | Mega Gardevoir, Mega Altaria | Normal-type moves become Fairy-type and get ×1.2 power. | — |
| Protean | Mega Greninja | Before attacking, its type becomes the move's type (always STAB; defensive type changes). | mutable battler types |
| Pure Power | Mega Medicham | Attack ×2. | — |
| Refrigerate | Mega Glalie | Normal-type moves become Ice-type and get ×1.2 power. | — |
| Scrappy | Mega Lopunny | Normal- and Fighting-type moves hit Ghost-types. | — |
| Sharpness | Mega Absol Z | Slicing moves ×1.5. | move flag: slicing |
| Sheer Force | Mega Camerupt | Moves with secondary effects ×1.3 (secondary effects are not simulated anyway). | move flag: secondary |
| Shell Armor | Mega Slowbro, Mega Scolipede | Can't be hit by critical hits. | — |
| Skill Link | Mega Heracross | Multi-hit moves always hit the maximum number of times. | — |
| Strong Jaw | Mega Sharpedo | Biting moves ×1.5. | move flag: bite |
| Technician | Mega Scizor | Moves with power ≤ 60 get ×1.5. | — |
| Thick Fat | Mega Venusaur | Fire- and Ice-type damage taken ×0.5. | — |
| Tough Claws | Mega Charizard X, Mega Aerodactyl, Mega Metagross, Mega Barbaracle, Mega Golisopod | Contact moves ×1.3. | move flag: contact |
| Volt Absorb | Mega Zeraora | Electric immunity; heals 1/4 max HP when hit by an Electric move. | — |

## 3. Needs a new battle system (20)

| Ability | Megas | Rule in the Coop engine | Needs |
|---|---|---|---|
| Berserk | Mega Drampa | +1 Sp. Atk when an attack drops it below half HP. | stat stages |
| Contrary | Mega Staraptor, Mega Malamar | Stat changes are inverted (only matters once moves or abilities change stats). | stat stages |
| Defiant | Mega Falinks | +2 Attack when an opponent lowers its stats (e.g. Intimidate). | stat stages; switch-in effects |
| Delta Stream | Mega Rayquaza | Sets strong winds (removes Flying weaknesses). | weather; switch-in effects |
| Drought | Mega Charizard Y | Sets harsh sunlight on entry. | weather; switch-in effects |
| Eelevate | Mega Eelektross | Ground immunity, plus +1 to its highest stat after a KO (Showdown, Future). | stat stages |
| Electric Surge | Mega Raichu X | Sets Electric Terrain on entry. | terrain; switch-in effects |
| Flame Body | Mega Heatran (alternate slot) | 30% chance to burn an attacker on contact. | status: burn |
| Intimidate | Mega Manectric, Mega Scrafty | On entry, lowers the opponent's Attack by 1. | stat stages; switch-in effects |
| Lightning Rod | Mega Sceptile | Electric immunity, plus +1 Sp. Atk when hit by one. | stat stages |
| Sand Force | Mega Steelix, Mega Garchomp | Rock/Ground/Steel moves ×1.3 in a sandstorm; immune to sand damage. | weather |
| Sand Stream | Mega Tyranitar | Sets a sandstorm on entry. | weather; switch-in effects; end-of-turn effects |
| Snow Warning | Mega Abomasnow, Mega Froslass | Sets snow on entry. | weather; switch-in effects |
| Solar Power | Mega Houndoom | Sp. Atk ×1.5 in sun, loses 1/8 HP each turn. | weather; end-of-turn effects |
| Soul-Heart | Mega Magearna, Mega Magearna (Original Color) | +1 Sp. Atk whenever any battler faints. | stat stages |
| Speed Boost | Mega Blaziken | +1 Speed at the end of each turn. | stat stages; end-of-turn effects |
| Spicy Spray | Mega Scovillain | Burns any attacker that hits it (Showdown, Future). | status: burn |
| Storm Drain | Mega Tatsugiri (Curly) (alternate slot), Mega Tatsugiri (Droopy) (alternate slot), Mega Tatsugiri (Stretchy) (alternate slot) | Water immunity, plus +1 Sp. Atk when hit by one. | stat stages |
| Swift Swim | Mega Swampert | Speed ×2 in rain. | weather |
| Thermal Exchange | Mega Baxcalibur | +1 Attack when hit by a Fire move; can't be burned. | stat stages; status: burn |

## 4. No effect in the current battle format (15)

| Ability | Megas | Rule in the Coop engine | Needs |
|---|---|---|---|
| Bad Dreams | Mega Darkrai | Damages sleeping foes; status is not simulated. | — |
| Commander | Mega Tatsugiri (Curly), Mega Tatsugiri (Droopy), Mega Tatsugiri (Stretchy) | Doubles-only interaction with Dondozo. | — |
| Healer | Mega Audino | Cures an ally's status in doubles; no doubles or status. | — |
| Infiltrator | Mega Chandelure | Ignores screens and substitutes; none are simulated. | — |
| Inner Focus | Mega Gallade | Prevents flinching and Intimidate; neither is simulated (becomes relevant if Intimidate is built). | — |
| Insomnia | Mega Mewtwo Y | Prevents sleep; status is not simulated. | — |
| Magic Bounce | Mega Clefable, Mega Sableye, Mega Absol, Mega Diancie | Reflects status moves; movesets contain only damaging moves. | — |
| Piercing Drill | Mega Excadrill | Hits through protection; no protecting moves are simulated. | — |
| Prankster | Mega Banette | Priority for status moves; movesets contain only damaging moves. | — |
| Regenerator | Mega Dragalge | Heals on switching out; there is no voluntary switching. | — |
| Shadow Tag | Mega Gengar | Prevents switching; there is no voluntary switching. | — |
| Stalwart | Mega Skarmory | Ignores redirection; singles battles have none. | — |
| Steadfast | Mega Mewtwo X | Speed up on flinch; flinching is not simulated. | — |
| Trace | Mega Alakazam, Mega Meowstic (Female), Mega Meowstic (Male) | Copies the opponent's ability; base battlers have no abilities (relevant only against another Mega). | — |
| Unseen Fist | Mega Golurk | Ignores protection; no protecting moves are simulated. | — |

## Engine work required (categories 2 and 3)

| System | Specification | Abilities that need it |
|---|---|---|
| stat stages | Per-battler stages −6…+6 for atk/def/spa/spd/spe with multipliers (2+n)/2 and 2/(2−n), applied in computeStats-derived values at damage and turn-order time; reset when the battler faints. | Berserk, Contrary, Defiant, Eelevate, Intimidate, Lightning Rod, Soul-Heart, Speed Boost, Storm Drain, Thermal Exchange |
| switch-in effects | A hook when a battler enters (battle start and after a faint), ordered by Speed, logged for playback. | Defiant, Delta Stream, Drought, Electric Surge, Intimidate, Sand Stream, Snow Warning |
| end-of-turn effects | A phase after both moves resolve each turn (weather damage, Speed Boost, Solar Power), with KO handling and logging. | Sand Stream, Solar Power, Speed Boost |
| weather | A battle-wide field (sun, rain, sand, snow, strong winds) with a duration (5 turns for abilities as of Gen 6+; strong winds until the setter leaves), damage modifiers, sand chip damage and immunities. | Delta Stream, Drought, Sand Force, Sand Stream, Snow Warning, Solar Power, Swift Swim |
| terrain | A battle-wide terrain field (Electric Terrain: grounded Electric moves ×1.3, 5 turns). | Electric Surge |
| status: burn | A non-volatile status on the battler: burn halves physical damage dealt and deals 1/16 max HP at end of turn; Fire-types are immune. | Flame Body, Spicy Spray, Thermal Exchange |
| mutable battler types | Battler types become per-battle state (already a field on the battler; must stay out of the species data). | Protean |
| move flags | Add `flags` (contact, punch, bite, pulse, slicing, bullet) and `secondary: true` to each move in `battleData.json` from `@pkmn/dex` move data (additive; existing battles ignore them). | Aura Guard, Bulletproof, Iron Fist, Mega Launcher, Sharpness, Sheer Force, Strong Jaw, Tough Claws |
| ability hooks | `utils/battle/abilities.js`: modifyAttackStat, modifyDefenseStat, modifyMovePower, modifyMoveType, typeImmunity, onDamaged, onKO, critImmune, accuracyOverride, stabMultiplier; null ability = all no-ops so non-Mega battles stay byte-identical (seeded golden test) | all of categories 2 and 3 |

Each implemented ability needs a unit test against a hand-computed damage, immunity or KO outcome before its `implemented` flag becomes true.
