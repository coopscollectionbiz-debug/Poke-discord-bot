# Operations Runbook: Coop's Collection Bot

**Production app:** `poke-discord-bot-49shta` (Fly.io, `iad`, a single shared-cpu-1x machine with 512 MB).

> ⚠️ **Every push to `master` deploys to production automatically** through the Fly.io GitHub app. Merging a PR into `master` *is* a deploy.

## Where player data lives

| Copy | Location | Updated | Used for |
|---|---|---|---|
| Live | Bot memory (`trainerData`) | Every change | Serving commands |
| Local snapshot | `$TRAINERDATA_DIR/trainerData.json` plus `.meta.json` | Within about 15 s of a change | **Primary restart source** (once a volume is mounted) |
| Previous generation | `$TRAINERDATA_DIR/trainerData.prev.json` | Each save | Fallback if the current file is corrupt |
| Daily copies | `$TRAINERDATA_DIR/snapshots/trainerData-YYYY-MM-DD.json` (last 7) | Once per UTC day | Manual restore |
| Off-machine | Discord storage channel: `trainerData.json` posted by the bot, with `seq=… epoch=… users=… sha256=… savedAt=…` in the message; each upload is re-downloaded and its sha256 checked | Every 5 min when changed, on shutdown, `/adminsave` | Volume lost, or a new machine |

Since A2, `TRAINERDATA_DIR=/data` is a Fly volume (`trainerdata`, see `fly.toml`), so local snapshots survive restarts and deploys. A volume attaches to one machine only, so there is a single local writer. Snapshots are compact JSON.

### How startup chooses (`persistence/loader.js`)
1. **Candidates:** the local current file, the local previous file, and the newest 3 Discord backups **posted by the bot**. Backups posted by anyone else are ignored.
2. **Validation:** a candidate is rejected if its JSON is invalid or empty, if it isn't a user map, or if any user record isn't an object. Metadata is trusted only when its sha256 matches the file.
3. **Pick the newest:** if both copies have an `epoch`, the higher epoch wins. Otherwise compare `seq`. Fall back to `savedAt` (or the file or message time) when `seq` is unknown. On a tie, prefer the local copy.
4. **Refuse a big drop:** if the newest copy has fewer than 80% of the players in the largest valid copy, the bot loads nothing and stays NOT READY.
5. **Don't guess:** if the Discord storage channel can't be read, the bot doesn't load local data (a newer backup might be there) and stays NOT READY. **Exception (A2):** with `LOCAL_IS_DURABLE=1` (set in `fly.toml` with the volume), it boots from a local snapshot whose metadata verifies.
6. Nothing is written to disk or uploaded to Discord until a snapshot has loaded.

`/readyz` returns 200 when ready. Otherwise it returns 503 with `loadBlockedReason`. `/healthz` reports liveness only.

`/readyz` fields (A2):

| Field | Meaning |
|---|---|
| `epoch` | This process's writer epoch |
| `seq` | Latest snapshot number |
| `dataDir`, `durableVolume` | Should be `/data` and `true` |
| `localSave.degraded` | `true` after 3 failed writes in a row. Dashboard writes are refused (503) until a write succeeds. |
| `localSave.pendingChanges` | Changes not yet on disk |
| `discordBackup.lastVerified`, `lastVerifiedAt` | Last off-machine backup confirmed by sha256 |
| `superseded` | See "Superseded" below |

### Writer epochs and fencing (A2)
- Every process that loads player data takes an **epoch** higher than any it has seen, and stamps it on every snapshot and backup.
- Before each Discord upload, the bot checks the channel. If a backup with a **higher** epoch exists, another process has taken over: this one stops writing for good, reports `superseded` in `/readyz`, and stays NOT READY.
- The loader prefers the higher epoch, so a stale process can never win by writing later.

