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
| `loopLag` | Main-thread stalls over the last 5 min: `p50Ms` (median minute), `p99Ms` and `maxMs` (worst minute). Also logged each minute as `⏱️ loop lag 1m: …`. A high max means commands and buttons waited. |
| `renderThreads` | Render threads (see "Render threads" below): `threads`, `alive`, `busy`, `queued`, `completed`, `queueTimeouts` (cards sent as PNG because every thread was busy for 2 s), `crashes`, `down`. `null` with `RENDER_THREADS=0`. |

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
flyctl machine update OLD -a $A --autostart=false --skip-start --yes   # graceful stop that STAYS stopped (plain `machine stop` gets auto-started by the proxy)
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

## Full sim switch
`FULL_SIM_ENABLED=1` moves every fight to Pokémon Showdown's engine with Battle plans (README, "Full sim and Battle plans"). Unset, the bot runs exactly as before.

- **Turn on.** Set `FULL_SIM_ENABLED=1` and restart. On that first start the bot records the current moves of every unpicked Team member (log line `⚔️ Full sim: recorded current moves for N player(s)`) and saves. Later starts skip it.
- **Workers.** `SIM_THREADS` (default 1, 0 = main thread) sets the sim worker threads. Each worker holds its own copy of the engine, about 160 MB, and `0` loads it into the bot's own process instead. The VPS also runs other services, so keep it at 1 unless fights queue. With the switch off the engine never loads.
- **Failed fights.** A fight the sim can't finish changes nothing and logs one line. `⚠️ wager fight failed` means both Stakes went back, `⚠️ encounter fight failed` means the card stays open, and `⚠️ challenge fight failed` means the player was told to try again or that their run is paused. At startup, `⚠️ couldn't finish the open Elite Four run of <user id>` leaves that run open for the next start.
- **Roll back.** Unset `FULL_SIM_ENABLED` and restart. Fights go back to the old engines, saved plans and recorded moves stay for next time, and new Fight records still replay. An Elite Four run that started on the full sim finishes on it.

## Production host (VPS)

Production is moving from Fly to a VPS (Ubuntu 26.04). SSH in through the `pokebot-vps` alias: add `Host pokebot-vps` with the real `HostName` and `User` to your own `~/.ssh/config`. Keep the address and login out of the repo. Until the cutover below is done, Fly is still production and the sections above still apply.

| What | Where |
|---|---|
| Service | `pokebot.service` (source: `deploy/pokebot.service`), runs as user `pokebot`, `MemoryMax=4G` |
| Code | `/opt/pokebot/releases/<sha>`, live one linked at `/opt/pokebot/current` |
| Player data | `/srv/pokebot/data` (`TRAINERDATA_DIR`, `LOCAL_IS_DURABLE=1`) |
| Secrets | `/etc/pokebot.env` (root, 0600). Host settings stay in the unit file. |
| Public URL | `https://bot.coopscollection.com` (nginx: `deploy/nginx/`, certificate by certbot) |
| Logs | `journalctl -u pokebot -f` |

**Merging to `master` does not deploy to the VPS.** Deploy by hand after merging.

### Deploy
1. `/adminsave` in Discord at a quiet time.
2. `ssh pokebot-vps /opt/pokebot/deploy-vps.sh` (deploys `master`; pass a branch, tag or sha to deploy something else).
   - The script builds `/opt/pokebot/releases/<sha>`, checks that both canvas libraries render, switches `current`, restarts `pokebot` and waits for `/readyz`.
3. `curl -s https://bot.coopscollection.com/readyz` shows `"ready":true`, `dataDir` `/srv/pokebot/data`, `durableVolume` `true`.

`/opt/pokebot/deploy-vps.sh` is a copy of `tools/deploy-vps.sh`. After changing the script in the repo, copy it over again: `scp tools/deploy-vps.sh pokebot-vps:/opt/pokebot/deploy-vps.sh`.

### Roll back code
`ssh pokebot-vps /opt/pokebot/deploy-vps.sh --rollback` points `current` at the previous release and restarts. Then revert the bad merge on `master` through a PR.

### Overrides and restores
The Fly `flyctl secrets set X=1` steps above become: add `X=1` to `/etc/pokebot.env` (`sudo nano /etc/pokebot.env`), `sudo systemctl restart pokebot`, and remove the line once the bot is ready. A file restore uses `RESTORE_FROM=file:/srv/pokebot/data/snapshots/trainerData-YYYY-MM-DD.json` with a matching `CONFIRM_RESTORE`.

### Render threads
Cards and battle images are drawn on background threads (`utils/render/renderPool.js`), so a 0.3–1 s GIF never holds up other commands. `RENDER_THREADS` in `/etc/pokebot.env` sets the count: unset means 3, sized so the WoW server keeps its share of the 8 cores (`node tools/bench-render-threads.mjs` measures it). An animated card waits up to 2 s for a free thread, then the still PNG goes instead (`(threads busy)` in its `🖼️ card` log line). Battles always wait.
- **Turn them off:** `RENDER_THREADS=0` in `/etc/pokebot.env`, then `sudo systemctl restart pokebot`. Images render on the main thread as before (at most 2 GIFs at once, the rest PNG).
- **Threads that can't start** (3 failures in a row) switch off on their own; the log says `rendering on the main thread from now on` and `/readyz` shows `renderThreads.down`.

### Superseded
There must be exactly one bot process: `systemctl status pokebot` on the VPS, and the Fly machine stopped (`flyctl machines list -a poke-discord-bot-49shta`). Nobody runs the bot locally with the production `BOT_TOKEN`. Then `sudo systemctl restart pokebot`.

### Cutover from Fly (one-time)
Prepared beforehand: `pokebot` user, `/srv/pokebot/data`, unit installed but **not enabled**, a release built with `deploy-vps.sh --build-only`, nginx and the certificate for `bot.coopscollection.com`.
1. Disconnect the Fly GitHub app from the repo, and merge nothing until the cutover is done.
2. Pipe the secrets into `/etc/pokebot.env` straight from the Fly machine (never print them), leaving out `NODE_ENV`, `PORT`, `PUBLIC_URL`, `TRAINERDATA_DIR`, `LOCAL_IS_DURABLE` and Fly's own variables.
3. `/adminsave`; note the users, `seq` and `epoch` of the bot-posted backup.
4. `flyctl machine update <ID> -a poke-discord-bot-49shta --autostart=false --skip-start --yes`, and wait for the final `✅ Discord backup` in `flyctl logs`.
5. Copy the whole volume (a tar through `flyctl ssh console`, or `MSYS_NO_PATHCONV=1 flyctl ssh sftp get` per file) to `/srv/pokebot/data`, owner `pokebot`.
6. Check `trainerData.meta.json` against the final Discord backup message: same `sha256`, `seq` and `epoch`.
7. Switch `current` to the release to run (`deploy-vps.sh --no-restart <sha>`), then `sudo systemctl enable --now pokebot`. `/readyz` shows an epoch above Fly's, `superseded: false`, and the same user count.
8. **Rollback for 48 h:** `sudo systemctl disable --now pokebot`, then `flyctl machine update <ID> --autostart=true` and `flyctl machine start <ID>`. Fly loads the VPS's newer backup.
9. After 48 h: deploy the Fly app as a token-less 301 redirect to `https://bot.coopscollection.com` for 30 days, then destroy the Fly app and volume.

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
