#!/usr/bin/env bash
# Tests for backup.sh: weekly/monthly copy rules, one date per run, one run at a time.
# Plain bash. No Docker, no database, no network. Everything happens in a temp
# folder made here; a real backup folder is never touched.
#
# Run:  bash ops/nightly-backup/test/backup.test.sh
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../backup.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Nothing from the real setup may leak in: no database, no keys, no ping URL.
unset PGHOST PGUSER PGPASSWORD PGDATABASE B2_KEY_ID B2_APP_KEY HC_PING_URL
unset BACKUP_DIR LOCK_FILE

pass=0
fail=0
ok() {
  pass=$((pass + 1))
  echo "  ok   $1"
}
bad() {
  fail=$((fail + 1))
  echo "  FAIL $1"
}
# check "name" <command...>: passes when the command succeeds.
check() {
  local name=$1
  shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}
eq() { [[ $1 == "$2" ]]; }

# A fresh backup folder for one test. Sets $B (the folder) and $DUMP (a fake dump).
new_dir() {
  B=$(mktemp -d "$TMP/b.XXXXXX")
  DUMP="$B/fake.dump"
  echo "dump" >"$DUMP"
}

# Run save_local for one pretend day, in a subshell, against folder $B.
# Sourcing backup.sh must not run a backup; if it does, the subshell dies and
# the test fails. BACKUP_DIR is set after sourcing, so it always wins.
run_day() {
  local day=$1 keep_d=${2:-14} keep_w=${3:-8} keep_m=${4:-12}
  (
    # shellcheck source=../backup.sh
    source "$SCRIPT" >/dev/null 2>&1 || exit 97
    BACKUP_DIR=$B
    KEEP_DAILY=$keep_d KEEP_WEEKLY=$keep_w KEEP_MONTHLY=$keep_m
    save_local "$DUMP" "$day" >/dev/null 2>&1
  )
}

names() { (cd "$B/$1" 2>/dev/null && ls -A | tr '\n' ' ' | sed 's/ $//'); }

# --- ISO week helper ---------------------------------------------------------
echo "iso_week matches GNU date"
iso_ok=1
for d in 2020-12-31 2021-01-01 2021-01-03 2021-01-04 2024-12-29 2024-12-30 2026-11-14 \
  2026-12-28 2026-12-31 2027-01-01 2027-01-03 2027-01-04 2026-01-01 2025-12-29 2028-02-29; do
  want=$(date -d "$d" +%G-W%V)
  got=$(
    source "$SCRIPT" >/dev/null 2>&1 || exit 97
    iso_week "$d"
  )
  if [[ $got != "$want" ]]; then
    iso_ok=0
    echo "       $d: got '$got', want '$want'"
  fi
done
check "iso_week agrees with date +%G-W%V on 15 edge dates" eq "$iso_ok" 1

# --- weekly ------------------------------------------------------------------
echo "weekly copies"
new_dir
run_day 2026-11-09 # Monday: first run of ISO week 46
check "first run of the week makes a weekly copy" eq "$(names weekly)" "eanhl-2026-11-09.dump"
run_day 2026-11-10
run_day 2026-11-14
run_day 2026-11-15 # Sunday, same ISO week
check "later runs in the same week add no weekly copy" eq "$(names weekly)" "eanhl-2026-11-09.dump"
run_day 2026-11-16 # next Monday
check "next week gets its own copy" eq "$(names weekly)" "eanhl-2026-11-09.dump eanhl-2026-11-16.dump"

new_dir
run_day 2026-11-11 # Sunday and Monday were missed; Wednesday is the first run
check "a week whose Sunday was missed still gets a copy" eq "$(names weekly)" "eanhl-2026-11-11.dump"

new_dir
mkdir -p "$B/weekly"
cp "$DUMP" "$B/weekly/eanhl-2026-11-01.dump" # old rule: a Sunday copy (ISO week 44)
run_day 2026-10-28                            # Wednesday of week 44
check "an old Sunday copy counts for its own week" eq "$(names weekly)" "eanhl-2026-11-01.dump"
run_day 2026-11-02 # Monday of week 45
check "...and the next week still gets a copy" eq "$(names weekly)" "eanhl-2026-11-01.dump eanhl-2026-11-02.dump"

