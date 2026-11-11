# Pokémon re-tier, Gens 1–9: decisions

The owner approved these in a grilling session on 2026-11-11. The tier changes are in [`data/pokedex/tier-overrides.json`](../../../data/pokedex/tier-overrides.json), which `tools/generate-pokedex.mjs` applies last. That file is the single source for the 39 changes. To rebuild the review page (`POKEMON-TIER-REVIEW.html` at the repo root; it is not tracked), run `node docs/audits/pokemon-tiers/build-review.mjs`.

Sources: `pokemonData.json` (tiers), `battleData.json` (base stats), and `source-catalog-2026-11-09.csv`. The CSV comes from the 2026-11-10 rarity audit, and its ownership columns are aggregates from snapshot seq 604 (2026-11-09).

## Tier meaning

- **D1. BST is a guardrail.** A tier measures collectible prestige. Base stat total is the whole of battle strength: ordinary Pokémon have no battle abilities, and ranked runs at Lv 50. BST only overrides the tier for large outliers. A pure-BST re-tier was rejected: it would move 472 of 1,025 species (`build-review.mjs`, `pureBstMoves`).
- **D2. Mythic** = an official Mythical, or a cover legendary with BST ≥ 660. This moves Dialga, Palkia, Giratina and Kyurem (all live), and Zacian and Zamazenta (Gen 8). Zygarde, Necrozma, Calyrex and Terapagos stay legendary (base BST 450–600). Regigigas stays legendary.

## Tier changes

- **D3.** The 8 Paradox Pokémon with BST 590 → legendary. The Paradox Pokémon at 570 and the Ultra Beasts stay epic.
- **D4.** Archaludon (600) → legendary. Slaking (670) stays epic; the follow-up is to model Truant and Slow Start in battles.
- **D5.** New evolutions of older species → epic, following Gen 4 (21 of 22 there were epic): Wyrdeer, Kleavor, Ursaluna, Basculegion, Sneasler, Overqwil, Runerigus. Perrserker and Clodsire → rare.
- **D6.** Power outliers move up one tier. Commons with BST ≥ 425 → uncommon. Uncommons ≥ 500 → rare. Rares ≥ 530 → epic.
- **D9 (default, not discussed).** Dipplin → rare, to match Flapple and Appletun. The Gen 1–5 sibling branches are left as they are.

## Battle team

- **D7.** A stored Battle team with more than one mythic-tier Pokémon keeps the first one in slot order. The others leave the team but stay in the collection. This runs in `normalizeBattleTeam`, so it happens at boot for every player. The boot log prints `⚔️ Battle teams trimmed to one mythic-tier Pokémon: N`.
- **D8.** Each affected player gets one stored notice (`user.notices`, `services/notices.js`). It shows on the Teams page, which opens on the Battle team tab while the notice is pending, until they press "Got it" (`POST /api/dismiss-notices`). It is also sent as an ephemeral follow-up to their next `/battle`. Either one clears it. No DMs.

## Open

- How many Battle teams the trim affects. The Nov 9 snapshot predates Battle teams; the boot log line above gives the count on deploy.
- Ranked accepts Battle teams of 1–5 Pokémon. Battles are refused only when a team is empty (`utils/battle/runBattle.js:106`).
- Modelling Truant and Slow Start (D4).
