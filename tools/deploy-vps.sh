#!/usr/bin/env bash
# Deploy Coop's Collection to the production VPS. Run ON the VPS as `ubuntu`.
#
#   deploy-vps.sh                 deploy origin master
#   deploy-vps.sh <ref>           deploy a branch, tag or commit from GitHub
#   deploy-vps.sh --no-restart <ref>
#                                 build and switch `current`, but leave the bot running
#   deploy-vps.sh --build-only <ref>
#                                 build the release only; `current` is not touched
#   deploy-vps.sh --rollback      point `current` back at the previous release and restart
#
# Layout (RUNBOOK.md "Production host"):
#   /opt/pokebot/repo.git          bare mirror of GitHub
#   /opt/pokebot/releases/<sha>    one folder per deployed commit (read-only to the bot)
#   /opt/pokebot/current           symlink to the live release; pokebot.service runs from it
#   /opt/pokebot/previous          sha of the release before the last switch
#   /srv/pokebot/data              player data; never touched by this script
set -euo pipefail

ROOT=/opt/pokebot
REPO="$ROOT/repo.git"
RELEASES="$ROOT/releases"
KEEP=3
ORIGIN=https://github.com/coopscollectionbiz-debug/Poke-discord-bot.git
SERVICE=pokebot

mode=deploy
case "${1:-}" in
  --rollback)   mode=rollback; shift ;;
  --no-restart) mode=norestart; shift ;;
  --build-only) mode=buildonly; shift ;;
esac
REF="${1:-master}"

log() { printf '[deploy] %s\n' "$*"; }

restart_and_wait() {
  if ! systemctl is-enabled --quiet "$SERVICE" 2>/dev/null; then
    log "$SERVICE is not enabled; not restarting (enable it at cutover)."
    return 0
  fi
  log "restarting $SERVICE (graceful stop saves and backs up first)"
  sudo systemctl restart "$SERVICE"
  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8080/readyz >/dev/null 2>&1; then
      log "ready: $(curl -fsS http://127.0.0.1:8080/readyz | head -c 300)"
      return 0
    fi
    sleep 3
  done
  log "NOT READY after 180 s. Check: journalctl -u $SERVICE -n 100; curl -s http://127.0.0.1:8080/readyz"
  return 1
}

switch_to() {
  local sha="$1" old=""
  [ -L "$ROOT/current" ] && old="$(basename "$(readlink "$ROOT/current")")"
  if [ "$old" = "$sha" ]; then log "current is already $sha"; return 0; fi
  ln -sfn "$RELEASES/$sha" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  [ -n "$old" ] && echo "$old" > "$ROOT/previous"
  log "current -> $sha (previous: ${old:-none})"
}

if [ "$mode" = rollback ]; then
  [ -s "$ROOT/previous" ] || { log "no previous release recorded"; exit 1; }
  prev="$(cat "$ROOT/previous")"
  [ -d "$RELEASES/$prev" ] || { log "previous release $prev is gone"; exit 1; }
  switch_to "$prev"
  restart_and_wait
  exit $?
fi

# 1. Fetch.
if [ ! -d "$REPO" ]; then
  log "cloning mirror"
  git clone --quiet --bare "$ORIGIN" "$REPO"
fi
git -C "$REPO" fetch --quiet --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
SHA="$(git -C "$REPO" rev-parse --verify "$REF^{commit}")"
log "ref $REF = $SHA ($(git -C "$REPO" log -1 --format=%s "$SHA"))"

# 2. Build the release once per commit.
if [ ! -d "$RELEASES/$SHA" ]; then
  mkdir -p "$RELEASES"
  tmp="$RELEASES/.build-$SHA"
  rm -rf "$tmp"; mkdir -p "$tmp"
  git -C "$REPO" archive "$SHA" | tar -x -C "$tmp"
  log "npm ci (production dependencies)"
  (cd "$tmp" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  # Both canvas libraries are native; fail here, not after the restart.
  (cd "$tmp" && node --input-type=module -e '
    const { createCanvas } = await import("canvas");
    const napi = await import("@napi-rs/canvas");
    const a = createCanvas(8, 8); a.getContext("2d").fillRect(0, 0, 4, 4);
    const b = napi.createCanvas(8, 8); b.getContext("2d").fillRect(0, 0, 4, 4);
    if (!a.toBuffer("image/png").length || !(await b.encode("png")).length) throw new Error("empty PNG");
    console.log("[deploy] canvas + @napi-rs/canvas render OK");')
  echo "$SHA" > "$tmp/REVISION"
  mv -T "$tmp" "$RELEASES/$SHA"
else
  log "release $SHA already built"
fi

[ "$mode" = buildonly ] && { log "built $RELEASES/$SHA (current unchanged)"; exit 0; }

# 3. Switch and restart.
switch_to "$SHA"
if [ "$mode" = norestart ]; then
  log "--no-restart: $SERVICE keeps running the old code until its next restart"
else
  restart_and_wait
fi

# 4. Keep the newest $KEEP releases plus current and previous.
cur="$(basename "$(readlink "$ROOT/current")")"
prev="$(cat "$ROOT/previous" 2>/dev/null || true)"
ls -1t "$RELEASES" | grep -vE '^\.build-' | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$old" = "$cur" ] || [ "$old" = "$prev" ] || { log "pruning $old"; rm -rf "${RELEASES:?}/$old"; }
done