# --- monthly -----------------------------------------------------------------
echo "monthly copies"
new_dir
run_day 2026-11-02 # the 1st was missed
check "a month whose 1st was missed still gets a copy" eq "$(names monthly)" "eanhl-2026-11-02.dump"
run_day 2026-11-03
run_day 2026-11-30
check "later runs in the same month add no monthly copy" eq "$(names monthly)" "eanhl-2026-11-02.dump"
run_day 2026-12-01
check "the next month gets its own copy" eq "$(names monthly)" "eanhl-2026-11-02.dump eanhl-2026-12-01.dump"

new_dir
mkdir -p "$B/monthly"
cp "$DUMP" "$B/monthly/eanhl-2026-11-01.dump" # old rule: a 1st-of-month copy
run_day 2026-11-15
check "an old 1st-of-month copy counts for its month" eq "$(names monthly)" "eanhl-2026-11-01.dump"

# --- year change -------------------------------------------------------------
echo "year change"
new_dir
# 2026 has 53 ISO weeks: 2026-12-28 .. 2027-01-03 is one week (2026-W53).
for d in 2026-12-28 2026-12-29 2026-12-31 2027-01-01 2027-01-03; do run_day "$d"; done
check "ISO week 53 spanning New Year gets one weekly copy" eq "$(names weekly)" "eanhl-2026-12-28.dump"
check "New Year's first run gets the January monthly copy" eq "$(names monthly)" "eanhl-2026-12-28.dump eanhl-2027-01-01.dump"
run_day 2027-01-04
check "ISO week 1 of 2027 gets its own weekly copy" eq "$(names weekly)" "eanhl-2026-12-28.dump eanhl-2027-01-04.dump"

new_dir
# 2021-01-01 is still in ISO week 2020-W53.
for d in 2020-12-31 2021-01-01 2021-01-03 2021-01-04; do run_day "$d"; done
check "2021-01-01 stays in the 2020-W53 week" eq "$(names weekly)" "eanhl-2020-12-31.dump eanhl-2021-01-04.dump"

# --- prune -------------------------------------------------------------------
echo "prune"
new_dir
# five Mondays, keep the newest 3 weekly; ten days, keep the newest 4 daily
for d in 2026-10-12 2026-10-19 2026-10-26 2026-11-02 2026-11-09; do run_day "$d" 4 3 12; done
check "weekly keeps only the newest 3" eq "$(names weekly)" "eanhl-2026-10-26.dump eanhl-2026-11-02.dump eanhl-2026-11-09.dump"
check "daily keeps only the newest 4" eq "$(names daily)" "eanhl-2026-10-19.dump eanhl-2026-10-26.dump eanhl-2026-11-02.dump eanhl-2026-11-09.dump"

# --- one date per run --------------------------------------------------------
echo "one date per run"
new_dir
mkdir -p "$B/weekly" "$B/monthly"
cp "$DUMP" "$B/weekly/eanhl-2026-11-10.dump"
cp "$DUMP" "$B/monthly/eanhl-2026-11-03.dump"
DATE_CALLS="$TMP/date-calls"
: >"$DATE_CALLS"
(
  source "$SCRIPT" >/dev/null 2>&1 || exit 97
  BACKUP_DIR=$B
  # A second date read after the dump must not matter. This fake date says
  # "Sunday, the 1st" and records every call except the log line's.
  date() {
    if [[ ${1:-} == "+%F %T %Z" ]]; then
      command date "$@"
    else
      echo "date $*" >>"$DATE_CALLS"
      case ${1:-} in +%u) echo 7 ;; +%d) echo 01 ;; *) echo 2099-01-01 ;; esac
    fi
  }
  save_local "$DUMP" 2026-11-11 >/dev/null 2>&1
)
check "save_local does not call date again" eq "$(wc -c <"$DATE_CALLS" | tr -d ' ')" 0
check "no extra weekly copy from a late Sunday read" eq "$(names weekly)" "eanhl-2026-11-10.dump"
check "no extra monthly copy from a late 1st read" eq "$(names monthly)" "eanhl-2026-11-03.dump"
check "the daily copy is named from the day passed in" eq "$(names daily)" "eanhl-2026-11-11.dump"

