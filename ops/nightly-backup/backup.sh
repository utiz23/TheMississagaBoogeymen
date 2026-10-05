#!/usr/bin/env bash
# One backup run. Steps:
#   1. dump the live database (compressed)
#   2. prove the dump restores: load it into a throwaway Postgres, count matches
#   3. keep it on the local backup disk (daily / weekly / monthly rotation)
#   4. upload it to Backblaze B2 (key limited to one bucket; B2 itself expires old copies)
#   5. check in with Healthchecks.io — a failed or missing check-in emails the owner
# Any failure stops the run and sends the log to Healthchecks.io.
#
# Run by hand:  docker compose exec backup backup.sh
set -uo pipefail

KEEP_DAILY=${KEEP_DAILY:-14}
KEEP_WEEKLY=${KEEP_WEEKLY:-8}
KEEP_MONTHLY=${KEEP_MONTHLY:-12}
BACKUP_DIR=/backups
# Created once during setup. If it's missing, the backup disk isn't really
# mounted (e.g. K: unplugged) and we'd be writing somewhere nobody looks.
TARGET_MARKER="$BACKUP_DIR/.eanhl-backup-target"
HC=${HC_PING_URL:-}

log() { echo "[$(date '+%F %T %Z')] $*"; }

hc() {
  [[ -n $HC ]] || return 0
  curl -fsS -m 15 --retry 3 -o /dev/null "$@" || log "warning: could not reach Healthchecks.io"
}

wait_for_db() {
  local _
  for _ in $(seq 1 24); do
    pg_isready -q && return 0
    sleep 5
  done
  log "the database at $PGHOST is not answering"
  return 1
}

# Restore the dump into a throwaway Postgres inside this container and check
# that it holds at least as many matches as the live database had.
verify_restore() {
  local dump=$1 expected=$2 work=$3 got
  local pgdata="$work/pg" sock="$work/sock"
  mkdir -p "$pgdata" "$sock"
  chown -R postgres:postgres "$work"
  # initdb chatters about missing locales on Alpine; show its output only if it fails.
  if ! su-exec postgres initdb -D "$pgdata" -U "$PGUSER" --auth=trust --no-locale \
    --encoding=UTF8 >"$work/initdb.log" 2>&1; then
    cat "$work/initdb.log"
    return 1
  fi
  su-exec postgres pg_ctl -D "$pgdata" -l "$work/restore-test.log" -w \
    -o "-k $sock -c listen_addresses=''" start >/dev/null
  createdb -h "$sock" -U "$PGUSER" "$PGDATABASE"
  pg_restore -h "$sock" -U "$PGUSER" -d "$PGDATABASE" --no-owner --exit-on-error "$dump"
  got=$(psql -h "$sock" -U "$PGUSER" -d "$PGDATABASE" -Atc 'select count(*) from matches')
  su-exec postgres pg_ctl -D "$pgdata" -m fast -w stop >/dev/null
  log "    restored copy has $got matches (live database had $expected)"
  if [[ $got -lt $expected || $got -eq 0 ]]; then
    log "the restored copy is missing matches"
    return 1
  fi
}

save_local() {
  local dump=$1 day=$2 dir
  for dir in daily weekly monthly; do mkdir -p "$BACKUP_DIR/$dir"; done
  place_copy "$dump" "$BACKUP_DIR/daily/eanhl-$day.dump"
  if [[ $(date +%u) == 7 ]]; then place_copy "$dump" "$BACKUP_DIR/weekly/eanhl-$day.dump"; fi
  if [[ $(date +%d) == 01 ]]; then place_copy "$dump" "$BACKUP_DIR/monthly/eanhl-$day.dump"; fi
  prune daily "$KEEP_DAILY"
  prune weekly "$KEEP_WEEKLY"
  prune monthly "$KEEP_MONTHLY"
}

# Windows drives (like K:) are locked for a moment while antivirus scans a
# freshly written file, so a copy or rename can fail with "Permission denied"
# for a few seconds. Copy to a temporary name, move it into place, and retry.
place_copy() {
  local src=$1 dst=$2 dir tmp try errors=/dev/null
  dir=$(dirname "$dst")
  for try in 1 2 3 4 5 6 7 8 9 10; do
    tmp="$dir/.$(basename "$dst").$$.$try.partial"
    if [[ $try -eq 10 ]]; then errors=/dev/stderr; fi # show the real error on the last try
    if cp "$src" "$tmp" 2>"$errors" && mv -f "$tmp" "$dst" 2>"$errors"; then
      rm -f "$dir"/.*.partial 2>/dev/null || true
      return 0
    fi
    sleep 3
  done
  log "could not write $dst after 10 attempts (error above)"
  return 1
}

