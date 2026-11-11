# Held Items: Production Rollout Checklist and Rollback Procedure

**Every step below is a production action that needs the owner's explicit approval.** Merging to `master` auto-deploys to Fly. With every `HELD_ITEMS_*` flag unset the feature is completely dark: no held item can be obtained, the UI is hidden, and battles are unchanged (no-item parity: 0 differences).

## A. Before the merge

1. [ ] Owner reviews the PR (branch `feature/held-items`) and this release package. Open decisions: §D.
2. [ ] Back up production:
   - `MSYS_NO_PATHCONV=1 flyctl ssh sftp get /data/trainerData.json` (plus `trainerData.meta.json`) into `E:\PokeBot-Restricted\backups\pre-held-items-<UTC>\`;
   - record seq, epoch and SHA-256;
   - generate per-player fingerprints with the existing baseline tooling.
3. [ ] Dry run on that fresh copy: `node tools/held-items-audit.mjs <copy>`. The verdict must be **PASS**.
4. [ ] `npm run test:safe` on the merge result. Every test must pass.
5. [ ] Record the current Fly release and image. It is the rollback target.
6. [ ] Confirm that **no** `HELD_ITEMS_*` secret is set: `flyctl secrets list`.

## B. Merge (dark launch)

7. [ ] Merge the PR. This auto-deploys.
8. [ ] Health check `/readyz`. The boot log must show the same player count, and no `equipment`/`heldItemGrants` changes on boot.
9. [ ] Pull the post-boot snapshot and compare fingerprints. **0** records may differ because of this release.
10. [ ] Smoke test with the flags off:
    - `/api/held-items` returns `{ enabled: false }`;
    - the Teams and Shop pages look exactly as before;
    - `/addinventory leftovers` is refused ("isn't available yet").

## C. Staged enablement (each flip is a Fly secret change and a restart)

11. [ ] `HELD_ITEMS_ENABLED=1`, `HELD_ITEMS_TESTERS=<owner's Discord id>`. Only the owner sees anything. The owner checks:
    - opening Teams claims the eight starters once;
    - equip, move within a team, remove, and the second team staying independent;
    - a purchase;
    - phone layout.
12. [ ] Add `HELD_ITEMS_BATTLES_ENABLED=1` (still testers only). The owner runs casual and ranked battles, then checks the item notes in the replay, Lucky Egg EXP on the EXP card, and that nothing was used up.
13. [ ] Remove `HELD_ITEMS_TESTERS` to open the feature to everyone. Post the patch notes.
14. [ ] Watch for 7 days, from `events.ndjson` (`held_item_starter`, `held_item_equip`, `held_item_purchase`):
    - share of active players with ≥ 1 item equipped;
    - item pick rates;
    - CC spent per day;
    - battle length, turn-cap rate and win rate by item (reuse `runImplemented.mjs` scenarios).

## D. Owner decisions before step 13

- Shop prices: 3,000 for type boosters; 4,000 for Muscle Band, Wise Glasses and Black Sludge; 5,000 for Shell Bell, Light Ball and Thick Club; 6,000 for Eviolite. Total 87,000 CC (amendment §8).
- Item icons are emoji glyphs today. Approve them as final, or source pixel-art icons (licensing and credits).
- Whether the EXP card should say "Lucky Egg ×1.5". The data (`bonusFrom`, `baseGained`) is already in the result.

## E. Rollback

Use the lightest option that fixes the problem.

| Problem | Action | Data effect |
|---|---|---|
| A battle issue (balance, a bug in an effect) | Unset `HELD_ITEMS_BATTLES_ENABLED` | Battles run with no items, exactly as before. Unlocks and equipment are kept. |
| A dashboard or shop issue | `HELD_ITEMS_SHOP_ENABLED=0` / `HELD_ITEMS_DASHBOARD_ENABLED=0`, or unset `HELD_ITEMS_ENABLED` | Hidden. Nothing is deleted. |
| A code-level problem | `flyctl releases rollback` (or `deploy --image`) to the image from step 5 | The old code ignores `equipment`/`heldItemGrants` and keeps the new item ids in `items` (verified by test). CC spent stays spent and the unlocks come back on roll-forward. |
| Data corruption (not expected: nothing rewrites existing fields) | Stop the machine, restore the step 2 backup through the established restore runbook, restart | Every change since the backup is lost. Last resort only. |

After any rollback: rerun `tools/held-items-audit.mjs` on a fresh copy and compare fingerprints with the backup.
