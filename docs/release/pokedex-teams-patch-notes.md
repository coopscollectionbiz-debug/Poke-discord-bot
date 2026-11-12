# Patch notes: Pokédex, Collection and three teams

DRAFT for review. Not posted.

## Your Pokédex remembers

Your Pokédex now counts every Pokémon you have ever caught, and separately every shiny you have ever caught. It never goes down. Donating, gifting or evolving your last copy of a Pokémon leaves it in your Pokédex.

After the update, the bot reads its old backups and adds the Pokémon you owned in the past. This runs in the background, so some Pokédex numbers and achievements may fill in a little after the update.

There's a new Pokédex page on the dashboard. It shows every Pokémon by region: what you've caught, which shinies you've caught, how many you own now, and a silhouette for anything you haven't caught yet.

The catch card says NEW only the first time a Pokémon enters your Pokédex, and NEW SHINY for your first shiny of it.

These achievements now count your Pokédex: each region's Pokédex Complete, Pokédex Complete, National Pokédex Complete and Prismatic Pokédex. Living Pokédex, Hall of Legends, Mythic Archive and the "own N different Pokémon" achievements still need the Pokémon in your Collection at the same time. Achievements you already earned stay earned.

## Every Pokémon is its own Pokémon

Your Collection is now a box with one slot per Pokémon. If you have four Pidgey, you have four separate Pidgey, each with its own Level, EXP and moves.

What happened to the Pokémon you already had:

- Pokémon on one of your teams, and Pokémon that learned a TM move, kept their Level.
- Your other duplicates got a new Level, never higher than the one they had.

New catches each get their own Level. A duplicate no longer adds EXP to the one you already have. To do that now, open Collection, choose Feed, and give the duplicate to the Pokémon you want to train. The duplicate is used up and the other one gains the same EXP a duplicate catch used to give.

Pokémon on a team can't be donated, gifted or fed. Take them off the team first. They can still evolve or turn shiny, and they stay in their team slot.

When you gift a Pokémon, the other player gets that exact Pokémon, with its Level and any TM moves.

## Three teams

You now have three teams. Each one is edited on its own tab of the dashboard Teams page.

- Showcase team. Your favorites, shown on /showcase and your trainer card. It never fights. It can hold the same Pokémon more than once if you own enough copies, and any number of Megas. We filled it with your current team to start.
- Casual team. Your old Display team. It fights casual battles at real Levels.
- Ranked team. Your old Battle team. It fights ranked and wager battles at Lv 50.

/challenge and Trainer encounters now ask which team to use, Casual or Ranked. Both fight at real Levels there. In an encounter, the Trainer's Levels and the prize depend on the team you pick, and the card shows both prizes.

Each team slot uses one specific Pokémon. When you own more than one of it, the Teams page asks which one, and its moves and held item belong to that one. Casual and Ranked teams still hold each Pokémon once; only the Showcase can repeat.

## Command changes

| Use now | Instead of |
|---|---|
| /showcase | /showteam |
| /rankedcard | /showbattlecard |
| /trainercard, then Share to channel | /showcard |
| /trainercard (luck is shown on your private card) | /luck |
| /pokedex, then Your stats | /inspectpokemon |

The old names keep working for about two weeks.

- /showcase and /rankedcard take a user to look at someone else's. Only you see the answer.
- /pokedex suggests names as you type and handles typos. If a name is misspelled, it opens the closest match or asks which one you meant.
- /inspecttrainer is open to everyone. Use user to see the trainer a player has equipped, or name to look up any trainer. It shows how many players own that trainer.
- /showtrainers is gone. Browse your trainers on the dashboard Trainers page.
- /quest and /recruit show the same catch card as a random catch.