# Keep the newest $2 files in folder $1 (file names sort by date). A file that
# can't be removed right now is left for the next run rather than failing this one.
prune() {
  find "$BACKUP_DIR/$1" -maxdepth 1 -name 'eanhl-*.dump' | sort -r | tail -n +$(($2 + 1)) |
    while read -r old; do
      if rm -f -- "$old"; then
        log "    removed old copy $(basename "$old")"
      else
        log "    could not remove old copy $(basename "$old") yet; will retry next run"
      fi
    done
}

# Upload with B2's native API. The key only needs permission to upload; B2
# checks the SHA-1 we send, so a corrupted upload is rejected, not stored.
upload_b2() {
  local file=$1 name=$2 auth api token bucket sha up attempt
  # Key passed on stdin (curl -K -), not the command line, so it never shows up
  # in the process list.
  auth=$(curl -fsS -m 30 --retry 3 -K - https://api.backblazeb2.com/b2api/v2/b2_authorize_account \
    <<<"user = \"$B2_KEY_ID:$B2_APP_KEY\"")
  api=$(jq -r '.apiUrl' <<<"$auth")
  token=$(jq -r '.authorizationToken' <<<"$auth")
  bucket=$(jq -r '.allowed.bucketId // empty' <<<"$auth")
  if [[ -z $bucket ]]; then
    log "the Backblaze key must be restricted to a single bucket"
    return 1
  fi
  sha=$(sha1sum "$file" | cut -d' ' -f1)
  for attempt in 1 2 3; do
    if up=$(curl -fsS -m 30 -H "Authorization: $token" -d "{\"bucketId\":\"$bucket\"}" \
      "$api/b2api/v2/b2_get_upload_url") &&
      curl -fsS -m 900 -o /dev/null -X POST -T "$file" \
        -H "Authorization: $(jq -r '.authorizationToken' <<<"$up")" \
        -H "X-Bz-File-Name: $name" \
        -H "Content-Type: application/octet-stream" \
        -H "X-Bz-Content-Sha1: $sha" \
        "$(jq -r '.uploadUrl' <<<"$up")"; then
      log "    uploaded as $name"
      return 0
    fi
    log "    upload attempt $attempt failed"
    sleep 15
  done
  return 1
}

run_backup() {
  local day stamp work dump live_matches
  : "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
  : "${B2_KEY_ID:?is not set in .env}" "${B2_APP_KEY:?is not set in .env}"
  if [[ ! -e $TARGET_MARKER ]]; then
    log "backup disk not found: $TARGET_MARKER is missing (is the drive connected?)"
    return 1
  fi
  day=$(date +%F)
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  # Leftovers from a run that was killed part-way (e.g. the PC shut down).
  find /var/lib/postgresql/data -maxdepth 1 -name 'run.*' -mmin +120 -exec rm -rf {} +
  work=$(mktemp -d /var/lib/postgresql/data/run.XXXXXX)
  # Always clean up, even if the test database is already stopped ("|| true":
  # errexit is still on inside this trap, so one failing command would skip the rm).
  # shellcheck disable=SC2064  # expand $work now: it's local to this function
  trap "su-exec postgres pg_ctl -D '$work/pg' -m immediate stop >/dev/null 2>&1 || true; rm -rf '$work'" EXIT
  dump="$work/eanhl.dump"

  log "1/5 dumping database '$PGDATABASE'"
  wait_for_db
  live_matches=$(psql -Atc 'select count(*) from matches')
  pg_dump -Fc -f "$dump"
  log "    $(du -h "$dump" | cut -f1) dump"

  log "2/5 test-restoring the dump"
  verify_restore "$dump" "$live_matches" "$work"

  log "3/5 saving to the backup disk"
  save_local "$dump" "$day"
  log "    saved daily/eanhl-$day.dump"

  log "4/5 uploading to Backblaze B2"
  upload_b2 "$dump" "eanhl/${stamp:0:4}/eanhl-$stamp.dump"

  log "5/5 backup complete"
}

LOG=$(mktemp)
hc "$HC/start"
# The subshell gets "stop at the first error"; this outer part must keep going
# so it can report the failure.
(
  set -euo pipefail
  run_backup
) 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}
if [[ $status -eq 0 ]]; then
  hc --data-binary "@$LOG" "$HC"
else
  log "BACKUP FAILED (exit code $status)" | tee -a "$LOG"
  tail -c 20000 "$LOG" | hc --data-binary @- "$HC/fail"
fi
rm -f "$LOG"
exit "$status"
