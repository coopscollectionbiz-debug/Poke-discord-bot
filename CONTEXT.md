# Coop's Collection

A Discord-native Pokémon collector game: players catch Pokémon while chatting, manage them on a web dashboard, and pit their teams against each other in automatic battles.

## Language

### Collection

**Tier**:
A species' rarity class: common, uncommon, rare, epic, legendary, or mythic.
_Avoid_: rarity (as a separate concept), evolution tier

**Stage**:
A species' position in its evolution line — 1 for a base form, 2 and 3 for each evolution after it.
_Avoid_: evolution tier, evolution level, form

**Variant**:
Whether a Pokémon is normal or shiny. Each species + **Variant** pair is counted, collected, leveled, and placed on a **Team** separately.
_Avoid_: form, version, shiny status

**Copy**:
One owned unit of a Pokémon in a specific variant.
_Avoid_: instance, unit

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
_Avoid_: using "rank" for battle standing — that's **Battle rating**

**Team**:
The up-to-6 Pokémon a player shows on their trainer card, one slot per Pokémon, each slot a specific **Variant**; the same **Team** fights in their **Battles**, in slot order.
_Avoid_: party, lineup, battle team, displayed Pokémon

**Region**:
A named set of Pokémon that share a home region: Kanto, Johto, Hoenn, Sinnoh, or Unova. The game's Pokémon data puts every Pokémon in exactly one region.
_Avoid_: region group, generation, gen

**Pokédex completion**:
The number of distinct Pokémon a player owns at least one copy of, out of all the Pokémon in a region. It counts what the player owns now. It drops when a player gives up their last copy of a Pokémon, because the game keeps no record of past catches.
_Avoid_: dex count, seen/caught

### Economy

**Donation**:
Permanently giving up a copy in exchange for CC, and sometimes Shiny Dust.
_Avoid_: sell, release

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

**Open battle**:
A **Battle** that runs immediately without the **Defender's** consent; no CC changes hands and only the **Challenger** can earn EXP.
_Avoid_: auto-battle, friendly, casual

**Wager battle**:
A **Battle** with a CC stake that runs only after the **Defender** accepts; both players can earn EXP and the winner takes the pot.
_Avoid_: bet, ranked, stakes battle

**Stake**:
The CC each player puts into a **Wager battle's** pot; held from the moment it's offered or accepted until the **Battle** ends or the offer lapses.
_Avoid_: bet, wager amount, ante

**All-in**:
Accepting a **Wager battle** with less than the full **Stake** by putting up one's entire CC balance; the **Challenger's** excess is refunded.
_Avoid_: partial accept, short call

**Battle rating**:
A player's Elo score from **Battles**, moved for both players after every **Battle**.
_Avoid_: rank, server rank, ELO (as a noun for the player's standing), MMR

**Battle cap**:
The limit on how many **Battles** a player may start per UTC day, overall and against any one **Defender**.
_Avoid_: stamina, energy, battle limit

**Power rating**:
A single number summarizing a **Team's** battle strength, used to compare two **Teams** before a **Battle**.
_Avoid_: team score, BP, CP

**Underdog**:
The player whose **Team** has the lower **Power rating** going into a **Battle**.
_Avoid_: weaker player, loser

**Underdog surge**:
A rare, announced boost to the **Underdog's** whole **Team** for one **Battle**, likelier the wider the **Power rating** gap.
_Avoid_: comeback mechanic, rubber-banding, luck boost

**Learnset**:
The moves a species learns as its **Level** rises, each at a fixed **Level**.
_Avoid_: move list, moveset (for the species' full list)

**Moveset**:
The up to 4 moves a player's species + **Variant** uses in **Battles**, shared by every copy of it they own. Unless the player has chosen otherwise, it's the last 4 moves its **Learnset** taught by its **Level**.
_Avoid_: moves (for the set), attacks, learnset

## Flagged ambiguities

- "Duplicate" is counted per variant, not per Pokémon. A player holding one normal and one shiny Pikachu has no duplicates.
- "Pokédex completion" is counted per Pokémon, not per variant. A player holding one normal and one shiny Pikachu has 1 toward Kanto, not 2.

## Example dialogue

> **Dev:** If someone has Pidgey x4 and ✨x2, how many duplicates do they have?
> **Domain expert:** Four. Three normal duplicates and one shiny duplicate. They keep one of each variant.
> **Dev:** And a single normal Pikachu plus a single shiny Pikachu?
> **Domain expert:** No duplicates. Each variant has only one copy.

> **Dev:** If I challenge someone way weaker than me, do they lose anything?
> **Domain expert:** In an **Open battle** the **Defender** never loses CC or Pokémon — only their **Battle rating** moves, and Elo barely moves it when a much stronger **Team** wins. Your EXP shrinks when you knock out Pokémon far below your **Level**, so picking on weak teams doesn't pay.
> **Dev:** What if I want CC on the line?
> **Domain expert:** Then it's a **Wager battle** — they have to accept first, it uses one of each player's **Battle cap**, and both of you earn EXP.
> **Dev:** I caught a second Charmander — does it get its own **Level**?
> **Domain expert:** No. Your Charmanders share one **Level**; the new one adds EXP to it instead.

> **Dev:** My Charmeleon's **Moveset** is full and it just hit the Level for a new move. Does it skip it?
> **Domain expert:** No. It learns it and forgets its oldest move, same as before. If the Level-up came from a **Battle** or a reward like /daily, you get a private prompt to forget a different move or not learn it at all.
> **Dev:** And when it evolves?
> **Domain expert:** Charizard keeps the **Moveset** you picked for Charmeleon, unless you'd already picked moves for your Charizard.
