# tools/economy-audit

These scripts back `docs/audits/economy-2026-11/`. They are read-only. They never write player data, start the bot or talk to Discord.

| Script | Reads player data? | Writes |
|---|---|---|
| `model.mjs` | no | `docs/audits/economy-2026-11/model.json`: Tier odds per ball and Rank, donation payback, chat catch pity, player profiles, one-time pools, Focus type pools, and the Quests proposal sims |
| `aggregate.mjs` | yes, on the server | stdout: aggregates only (counts, totals, percentiles). No ids, no names, no per-player rows. p95, p99 and max are rounded. |
| `build-html.mjs` | no | `REPORT.html` from `REPORT.md` |

## Reproduce

Code-only model (any machine, from the repo root):

```bash
POKEMON_GENERATIONS=6 node tools/economy-audit/model.mjs > docs/audits/economy-2026-11/model.json
```

Production aggregates. Use the `pokebot-vps` SSH alias, and never write the server address into the repo. The script has no imports outside Node, so copy it, run it and delete it:

```bash
scp tools/economy-audit/aggregate.mjs pokebot-vps:/tmp/econ-agg.mjs
ssh pokebot-vps 'cd /opt/pokebot/current && D=/srv/pokebot/data; sudo node /tmp/econ-agg.mjs $D/trainerData.json $D/events.ndjson --prev $D/snapshots/trainerData-2026-11-10.json --days 2.65; rm -f /tmp/econ-agg.mjs' > docs/audits/economy-2026-11/aggregates-reconciled.json
```

- `--prev` is an older snapshot. It gives the supply change and the TP gain, which is how chat CC is estimated.
- `--days` sets the event window. Match it to the time between the two snapshots, so logged flows and the supply change cover the same period.
- Run it from `/opt/pokebot/current` so it finds `pokemonData.json` for the Tier counts.

HTML:

```bash
node tools/economy-audit/build-html.mjs
```

## Data handling

Only the aggregate output leaves the server. Check it before committing: `grep -cE "[0-9]{17,20}" docs/audits/economy-2026-11/aggregates-*.json` must print 0 for every file.
