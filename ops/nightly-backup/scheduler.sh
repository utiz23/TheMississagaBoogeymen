#!/usr/bin/env bash
# Keeps the backup container alive and runs backup.sh once a day at BACKUP_TIME
# (local time in TZ). If the machine was off at that time, the backup runs as
# soon as the container is up again that day — so every restart of the
# container also triggers a run, which is harmless (it just refreshes today's
# copy). A failed run is not retried automatically: Healthchecks.io emails
# instead, and it can be rerun by hand (see README.md).
set -uo pipefail

trap 'echo "[scheduler] stopping"; exit 0' TERM INT

time=${BACKUP_TIME:-03:00}
target=$((10#${time/:/}))
last_run_day=""
echo "[scheduler] daily backup at $time (${TZ:-UTC}); now $(date '+%F %T %Z')"

while true; do
  today=$(date +%F)
  now=$((10#$(date +%H%M)))
  if [[ $today != "$last_run_day" && $now -ge $target ]]; then
    last_run_day=$today
    backup.sh || true
  fi
  sleep 60 &
  wait $!
done
