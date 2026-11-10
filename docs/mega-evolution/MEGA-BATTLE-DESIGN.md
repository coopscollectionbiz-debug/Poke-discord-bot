# Mega Evolution: battle design

## 1. How battles work today (audited)

- `/battle` (`commands/battle.js`) calls `runBattle()` (`utils/battle/runBattle.js`) inside `withBothLocks`. It builds both teams from `displayedPokemon` (`buildTeam`), runs `simulateBattle()` (`utils/battle/sim.js`) **synchronously to the end**, applies EXP, Elo and W/L, then saves. `playBattle()` replays the stored log as images afterwards.
- The sim is pure: the same inputs and seed give the same result. Battlers are built fresh by `buildMon()` from `battleData.json` (`getSpecies(speciesId)`) and the Level. Nothing in a battler is ever written to player data.
- Modelled: power, type chart, accuracy, STAB, crits, the damage roll, priority, multi-hit, drain, recoil, crash and the turn cap. Every member auto-picks the best expected-damage move (90%) or a random one (10%). Movesets are the last 4 level-up damaging moves.
- **Not modelled:** abilities (except Shedinja's Wonder Guard), items, status, stat stages, weather, terrain, protection and voluntary switching. Moves carry no flags (contact, punch, bite, pulse, slicing, ball).

There is **no interactive turn system**. Building one would mean restructuring `/battle`, the wager flow, playback, and the cap and lock model. It is not recommended.

## 2. Selection: the Mega team slot (owner direction)

The owner's direction, "Megas are separate Pokémon on the dashboard; only one per team", maps directly onto this engine:

1. On the dashboard team builder, the player can place **one** Mega card in the team: `{ id, variant, mega: "<stableId>" }`.
2. Placing it is the Mega selection. For Charizard, the player chooses the Mega X card or the Mega Y card, not both. Changing it means editing the team, which can't happen mid-battle because the team is read once under lock.
3. The Mega member enters battle **already Mega Evolved** (a "pre-battle Mega Evolution"). The playback's first frame shows the Mega sprite with a "Mega Evolved!" banner.

### Validation (server-side, `/api/set-pokemon-team` and again in `buildTeam`)

| Rule | Where | On violation |
|---|---|---|
| `MEGA_EVOLUTION_ENABLED` is on and the form is activatable | both | team save: refuse with a message. `buildTeam`: battle as the base form, and log it |
| At most **one** slot with `mega` | both | team save: refuse. `buildTeam`: keep the first, drop `mega` from the rest |
| The line is owned (`pokemon[id][variant] > 0`) | both | as for any team slot today (the slot is skipped) |
| The form is unlocked on **that line** (`megaUnlocks[id:variant].forms[stableId]`) | both | refuse / battle as base |
| The form belongs to that species (and to its gender, appearance or colour where relevant) | both | refuse / battle as base |
| The base and its own Mega aren't both on the team (dedupe on `id:variant`) | both | refuse (decision D-2) |
| The generation of the base species is live | `buildTeam` | battle as base |

Because `buildTeam` re-checks everything under the battle lock, a stale dashboard, a flag switched off, or a dormant unlock can never produce an illegal Mega in battle.

## 3. Transformation point and data flow

```
displayedPokemon slot { id: 6, variant: "normal", mega: "mega-charizard-x" }
  └─ buildTeam()  → member { speciesId: 6, variant, level, megaForm: "mega-charizard-x" }   (validated)
      └─ buildMon(member)                                                               (in memory only)
           species  = member.megaForm ? megaBattleSpecies(member.megaForm) : getSpecies(speciesId)
           stats    = computeStats(species.baseStats, level)   ← Mega base stats, same Level, same IV
           types    = species.types                             ← Mega typing
           ability  = species.ability                           ← Mega ability (null for every non-Mega)
           moves    = autoMoveset(speciesId, member.level)      ← base species' moves, unchanged
```

- `megaBattleSpecies()` comes from `utils/megas.js`, generated from Showdown data and checked against PokéAPI.
- Moves, Level, EXP, variant (shiny), ownership and the training key stay the base species'. EXP is credited to `training["6:normal"]`, never to a Mega key.
- **Reversion is automatic:** no Mega state exists outside `simulateBattle()`'s memory. A crash, timeout, deploy, restart or exception mid-battle leaves nothing to revert. A battle that throws before `runBattle` returns applies nothing (existing behaviour).
- Non-Mega Pokémon follow exactly the current code path. `ability` is `null`, and every ability hook is a no-op, so existing battles are byte-for-byte unchanged (seeded regression test).

## 4. HP rule

The games keep the HP *stat* when a Pokémon Mega Evolves. The bot, though, builds HP from base stats at battle start, and three Megas change base HP relative to the bot's stored base:

| Mega | Bot base HP | Mega base HP | Why |
|---|---:|---:|---|
| Chimecho | 65 (Gen 5 data) | 75 | Chimecho's HP rose to 75 in Gen 7; the bot keeps Gen 5 stats for #1–649 |
| Floette | 54 | 74 | Mega comes from Floette-Eternal (74 HP) |
| Zygarde | 108 | 216 | Mega comes from Complete Forme (216 HP) |

**Rule (recommended): the Mega's HP is computed from the Mega's base HP at the start of battle, and the Pokémon starts at full HP.** This is consistent because the Mega Evolution happens before any damage. There is no mid-battle transformation, so no fraction needs converting. Every other Mega has the same HP as its base, so the rule changes nothing for 94 of the 97 rows.

## 5. Damage, turn order and switching

- Stats: Mega base stats through the existing `computeStats` (IV 15, no EVs or natures). Speed, and therefore turn order, uses the Mega's Speed from turn 1. That differs from the games' Gen 6 first-turn rule, but there is no "first turn as base" here.
- STAB and effectiveness use the Mega types (e.g. Charizard X: Fire/Dragon gets Dragon STAB and loses its Rock 4× weakness).
- Switching: the next Pokémon comes in automatically on faint. The Mega stays Mega until it faints. A fainted Mega never reverts mid-battle, and since only one Mega exists per side, no second Mega can appear.
- **Power rating and Surge** (`teamPower`, `rollSurge`): use the Mega's stats. A Mega really is stronger, so the underdog surge should see it.
- **EXP yield** (`rewards.js teamExp`, from the foe's base-species BST): keep the **base species** BST, so Megas don't inflate EXP farming. Proposed; decision D-10.
- **Elo:** unchanged formula.

## 6. Abilities

Nothing is claimed to "work" because its name is in the data. The 69 distinct Mega abilities fall into three classes in this engine:

### A. Simulatable inside the current model (34). Ships with the feature.

| Ability | Megas | Rule in the sim | Needs |
|---|---|---|---|
| Adaptability | Beedrill, Lucario, Glimmora | STAB ×2 | — |
| Aerilate / Pixilate / Refrigerate / Dragonize | Pinsir, Salamence / Gardevoir, Altaria / Glalie / Feraligatr | Normal moves become Flying/Fairy/Ice/Dragon, ×1.2 | — |
| Aura Break | Zygarde | Reverses Fairy Aura/Dark Aura (only matters vs Mega Floette) | — |
| Aura Guard | Lucario Z | Contact damage taken ×0.5 (Z-A rule, Showdown "Future") | contact flag |
| Bulletproof | Chesnaught | Immune to ball/bomb moves | bullet flag |
| Fairy Aura | Floette | Fairy moves ×4/3 (both sides) | — |
| Filter | Aggron | Super-effective damage taken ×0.75 | — |
| Fire Mane | Pyroar | Attacking stat ×1.5 for Fire moves (Z-A rule) | — |
| Flash Fire | Heatran | Fire immunity; after absorbing, own Fire moves ×1.5 | — |
| Huge Power / Pure Power | Starmie, Mawile / Medicham | Atk ×2 | — |
| Innards Out | Victreebel | On being KO'd by a move, the attacker loses HP equal to the damage taken | — |
| Iron Fist | Crabominable | Punch moves ×1.2 | punch flag |
| Levitate | Chimecho, Latias, Latios, Garchomp Z, Delphox | Ground immunity | — |
| Mega Launcher | Blastoise | Pulse moves ×1.5 | pulse flag |
| Mega Sol | Meganium | Own moves as in sun: Fire ×1.5, Water ×0.5 | — |
| Mold Breaker | Gyarados, Ampharos, Emboar | Ignores the target's ability (only relevant vs another Mega) | — |
| Multiscale | Dragonite | Damage taken ×0.5 at full HP | — |
| No Guard | Pidgeot, Raichu Y, Hawlucha | All moves by and against it always hit | — |
| Parental Bond | Kangaskhan | Single-hit moves hit twice; the second hit at ×0.25 | — |
| Protean | Greninja | Becomes the type of the move it uses (STAB always; its defensive type changes) | mutable battler types |
| Scrappy | Lopunny | Normal and Fighting moves hit Ghost | — |
| Sharpness | Absol Z | Slicing moves ×1.5 | slicing flag |
| Sheer Force | Camerupt | Moves with secondary effects ×1.3 (secondaries aren't simulated anyway) | secondary flag |
| Shell Armor | Slowbro, Scolipede | Can't be crit | — |
| Skill Link | Heracross | Multi-hit moves always hit the maximum | — |
| Strong Jaw | Sharpedo | Bite moves ×1.5 | bite flag |
| Technician | Scizor | Moves with power ≤ 60 ×1.5 | — |
| Thick Fat | Venusaur | Fire and Ice damage taken ×0.5 | — |
| Tough Claws | Charizard X, Aerodactyl, Metagross, Barbaracle, Golisopod | Contact moves ×1.3 | contact flag |
| Volt Absorb | Zeraora | Electric immunity; heals 1/4 max HP when hit by one | — |

The move flags are added to `battleData.json` by `tools/generate-battle-data.mjs` from `@pkmn/dex` `flags`. This is an additive field, and existing simulations are unaffected because only abilities read it.

### B. Need a new subsystem (20). Deferred; "Coming later" label.

- **Stat stages:** Speed Boost (Blaziken), Intimidate (Manectric, Scrafty), Contrary (Staraptor, Malamar), Defiant (Falinks), Berserk (Drampa), Soul-Heart (Magearna), Thermal Exchange (Baxcalibur), Eelevate (Eelektross), Lightning Rod (Sceptile), Storm Drain (Tatsugiri).
- **Weather and terrain:** Drought (Charizard Y), Sand Stream (Tyranitar), Snow Warning (Abomasnow, Froslass), Delta Stream (Rayquaza), Electric Surge (Raichu X), Sand Force (Steelix, Garchomp), Solar Power (Houndoom), Swift Swim (Swampert).
- **Status (burn):** Spicy Spray (Scovillain), Flame Body (Heatran, second listed ability).

A stat-stage system (±6 stages, multipliers 2/(2+n)) and a weather field are self-contained additions to `sim.js`. They would be the second implementation phase.

### C. No effect in this battle model (15). Shown honestly as "No effect in Coop battles".

Unseen Fist (Golurk), Piercing Drill (Excadrill), Stalwart (Skarmory), Infiltrator (Chandelure), Regenerator (Dragalge), Insomnia (Mewtwo Y), Inner Focus (Gallade), Steadfast (Mewtwo X), Prankster (Banette), Magic Bounce (Clefable, Sableye, Absol, Diancie), Trace (Alakazam, Meowstic), Shadow Tag (Gengar), Healer (Audino), Commander (Tatsugiri), Bad Dreams (Darkrai).

These Megas still get their stat and type changes. Only the ability is inert, and the UI says so.

### Data caveats

- Z-A and Mega Dimension abilities are marked `isNonstandard: "Future"` in `@pkmn/dex` 0.10.12. Their battle rules come from Showdown's implementation of Legends Z-A / Champions, so treat them as provisional and re-verify when updating `@pkmn`.
- Showdown lists **two** abilities for Mega Heatran (Flash Fire / Flame Body) and Mega Tatsugiri (Commander / Storm Drain). The games pick one by the base Pokémon's ability slot, which the bot doesn't store. Proposed: always use slot 0 (Flash Fire, Commander). Decision D-11.

### Activation timing

Abilities apply from the battler's creation (start of battle, or when it switches in after a faint). Entry abilities (Intimidate, weather) are phase B. Ability hooks: `modifyAttack`, `modifyDefense`, `modifyMovePower`, `modifyMoveType`, `immunity`, `onHit`, `onKO`, `critImmune`, `accuracy`. They live in `utils/battle/abilities.js`, and each is unit-tested against a hand-computed damage value.

## 7. Battle log and display

- The log gains `{ event: "mega", side, slot, form }` before turn 1 and `{ event: "ability", ability, side, slot }` when an ability changes an outcome (immunity, Innards Out, Volt Absorb heal).
- `render.js` (line ~254 resolves the sprite by `speciesId`) uses the form sprite when `member.megaForm` is set, adds a Mega badge on the HP bar, and shows the Mega types.
- The first playback frame says "<Trainer>'s Charizard Mega Evolved into Mega Charizard X!".
- The battle summary embed lists the Mega, and the event log records `megaForm` per side.

## 8. Recovery and interruption

| Situation | Outcome |
|---|---|
| Process dies during `simulateBattle` | Nothing applied, nothing saved. The player's data is unchanged. There is no Mega state to clear. |
| Dies after `runBattle` mutates, before the save is durable | Existing A2 behaviour: the save queue retries. The applied state contains only EXP, Elo and W/L for the base line. |
| Playback fails mid-replay | Display only. The result was already applied. |
| Mega flag switched off between team save and battle | `buildTeam` battles the base form. |
| Unlock removed by an admin between team save and battle | `buildTeam` battles the base form. |

## 9. Feasibility verdict

True turn-based Mega Evolution (choose to Mega Evolve on a turn) **can't** be supported without restructuring the combat flow. The pre-battle Mega team slot keeps the current engine, enforces one Mega per trainer by construction, makes X/Y switching mid-battle impossible, and is crash-safe because the transformation never leaves memory.