**Superseded** means two bot processes were running with the production token: a second machine, or someone running the bot locally.
1. Stop the extra process. Check `flyctl machines list` (there should be exactly one machine), and make sure nobody runs the bot locally with the production `BOT_TOKEN`.
2. Restart the superseded machine. It loads the newest data (the other process's) and continues.

## A2 volume migration (one-time, already done if `durableVolume` is true)
A volume can only be attached when a machine is created, so the machine is replaced once:
```bash
A=poke-discord-bot-49shta
flyctl volumes create trainerdata --region iad --size 1 -a $A --yes
flyctl machines list -a $A                         # note the current machine ID (OLD)
# run /adminsave in Discord, then:
flyctl machine stop OLD -a $A                      # graceful: flushes and uploads the final backup
flyctl machine clone OLD --attach-volume <VOLUME_ID>:/data --region iad -a $A
flyctl machine destroy OLD -a $A --force           # only after the clone reports ready
# then merge the A2 PR (deploys the code and the /data env onto the new machine)
```
Check afterwards: `/readyz` shows `durableVolume: true` and `dataDir: "/data"`. After `flyctl machine restart <NEW>`, it shows `loadedFrom: "local"`.

## Routine deploy
1. Open a PR into `master`. Check that the tests pass (`npm ci && npm test`).
2. Pick a quiet time. Run `/adminsave` in Discord, then confirm a fresh bot-posted backup appears in the storage channel and note the user count.
3. Merge the PR. That deploys.
4. Watch the logs: `flyctl logs -a poke-discord-bot-49shta`.
   - **Old process:**
     - `✅ Local save flushed`
     - `✅ Discord backup #N (…, <users> users, seq …)`
   - **New process:**
     - `✅ Loaded <N> users from local …` or `from discord …`
     - `✨ Bot ready`
5. `curl https://poke-discord-bot-49shta.fly.dev/readyz` should return `{"ready":true,…}`.

## Bot stuck NOT READY
1. Check `/readyz` → `loadBlockedReason`, and the logs (each rejected candidate is listed with a reason).
2. **"Discord storage channel unreachable":**
   - Check that the bot can see the channel.
   - The bot retries loading on its own, waiting 1 minute at first and longer after each try, up to 30 minutes.
   - Only if you are sure the local copy is the newest: `flyctl secrets set ALLOW_LOCAL_ONLY=1`. This restarts the bot. **Unset it afterwards.**
3. **"below 80% of the largest valid snapshot":**
   - Find out why players are missing before overriding.
   - If the drop is correct (intentional cleanup): `flyctl secrets set ALLOW_PLAYER_COUNT_DROP=1`, then unset it once the bot is ready.
4. **"no valid snapshot":** use a restore (below).

## Restore a specific backup
Pick the source:
- **A Discord backup:** right-click the backup message → Copy Message ID.
- **A file on the volume:** for example `/data/snapshots/trainerData-2026-11-08.json`.

Then:
```bash
flyctl secrets set RESTORE_FROM=discord:<messageId> CONFIRM_RESTORE=discord:<messageId> -a poke-discord-bot-49shta
# or RESTORE_FROM=file:/data/snapshots/trainerData-2026-11-08.json (CONFIRM_RESTORE must match exactly)
```
The bot restarts, loads that snapshot (the log shows `OPERATOR RESTORE`), and numbers new saves above everything it found.

**Unset both variables as soon as it's ready.** Otherwise every restart restores again:
```bash
flyctl secrets unset RESTORE_FROM CONFIRM_RESTORE -a poke-discord-bot-49shta
```

## Roll back code
1. `/adminsave`, if the bot is up.
2. `flyctl releases -a poke-discord-bot-49shta`, then `flyctl deploy -a poke-discord-bot-49shta --image <image of the previous release>`.
3. Open a PR that reverts the bad merge on `master`. **Don't force-push.** Merging the revert deploys again.

The player-data format is unchanged across these releases, so older code can load the newer Discord backups. It ignores the metadata in the message text and simply takes the newest attachment.

## Useful read-only commands
```bash
flyctl status -a poke-discord-bot-49shta
flyctl machines list -a poke-discord-bot-49shta
flyctl volumes list -a poke-discord-bot-49shta
flyctl config show -a poke-discord-bot-49shta
flyctl secrets list -a poke-discord-bot-49shta      # names only
flyctl releases -a poke-discord-bot-49shta
flyctl logs -a poke-discord-bot-49shta --no-tail    # last ~100 lines; older logs: Fly dashboard
flyctl ssh console -a poke-discord-bot-49shta -C "ls -l /data /data/snapshots"   # once a volume exists
```