# --- place_copy and .partial files -------------------------------------------
echo "place_copy"
new_dir
mkdir -p "$B/daily"
# Another run's leftovers: a different process number in the name.
: >"$B/daily/.eanhl-2026-11-11.dump.1.1.partial"
: >"$B/daily/.eanhl-2026-11-10.dump.1.2.partial"
(
  source "$SCRIPT" >/dev/null 2>&1 || exit 97
  BACKUP_DIR=$B
  place_copy "$DUMP" "$B/daily/eanhl-2026-11-11.dump" >/dev/null 2>&1
)
check "the copy was placed" test -f "$B/daily/eanhl-2026-11-11.dump"
check "another run's .partial (same target) is left alone" test -e "$B/daily/.eanhl-2026-11-11.dump.1.1.partial"
check "another run's .partial (other target) is left alone" test -e "$B/daily/.eanhl-2026-11-10.dump.1.2.partial"
check "this run leaves no .partial of its own" eq "$(find "$B/daily" -name ".*.$$.*.partial" | wc -l | tr -d ' ')" 0

# --- one run at a time -------------------------------------------------------
echo "one run at a time"
STUBS="$TMP/stubs"
mkdir -p "$STUBS"
CURL_LOG="$TMP/curl.log"
# A stand-in curl: records the call, never goes to the network.
cat >"$STUBS/curl" <<STUB
#!/usr/bin/env bash
echo "curl \$*" >>"$CURL_LOG"
case "\$*" in *"@-"*) cat >/dev/null ;; esac
exit 0
STUB
chmod +x "$STUBS/curl"

new_dir
mkdir -p "$B/daily" "$B/weekly" "$B/monthly"
: >"$B/.eanhl-backup-target"
: >"$B/daily/.eanhl-2026-11-12.dump.1.1.partial"
cp "$DUMP" "$B/daily/eanhl-2026-11-12.dump"
LOCK="$TMP/lock"
snapshot() { (cd "$B" && find . -printf '%p %s %T@\n' | sort); }

# Hold the lock the way a running backup would.
flock "$LOCK" sleep 30 &
holder=$!
for _ in $(seq 1 50); do
  flock -n "$LOCK" true 2>/dev/null || break
  sleep 0.1
done
before=$(snapshot)
: >"$CURL_LOG"
out=$(PATH="$STUBS:$PATH" HC_PING_URL=https://hc.invalid/abc BACKUP_DIR=$B LOCK_FILE=$LOCK \
  bash "$SCRIPT" 2>&1 </dev/null)
status=$?
after=$(snapshot)
pkill -P "$holder" 2>/dev/null # the sleep inside flock holds the lock too
kill "$holder" 2>/dev/null
wait "$holder" 2>/dev/null

check "a second run exits non-zero" test "$status" -ne 0
check "it logs that another run is in progress" grep -q "another backup run is in progress; nothing done" <<<"$out"
check "it sends no Healthchecks.io ping" eq "$(wc -c <"$CURL_LOG" | tr -d ' ')" 0
check "it touches no backup files (incl. another run's .partial)" eq "$before" "$after"

# With the lock free, a run goes on: it pings start, then (no database here) fails and pings fail.
: >"$CURL_LOG"
out=$(PATH="$STUBS:$PATH" HC_PING_URL=https://hc.invalid/abc BACKUP_DIR=$B LOCK_FILE=$LOCK \
  bash "$SCRIPT" 2>&1 </dev/null)
status=$?
check "with the lock free, the run starts (start ping sent)" grep -q "hc.invalid/abc/start" "$CURL_LOG"
check "...and a failed run still reports (fail ping sent)" grep -q "hc.invalid/abc/fail" "$CURL_LOG"
check "...and exits non-zero" test "$status" -ne 0
check "...and does not say another run is in progress" bash -c '! grep -q "another backup run" <<<"$1"' _ "$out"

# --- result ------------------------------------------------------------------
echo
echo "passed: $pass  failed: $fail"
[[ $fail -eq 0 ]]
