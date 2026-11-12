# Coop's Collection

A Discord-native Pokémon collector game: players catch Pokémon while chatting, manage them on a web dashboard, and pit their teams against each other in automatic battles.

## Language

### Collection

**Tier**:
A species' rarity class: common, uncommon, rare, epic, legendary, or mythic. It measures collectible prestige (scarcity, role in the games, popularity), not battle strength; **Base stat total** only overrides it for large outliers. Mythic means an official Mythical, or a cover legendary with a **Base stat total** of 660 or more.
_Avoid_: rarity (as a separate concept), evolution tier

**Base stat total**:
The sum of a species' six base stats. It is the whole of a Pokémon's battle strength apart from its types and moves.
_Avoid_: power (that is the **Team**'s summed stats at Level), BST in player-facing text

**Stage**:
A species' position in its evolution line — 1 for a base form, 2 and 3 for each evolution after it.
_Avoid_: evolution tier, evolution level, form

**Variant**:
Whether a Pokémon is normal or shiny. Each species + **Variant** pair is counted, collected, leveled, and placed on a **Team** separately.
_Avoid_: form, version, shiny status

**Copy**:
One owned unit of a Pokémon in a specific variant.
_Avoid_: instance, unit

**TM**:
A consumable item that teaches one specific move to one compatible **Copy**, and is used up when it does.
_Avoid_: technical machine (in UI text), move disc

**Trained copy**:
A **Copy** that has learned at least one move from a **TM**. It keeps those moves for good, through evolution and shiny crafting, and is never picked automatically when copies are removed. Every other copy is an untrained copy, and all untrained copies of the same Pokémon and **Variant** are interchangeable.
_Avoid_: custom copy, customized copy, instance, TM copy

**Duplicate**:
Any copy beyond the first of the same Pokémon *and* variant. Pidgey x4 · ✨x2 has 3 normal duplicates and 1 shiny duplicate. One normal plus one shiny of the same Pokémon is not a duplicate.
_Avoid_: extra, spare

**Level**:
A player's strength with one species + **Variant**, from 1 to 100, shared by every copy of it they own.
_Avoid_: instance level, per-Pokémon level

**EXP**:
Progress toward a species + **Variant's** next **Level**.
_Avoid_: XP (TP is already the chat-activity points), experience points

**Catch level**:
The **Level** rolled the first time a player catches a species + **Variant**, set by its **Stage**, with Stage 1 legendaries and mythics rolling high. For Pokémon owned before Levels existed, or after a player's last copy is gone, the next catch counts as the first.
_Avoid_: wild level, spawn level

### Trainer

**Rank**:
A player's title on the TP ladder (Novice Trainer → Legend), earned by chatting.
_Avoid_: using "rank" for battle standing, which is the **Ranked rating**

**Team**:
Up to 6 Pokémon a player sets to fight in slot order, one slot per Pokémon, each slot a specific **Variant**. Each player has two: the **Display team** and the **Battle team**.
_Avoid_: party, lineup

**Display team**:
The **Team** a player shows on their trainer card; it fights **Casual battles**, **Challenges** and **Trainer encounters** at its real Levels.
_Avoid_: displayed Pokémon

**Battle team**:
The **Team** a player sets for **Ranked battles** and **Wager battles**, where every Pokémon fights at Lv 50. It holds at most one mythic-tier Pokémon.

**Tier backdrop**:
The animated background an owned Epic, Legendary or Mythic trainer sprite brings to any card that shows it: the tier's sky colour with rising motes, plus a stepped glow and twinkles from Legendary up, and meteors with one bright hero meteor a loop for Mythic. It replaces the card's own background in that trainer's part of the card (their half of a VS card, their row in a battle), and nothing in it passes behind the trainer or anything else drawn there. Computer-run opponents and unowned sprites never have one.
_Avoid_: aura, glow, trainer background

**Moveset**:
The up to 4 moves a player picks for one Pokémon on one **Team**, from the moves it has learned by its real **Level**. A Pokémon with none picked uses the last four moves it learned.
_Avoid_: move set, loadout

**Region**:
A named set of Pokémon that share a home region: Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, or Paldea. The game's Pokémon data puts every Pokémon in exactly one region, by National Dex number: the Hisui-introduced species #899–905 belong to Galar, and alternate forms (Galarian Meowth, Mega Charizard…) count toward their base species, never as extra Pokémon. Kalos, Alola, Galar and Paldea only appear once their generation is released.
_Avoid_: region group, generation, gen

**Pokédex completion**:
The number of distinct Pokémon a player owns at least one copy of, out of all the Pokémon in a region. It counts what the player owns now. It drops when a player gives up their last copy of a Pokémon, because the game keeps no record of past catches.
_Avoid_: dex count, seen/caught

### Economy

**Donation**:
Permanently giving up a copy in exchange for CC, and sometimes **Shiny Dust**.
_Avoid_: sell, release

**Bag**:
The items a player holds, such as **Evolution Stones**, **Shiny Dust** and Poké Balls.
_Avoid_: backpack, item list

**Evolution Stone**:
The item spent to evolve a Pokémon.
_Avoid_: evo stone, stone (alone, now that **Mega Stones** exist)

**Shiny Dust**:
The item earned by **Donation** and as a **Challenge** prize, and spent on shinies, to convert a normal copy into a shiny one or to evolve a shiny.
_Avoid_: dust (alone), stardust

### Administration

**Last active**:
The last time a player earned TP from chat or used a slash command. Players who have done neither since it started being recorded count from their latest daily, quest, recruit or weekly pack claim.
_Avoid_: last seen, last online, last login

**Admin change**:
A change an admin makes to a player's account from the admin dashboard: adding or removing CC, TP, items, Pokémon or trainers, setting a **Level**, or resetting cooldowns. Every one is recorded permanently with who made it, when, before and after, and why.
_Avoid_: edit, override, admin action (for player-made actions)

**Grant**:
An **Admin change** that only adds to an account or resets cooldowns. Only **Grants** can go to many players at once; removals are made one player at a time.
_Avoid_: gift (that is player-to-player), reward, compensation (as the action's name)

### Battles

**Battle**:
A fight between two players' **Teams** that the bot simulates on its own, with no player input once it starts.
_Avoid_: match, duel, fight, PvP

**Challenger**:
The player who starts a **Battle**.
_Avoid_: attacker, initiator

**Defender**:
The player a **Challenger** names as their opponent.
_Avoid_: target, opponent (when the role matters)

**Casual battle**:
A **Battle** between two **Display teams** at their real **Levels** that runs immediately without the **Defender's** consent. It is unrated, no CC changes hands, and only the **Challenger** can earn EXP.
_Avoid_: auto-battle, friendly

**Ranked battle**:
A **Battle** between two **Battle teams**, every Pokémon at Lv 50, that runs immediately and moves both players' **Ranked rating**. Only the **Challenger** can earn EXP.
_Avoid_: rated battle, competitive battle

**Wager battle**:
A **Battle** between two **Battle teams** at Lv 50 with a CC **Stake**, which runs only after the **Defender** accepts. It moves both players' **Ranked rating** as a **Ranked battle** does, both players can earn EXP, and the winner takes the pot.
_Avoid_: bet, stakes battle

**Stake**:
The CC each player puts into a **Wager battle's** pot; held from the moment it's offered or accepted until the **Battle** ends or the offer lapses.
_Avoid_: bet, wager amount, ante

**All-in**:
Accepting a **Wager battle** with less than the full **Stake** by putting up one's entire CC balance; the **Challenger's** excess is refunded.
_Avoid_: partial accept, short call

**Ranked rating**:
A player's Elo score from **Ranked battles** and **Wager battles** in the current **Season**, moved for both players after each one.
_Avoid_: Battle rating, rank, server rank, ELO (as a noun for the player's standing), MMR

**Season**:
A numbered period of ranked play. A new **Season** starts every player's **Ranked rating** and ranked record over and keeps the old ones as history.
_Avoid_: ladder reset, split

**Battle cap**:
The limit on how many **Battles** a player may start per UTC day, across all three kinds together and against any one **Defender**.
_Avoid_: stamina, energy, battle limit

**Power rating**:
A single number summarizing a **Team's** battle strength, used to compare two **Teams** before a **Battle**.
_Avoid_: team score, BP, CP

**Underdog**:
The player whose **Team** has the lower **Power rating** going into a **Battle**.
_Avoid_: weaker player, loser

**Underdog surge**:
A rare, announced boost to the **Underdog's** whole **Team** for one **Casual battle**, likelier the wider the **Power rating** gap, and likelier and stronger for an **Underdog** with high **Cuteness**. **Ranked battles**, **Wager battles**, **Challenges** and **Trainer encounters** have none.
_Avoid_: comeback mechanic, rubber-banding, luck boost

**Cuteness**:
How cute a species or **Mega form** looks, scored 0 to 10, and strictly: Pokémon that aren't cute score 0 to 2, most cute ones score 6 or 7, and only a handful score 10. A **Team's** **Cuteness** is its members' average. Players never see it.
_Avoid_: charm, appeal, cute score

### Challenges

**Challenge**:
A fight between a player's **Display team** and a fixed Kanto team: one of the 8 Gym Leaders, the **Elite Four run**, Blue, or Red. It is not a **Battle**: no other player takes part.
_Avoid_: PvE battle, gym battle, NPC battle, raid

**Badge**:
What a player earns by beating a Gym Leader's **Challenge** for the first time. A player holds at most 8, one per Gym Leader.
_Avoid_: medal, gym token

**Elite Four run**:
One **Challenge** against Lorelei, Bruno, Agatha, and Lance back to back, in which the player's Pokémon keep their damage from fight to fight. All 8 **Badges** unlock it, and losing any fight ends the run.
_Avoid_: gauntlet, E4 challenge, league

**Revive**:
The player's pick, after each fight won in an **Elite Four run**, of one fainted Pokémon to bring back at full HP for the next fight. A pick not made in time is lost.
_Avoid_: heal, Max Revive (as a term), second wind

### Trainer encounters

**Trainer encounter**:
A computer-run Trainer spotting a player while they chat and asking for a fight the player may accept or decline. It is neither a **Battle** nor a **Challenge**: no other player takes part, and the Trainer is not one of the fixed Kanto teams.
_Avoid_: trainer battle, random battle, wild trainer, NPC battle

**Trainer class**:
The kind of Trainer met in a **Trainer encounter**, such as Youngster, Lass, or Hiker, which sets the Trainer's look and the kind of Pokémon they carry.
_Avoid_: trainer type, NPC type

**Ace Trainer**:
The **Trainer class** that only the strongest **Trainer encounters** use. Those encounters can also come as any other class, so a Trainer's class never proves they are weak.
_Avoid_: elite trainer, boss trainer

**Prize money**:
The CC at stake in a **Trainer encounter**, set by the **Trainer class** and the Level of the Trainer's last Pokémon. The Trainer pays it to a player who wins, and a player who loses pays the same amount, or all their CC if they hold less.
_Avoid_: reward, bounty, payout (as a noun)

### Battle Records

**Fight record**:
The saved account of one finished **Battle**, **Challenge** or **Trainer encounter**: who fought, both teams as they were when it ran, the result, and every turn, so it can be replayed later. A player keeps their newest 50 of each kind, and a **Battle's** record appears in both players' histories.
_Avoid_: match, match history entry, battle record (that is a player's W/L and rating totals), replay (that is watching a record)

**Battle Records**:
The dashboard page where a player sees their own **Fight records** and replays them. Only its owner can see it.
_Avoid_: match history, battle history

### Mega Evolution

**Mega form**:
A Mega Evolution of a species, unlocked for good on one species + **Variant** a player owns. It is never a species of its own. It shares that Pokémon's **Level** and **Team** slot, doesn't count toward **Pokédex completion**, and a **Team** holds at most one.
_Avoid_: Mega species, Mega Pokémon (as something caught)

**Mega Stone**:
The item that unlocks one **Mega form** on one species + **Variant**, used up when it does.
_Avoid_: Key Stone, mega item

### Achievements

**Achievement**:
A goal reached through play, such as a catch count or a win streak, that earns Achievement Points (AP), a score with no other use, and may list a reward.
_Avoid_: trophy, quest

## Flagged ambiguities

- "Duplicate" is counted per variant, not per Pokémon. A player holding one normal and one shiny Pikachu has no duplicates.
- "Pokédex completion" is counted per Pokémon, not per variant. A player holding one normal and one shiny Pikachu has 1 toward Kanto, not 2.
- "Challenge" is not what a **Challenger** does. A **Challenger** starts a **Battle** against another player. A **Challenge** has no **Challenger** or **Defender**, only the player and the Kanto team they face.
- "Trainer" means a player everywhere except **Trainer encounters**, where it means the computer-run opponent. "Ace Trainer" is not one of the "Elite Four", which belong only to the **Elite Four run**.
- "Casual battle" and "open battle" are the same thing. The Teams and Overview pages and the code say "open", and `/battle` and the achievements say "casual".
- "Tier" also names a trainer sprite's price class, Common to Mythic, which is not a species' **Tier**. The 2026-11-10 re-tier changed trainer sprites, and the 2026-11-11 re-tier changed species.
- "Ranked" has nothing to do with **Rank**. A player's **Rank** comes from chatting; their **Ranked rating** comes from **Ranked battles** and **Wager battles**.
- Some **Achievements** list a badge as their reward, such as a region's badge for completing its Pokédex. That is not a **Badge**, which only comes from beating a Gym Leader's **Challenge**.
- "Copy" as a noun is always a **Copy** (one owned unit). As a verb it may describe teams and moves ("Copy from Battle team"); never call the result a "team copy".

## Example dialogue

> **Dev:** If someone has Pidgey x4 and ✨x2, how many duplicates do they have?
> **Domain expert:** Four. Three normal duplicates and one shiny duplicate. They keep one of each variant.
> **Dev:** And a single normal Pikachu plus a single shiny Pikachu?
> **Domain expert:** No duplicates. Each variant has only one copy.

> **Dev:** If I challenge someone way weaker than me, do they lose anything?
> **Domain expert:** Not in a **Casual battle**. The **Defender** never loses CC or Pokémon, and it's unrated, so nobody's **Ranked rating** moves. Your EXP shrinks when you knock out Pokémon far below your **Level**, so picking on weak teams doesn't pay.
> **Dev:** And if I want it to count?
> **Domain expert:** Play a **Ranked battle**. It uses both players' **Battle teams** at Lv 50, and both ratings move. Elo barely moves either rating when a much stronger **Team** wins.
> **Dev:** What if I want CC on the line?
> **Domain expert:** Then it's a **Wager battle**, which plays by the ranked rules with a **Stake** on top. They have to accept first, it uses one of each player's **Battle cap**, and both of you earn EXP.
> **Dev:** I caught a second Charmander — does it get its own **Level**?
> **Domain expert:** No. Your Charmanders share one **Level**; the new one adds EXP to it instead.
