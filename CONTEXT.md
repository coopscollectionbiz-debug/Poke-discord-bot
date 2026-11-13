# Coop's Collection

A Discord-native Pokémon collector game: players catch Pokémon while chatting, manage them on a web dashboard, and pit their teams against each other in automatic battles.

## Language

### Collection

**Aura**:
The effect a player shows behind their trainer on their own cards and battle images. Auras are collected and kept for good: each **Tier backdrop** from owning a trainer of that tier, one per Gym Leader, Elite Four member, Blue and Red from beating them, milestone Auras from achievements, shop Auras bought with CC, and event Auras handed out during an event. A player equips one on the dashboard, or Auto (their trainer's own **Tier backdrop**, the default) or None. An Aura is not tied to the trainer it came from. Computer-run opponents never wear one.
_Avoid_: background, backdrop (for the collectible), effect

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
Whether a Pokémon is normal or shiny. The **Pokédex** records each species + **Variant** pair separately.
_Avoid_: form, version, shiny status

**Copy**:
One individual Pokémon a player owns: a species in a specific **Variant**, with its own **Level**, **EXP** and moves. Two copies of the same species are two different Pokémon.
_Avoid_: instance, unit

**TM**:
A consumable item that teaches one specific move to one compatible **Copy**, and is used up when it does.
_Avoid_: technical machine (in UI text), move disc

**Trained copy**:
A **Copy** that has learned at least one move from a **TM**. It keeps those moves for good, through evolution, shiny crafting and **Gifts**, and is never picked automatically when copies are removed. Every other copy is an untrained copy.
_Avoid_: custom copy, customized copy, instance, TM copy

**Collection**:
Every **Copy** a player owns right now, one box slot per copy, like a PC box in the games. It shrinks when a copy is donated, gifted, fed or evolved away.
_Avoid_: Pokédex (that is what the player has ever caught), box (as the term), inventory

**Pokédex**:
The permanent record of every species a player has ever caught, and separately whether they have ever caught its shiny. A species enters it the first time the player gets a copy by any route (catch, pack, reward, **Gift**, evolution, **Grant**) and never leaves, even after the last copy is gone. Only a full account reset clears it.
_Avoid_: dex (alone), collection, seen (the game has no "seen" state)

**Registered**:
Recorded in a player's **Pokédex**. A species can be registered without being in the **Collection**.
_Avoid_: owned, discovered, unlocked

**Duplicate**:
Any copy beyond the first of the same Pokémon *and* variant. Pidgey x4 · ✨x2 has 3 normal duplicates and 1 shiny duplicate. One normal plus one shiny of the same Pokémon is not a duplicate. Duplicates are still individual Pokémon with their own **Levels**; which one counts as "the first" doesn't matter.
_Avoid_: extra, spare

**Level**:
One **Copy's** strength, from 1 to 100. Every copy has its own.
_Avoid_: species level, shared level

**EXP**:
Progress toward a **Copy's** next **Level**.
_Avoid_: XP (TP is already the chat-activity points), experience points

**Catch level**:
The **Level** a new **Copy** rolls when it is caught, set by its **Stage**, with Stage 1 legendaries and mythics rolling high. Every catch rolls one, duplicates included.
_Avoid_: wild level, spawn level

**Feed**:
Giving up one **Copy** to add **EXP** to another copy of the same species and **Variant**. The fed copy is gone; the species stays **Registered**. A copy on a **Team** can't be fed.
_Avoid_: merge, sacrifice, candy

### Trainer

**Rank**:
A player's title on the TP ladder (Novice Trainer → Legend), earned by chatting.
_Avoid_: using "rank" for battle standing, which is the **Ranked rating**

**Team**:
Up to 6 Pokémon a player sets in slot order, each slot one specific **Copy**. The same copy can sit on several **Teams**. The **Casual team** and **Ranked team** hold each Pokémon + **Variant** once; only the **Showcase team** holds the same Pokémon more than once, one copy per slot. A copy on a **Team** can't be donated, gifted or fed until it is taken off. Each player has three: the **Showcase team**, the **Casual team** and the **Ranked team**.
_Avoid_: party, lineup

**Showcase team**:
The **Team** a player puts on display to show off their favorites. It never fights, so it has no rules beyond owning what's in it.
_Avoid_: display team, favorites

**Casual team**:
The **Team** that fights **Casual battles** at its real Levels.
_Avoid_: Display team (its old name), open team

**Ranked team**:
The **Team** that fights **Ranked battles** and **Wager battles**, where every Pokémon fights at Lv 50. It holds at most one mythic-tier Pokémon.
_Avoid_: Battle team (its old name)

**Tier backdrop**:
The animated background an owned Epic, Legendary or Mythic trainer sprite brings to any card that shows it: the tier's sky colour with rising motes, plus a stepped glow and twinkles from Legendary up, and meteors with one bright hero meteor a loop for Mythic. It replaces the card's own background in that trainer's part of the card (their half of a VS card, their row in a battle), and nothing in it passes behind the trainer or anything else drawn there. Computer-run opponents and unowned sprites never have one. For players it is now the **Aura** shown on Auto, and the three tier backdrops are also collectible **Auras**.
_Avoid_: glow, trainer background

**Moveset**:
The up to 4 moves a player picks for one Pokémon on one **Team**, from the moves it has learned by its real **Level**. A Pokémon with none picked uses the last four moves it learned.
_Avoid_: move set, loadout

**Region**:
A named set of Pokémon that share a home region: Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, or Paldea. The game's Pokémon data puts every Pokémon in exactly one region, by National Dex number: the Hisui-introduced species #899–905 belong to Galar, and alternate forms (Galarian Meowth, Mega Charizard…) count toward their base species, never as extra Pokémon. Kalos, Alola, Galar and Paldea only appear once their generation is released.
_Avoid_: region group, generation, gen

**Pokédex completion**:
The number of distinct Pokémon **Registered** in a player's **Pokédex**, out of all the Pokémon in a region. It never drops: giving up the last copy of a Pokémon leaves it registered.
_Avoid_: dex count, owned count, seen/caught

### Economy

**Donation**:
Permanently giving up a **Copy** in exchange for CC, and sometimes **Shiny Dust**. The species stays **Registered**.
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

**Gift**:
A player sending one of their **Copies** to another player. It arrives as the same Pokémon, with its **Level**, **EXP** and moves, and registers in the recipient's **Pokédex**.
_Avoid_: trade (nothing comes back), transfer

**Grant**:
An **Admin change** that only adds to an account or resets cooldowns. Only **Grants** can go to many players at once; removals are made one player at a time.
_Avoid_: gift (that is player-to-player), reward, compensation (as the action's name)

**Live event**:
A named period, set by an admin with a start and an end, during which one or more **Event effects** change the game for every player. Several can run at once.
_Avoid_: event (alone, which is the activity log), surge (that is the **Underdog surge**), promotion, boost (for the whole thing)

**Event effect**:
One change a **Live event** makes while it runs, such as a **Catch boost**, a **Catch limit**, or a multiplier on EXP, TP, CC, Shiny Dust, Prize money or the shiny chance. Multipliers of the same kind from **Live events** that overlap multiply together.
_Avoid_: modifier, buff, perk

**Catch boost**:
An **Event effect** that makes chosen types, **Regions**, **Tiers** or species come up more often in random catches. A boost on a type, **Region** or species keeps each **Tier's** overall chance as it was; only a boost on a **Tier** changes it.
_Avoid_: spawn boost, rate up

**Catch limit**:
An **Event effect** that lets random catches give only chosen types, **Regions** or species. When **Live events** overlap, a Pokémon must pass every **Catch limit** to be caught.
_Avoid_: filter, restriction, lockout

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
A **Battle** between two **Casual teams** at their real **Levels** that runs immediately without the **Defender's** consent, unless it needs a **Rematch request**. It is unrated, no CC changes hands, and only the **Challenger** can earn EXP.
_Avoid_: auto-battle, friendly

**Rematch request**:
A **Challenger's** ask for another **Casual battle** with a **Defender** after reaching the per-**Defender** **Battle cap** with them that UTC day. The **Battle** runs only if the **Defender** accepts, and earns no rewards. A declined or expired one stops the **Challenger** from sending that **Defender** another until the next UTC day, or until the **Defender** challenges them.
_Avoid_: rematch (alone), consent request, battle request

**Ranked battle**:
A **Battle** between two **Ranked teams**, every Pokémon at Lv 50, that runs immediately and moves both players' **Ranked rating**. Only the **Challenger** can earn EXP.
_Avoid_: rated battle, competitive battle

**Wager battle**:
A **Battle** between two **Ranked teams** at Lv 50 with a CC **Stake**, which runs only after the **Defender** accepts. It moves both players' **Ranked rating** as a **Ranked battle** does, both players can earn EXP, and the winner takes the pot.
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
The limit on how many **Battles** a player may start per UTC day, across all three kinds together and against any one **Defender**. Past either limit, **Ranked battles** and **Wager battles** can't start. Past the daily limit, a **Casual battle** still runs but earns no rewards. Past the per-**Defender** limit, it needs a **Rematch request** first.
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
A fight between a player's **Casual team** or **Ranked team** (their pick, at real **Levels**) and a fixed Kanto team: one of the 8 Gym Leaders, the **Elite Four run**, Blue, or Red. It is not a **Battle**: no other player takes part.
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
A computer-run Trainer spotting a player while they chat and asking for a fight the player may accept with their **Casual team** or **Ranked team**, at real **Levels**, or decline. The Trainer's Levels are set by the team the player picks. It is neither a **Battle** nor a **Challenge**: no other player takes part, and the Trainer is not one of the fixed Kanto teams.
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
A Mega Evolution of a species, unlocked for good on one species + **Variant** a player owns, so any **Copy** of that species and **Variant** can use it. It is never a species of its own. It uses that copy's **Level** and **Team** slot, is never **Registered** and doesn't count toward **Pokédex completion**, and a **Team** holds at most one.
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
- "Pokédex completion" is counted per Pokémon, not per variant. A player who has caught one normal and one shiny Pikachu has 1 toward Kanto, not 2.
- "Pokédex" and "Collection" are different. The **Collection** is what a player owns now; the **Pokédex** is what they have ever caught. Achievements named after the Pokédex (region Pokédex Complete, National Pokédex Complete, Prismatic Pokédex) count **Registered** species; the others that say "at the same time" (Living Pokédex, Hall of Legends) count the **Collection**.
- "Challenge" is not what a **Challenger** does. A **Challenger** starts a **Battle** against another player. A **Challenge** has no **Challenger** or **Defender**, only the player and the Kanto team they face.
- "Trainer" means a player everywhere except **Trainer encounters**, where it means the computer-run opponent. "Ace Trainer" is not one of the "Elite Four", which belong only to the **Elite Four run**.
- "Casual battle" and "open battle" are the same thing. Players only see "casual"; the code still says "open" (the `open` battle mode).
- "Tier" also names a trainer sprite's price class, Common to Mythic, which is not a species' **Tier**. The 2026-11-10 re-tier changed trainer sprites, and the 2026-11-11 re-tier changed species.
- "Ranked" has nothing to do with **Rank**. A player's **Rank** comes from chatting; their **Ranked rating** comes from **Ranked battles** and **Wager battles**.
- Some **Achievements** list a badge as their reward, such as a region's badge for completing its Pokédex. That is not a **Badge**, which only comes from beating a Gym Leader's **Challenge**.
- A random catch is any Pokémon rolled at random: the chat catch, `/daily`, Poké Balls, `/recruit`, quests and the weekly pack. **Catch boosts** and **Catch limits** reach all of them, and never reach a **Grant**, a gift or an evolution. On the ones paid for in CC (Poké Balls and `/recruit`) the player chooses whether they apply; the free ones always follow them.
- "Copy" as a noun is always a **Copy** (one owned unit). As a verb it may describe teams and moves ("Copy from Ranked team"); never call the result a "team copy".
- "Showcase" is a **Team** but never fights. Rules written for "a **Team**" about battles (one Mega, moves, held items) cover only the **Casual team** and **Ranked team**.

## Example dialogue

> **Dev:** If someone has Pidgey x4 and ✨x2, how many duplicates do they have?
> **Domain expert:** Four. Three normal duplicates and one shiny duplicate. They keep one of each variant.
> **Dev:** And a single normal Pikachu plus a single shiny Pikachu?
> **Domain expert:** No duplicates. Each variant has only one copy.

> **Dev:** If I challenge someone way weaker than me, do they lose anything?
> **Domain expert:** Not in a **Casual battle**. The **Defender** never loses CC or Pokémon, and it's unrated, so nobody's **Ranked rating** moves. Your EXP shrinks when you knock out Pokémon far below your **Level**, so picking on weak teams doesn't pay.
> **Dev:** And if I want it to count?
> **Domain expert:** Play a **Ranked battle**. It uses both players' **Ranked teams** at Lv 50, and both ratings move. Elo barely moves either rating when a much stronger **Team** wins.
> **Dev:** What if I want CC on the line?
> **Domain expert:** Then it's a **Wager battle**, which plays by the ranked rules with a **Stake** on top. They have to accept first, it uses one of each player's **Battle cap**, and both of you earn EXP.
> **Dev:** I caught a second Charmander — does it get its own **Level**?
> **Domain expert:** Yes. It's a separate Pokémon in your **Collection** with its own **Catch level**. If you'd rather make your first one stronger, **Feed** the new one to it.
> **Dev:** And if I donate both Charmanders?
> **Domain expert:** Your **Collection** has no Charmander, but it stays **Registered** in your **Pokédex**, so your Kanto **Pokédex completion** doesn't drop.
