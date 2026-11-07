# Coop's Collection

A Discord Pokémon collector game. Players earn currency by chatting, catch Pokémon, and manage their collection on a web dashboard.

## Language

### Collection

**Variant**:
The normal or shiny form of a Pokémon. A player's copies of one Pokémon are counted separately per variant.
_Avoid_: form, version

**Copy**:
One owned unit of a Pokémon in a specific variant.
_Avoid_: instance, unit

**Duplicate**:
Any copy beyond the first of the same Pokémon *and* variant. Pidgey x4 · ✨x2 has 3 normal duplicates and 1 shiny duplicate. One normal plus one shiny of the same Pokémon is not a duplicate.
_Avoid_: extra, spare

**Team**:
Up to 6 Pokémon a player displays, one slot per Pokémon, each slot a specific variant.
_Avoid_: displayed Pokémon, party

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

## Flagged ambiguities

- "Duplicate" is counted per variant, not per Pokémon. A player holding one normal and one shiny Pikachu has no duplicates.
- "Pokédex completion" is counted per Pokémon, not per variant. A player holding one normal and one shiny Pikachu has 1 toward Kanto, not 2.

## Example dialogue

> **Dev:** If someone has Pidgey x4 and ✨x2, how many duplicates do they have?
> **Domain expert:** Four. Three normal duplicates and one shiny duplicate. They keep one of each variant.
> **Dev:** And a single normal Pikachu plus a single shiny Pikachu?
> **Domain expert:** No duplicates. Each variant has only one copy.
> **Dev:** For Pokédex completion, does that Pikachu pair count as 2 toward Kanto?
> **Domain expert:** No, 1. Pokédex completion counts distinct Pokémon. And if they donate both copies, Kanto drops by one, because we don't keep a history of what they've ever caught.
