# Every copy is its own Pokémon, and the Pokédex is a permanent record

Until now a player's Pokémon were counts per species and Variant (`pokemon[id] = { normal, shiny }`), every copy of a species and Variant shared one Level, and Pokédex completion counted what the player owned at that moment, because the game kept no record of past catches. We are replacing both: each **Copy** becomes an individual Pokémon with its own Level, EXP and moves, shown one tile per copy in a PC-box-style **Collection**, and a separate, append-only **Pokédex** records every species (and, separately, every shiny) the player has ever caught. Players asked for the Pokédex and the box to behave like the main games, and only individual copies make the box meaningful.

## Considered options

- **Pokédex only, counts unchanged.** The smallest change, and it fixes completion dropping on donation. It was rejected because the owner wants a PC box. With shared Levels, four Pidgey would be four identical tiles.
- **Display-only split.** Keep the counts and the shared Level, and draw one tile per count. Rejected for the same reason: the tiles would be fake individuals.
- **Individual copies (chosen).** This removes the shared Level and the duplicate-catch EXP loop. The loop comes back as an explicit **Feed** action, and every catch rolls its own Catch level.

## Consequences

- Hard to reverse. Once players have fed, gifted and levelled individual copies, Levels can't be folded back into one per species without losing something. For a rollback window, the release keeps writing the old counts and per-species training records, derived from the copies.
- Migration: copies on any Team and every trained copy keep the old shared Level. The other plain copies re-roll a Catch level, capped at the old Level.
- The Pokédex can only grow. It is seeded from current ownership plus the union of every historical snapshot, built offline. Pre-evolutions are never inferred. Only a full account reset clears it.
- Achievements named after the Pokédex count registered species. "Own at the same time" achievements (Living Pokédex, Hall of Legends, Mythic Archive, Own N different) keep counting the Collection.
- There is no Collection size cap for now. Data size per player is an open measurement (`tools/` copy-count script) and decides whether a cap is needed.
- Ships as one release together with the Showcase/Casual/Ranked team split, so Team slots are rewritten once, each slot naming one specific Copy.
