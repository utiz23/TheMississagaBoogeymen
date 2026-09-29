#!/usr/bin/bash -p
# /usr/local/lib/eanhl-cloud/validation/eanhl-cloud-credential-probe.sh <scope>:<mode>
# E3J9 validation-only probe (design §11). Install root:root 0755. Removed from
# the host after E3J9E (D8).
#
# Started through the wrapper as the scrubbed credential command. The argument
# is `local:<mode>` or `provider:<mode>`, each a closed set:
#
#   local: (only via `eanhl-cloud-credential probe <mode>`, a PrivateNetwork
#   transient unit; the launcher always prefixes `local:`)
#     precheck             identity, environment, pass identity, tty/opener
#                          absence; no key or store needed (A3, A4, E1, E2)
#     local                precheck + store state + canary (L1/A5) + A10 absent
#                          entry + pinentry/fallback/log/CLI-pin metadata
#     canary               canary only (K3)
#     canary-a, canary-b   canary only, for two concurrent units (K6)
#     neg-uninit           A10: `pass insert` against a private empty store
#     lockhold-hold        exec lockhold: canary, then a 20 s hold (K1, E3 obs.)
#     lockhold-long        exec lockhold: canary, then a 120 s hold (K4, K5)
#     lockhold-detach      exec lockhold: leave a detached descendant (K2)
#     busy-a … busy-d      must never acquire the lock (K1); fails if it does
#     canary-nested        lockhold's internal canary; not launcher-startable
#   provider: (only via `eanhl-cloud-credential provider-probe`, E3J9D/E3J9E,
#   each use under its own authorization; the launcher builds a fresh
#   PrivateNetwork=no unit whose argument is always provider:<mode> from its
#   closed table. There is no provider unit file and no other provider path.)
#     provider, provider-freshcache, neg-nokey, neg-nostore
#                          execute the Proton CLI
#     e4-decoy             E4/N4: the parent unit carries the launcher's fixed
#                          decoys; proves they reached the wrapper (the flock
#                          parent) but not this child, that both private marker
#                          directories stay empty, and that the CLI still
#                          answers `ok` (it executes the Proton CLI)
#
# Output: only lines matching ^E3J9 [a-z_]+=[a-z0-9_.:-]+$. The first line is
# always `probe_mode=<mode>` and exactly one `probe_result=` line is printed
# (lockhold prints it for the lockhold modes); canary-nested prints canary_*
# lines and `canary_result=` instead. Stderr of pass, gpg and the CLI goes to
# files in the unit's private /tmp, is only searched for fixed anchors, and is
# deleted. Canary plaintext is random, held in memory, compared in memory and
# never printed. Log contents are never read. A tool failure behind any count
# prints `invalid` and counts as a failure: a failed scan never reads as 0.

mapfile -d '' -t INIT_ENV </proc/self/environ
set -u
umask 077

readonly VALIDATION_DIR=/usr/local/lib/eanhl-cloud/validation
readonly ENV_INSPECT=$VALIDATION_DIR/env-inspect
readonly LOCKHOLD=$VALIDATION_DIR/lockhold
readonly SVC_HOME=/var/lib/eanhl-cloud
readonly SVC_CACHE=/var/cache/eanhl-cloud
readonly STORE=/var/lib/eanhl-cloud/password-store
readonly PASS_ABS=/opt/eanhl-cloud/credential-bin/pass
readonly PASS_TARGET=/usr/bin/pass
readonly PASS_SHA256=b0da432e8d377a67c7a74a9111c6b32889cce62f6e4f506a7bbdba817a268632
readonly PASS_EXT_DIR=/usr/lib/password-store/extensions
readonly CLI=/opt/eanhl-cloud/bin/proton-drive
readonly CLI_PIN=cf61c2688c45e1055d8add6221d9471a5a5b64bf3bcdb86460f5cb18414596cc4df3cdb6627c9097c94bec32a3c9915ada3211ef2ae5be33c46ebbc996ccaa28
readonly ENTRY=$STORE/ch.proton.drive/drive-sdk-cli/auth-session.gpg
readonly LOG_DIR=$SVC_HOME/.local/state/proton-drive-cli
readonly CANARY_ENTRY=e3j9-canary/probe
readonly PROC_ROOT=/proc
# E4/N4 (e4-decoy): the launcher's fixed decoy set. The two directories are
# created by this probe inside the unit's private /tmp; the values must equal
# the launcher's E4_* constants.
readonly E4_PDCACHE=/tmp/e3j9-e4-pdcache
readonly E4_XDGCACHE=/tmp/e3j9-e4-xdgcache
readonly E4_BASE_URL=http://127.0.0.1:9
readonly E4_NONCE_RE='^e3j9nonce[0-9a-f]{32}$'

# Must equal ops/backup/credential/credential-child-env.manifest. Used only to
# rebuild a validation-only secondary environment with exactly one directory
# value replaced (§11 test isolation).
readonly CREDENTIAL_ENV=(
  PATH=/opt/eanhl-cloud/credential-bin
  HOME=/var/lib/eanhl-cloud
  XDG_CONFIG_HOME=/var/lib/eanhl-cloud/config
  XDG_DATA_HOME=/var/lib/eanhl-cloud/data
  XDG_CACHE_HOME=/var/cache/eanhl-cloud
  GNUPGHOME=/var/lib/eanhl-cloud/gnupg
  PASSWORD_STORE_DIR=/var/lib/eanhl-cloud/password-store
  LANG=C.UTF-8
  LC_ALL=C.UTF-8
  TMPDIR=/tmp
  PROTON_DRIVE_CREDENTIALS_STORE=pass
  PROTON_DRIVE_LOG_LEVEL=ERROR
)

readonly OPENER_NAMES=(
  xdg-open sensible-browser x-www-browser www-browser gio gnome-open kde-open
  kde-open5 kde-open6 kioclient kioclient5 kioclient6 exo-open w3m lynx links
  elinks firefox chromium chromium-browser google-chrome google-chrome-stable
)
readonly OPENER_PATTERN='^(xdg-open|sensible-browser|x-www-browser|www-browser|gio|gnome-open|kde-open.*|kioclient.*|exo-open|w3m|lynx|links|elinks|firefox|chromium.*|google-chrome.*)$'

FAILURES=0
T=
NESTED=0

emit() { # emit <name> <value>; a value outside the vocabulary prints as `invalid`
  local value=$2
  [[ $value =~ ^[a-z0-9_.:-]+$ ]] || value=invalid
  printf 'E3J9 %s=%s\n' "$1" "$value"
}
tf() { if "$@"; then printf true; else printf false; fi; }
expect() { # expect <name> <expected> <actual>
  emit "$1" "$3"
  [ "$2" = "$3" ] || FAILURES=$((FAILURES + 1))
}
emit_count() { # emit_count <name> <value>; `invalid` (a failed scan) is a failure
  emit "$1" "$2"
  [[ $2 =~ ^[0-9]+$ ]] || FAILURES=$((FAILURES + 1))
}

arg=${1-}
scope=${arg%%:*}
mode=${arg#*:}
case "$scope:$mode" in
  local:precheck | local:local | local:canary | local:canary-a | local:canary-b | local:neg-uninit) ;;
  local:canary-nested) NESTED=1 ;;
  local:lockhold-hold)
    emit probe_mode "$mode"
    exec "$LOCKHOLD" hold 20
    ;;
  local:lockhold-long)
    emit probe_mode "$mode"
    exec "$LOCKHOLD" hold 120
    ;;
  local:lockhold-detach)
    emit probe_mode "$mode"
    exec "$LOCKHOLD" detach
    ;;
  local:busy-a | local:busy-b | local:busy-c | local:busy-d)
    emit probe_mode "$mode"
    exec "$LOCKHOLD" busy
    ;;
  provider:provider | provider:provider-freshcache | provider:neg-nokey | provider:neg-nostore | provider:e4-decoy) ;;
  *)
    emit mode_refused true
    exit 64
    ;;
esac

[ "$(/usr/bin/id -un)" = eanhl-cloud ] || exit 64

T=$(/usr/bin/mktemp -d /tmp/e3j9-probe.XXXXXXXX) || {
  emit probe_tmp_ok false
  exit 1
}
trap '/usr/bin/rm -rf -- "$T"' EXIT

# ── helpers ────────────────────────────────────────────────────────────────

is_svc() { [ "$(/usr/bin/id -un)" = eanhl-cloud ]; }
groups_only_primary() { [ "$(/usr/bin/id -G)" = "$(/usr/bin/id -g)" ]; }
stdin_is_tty() { [ -t 0 ]; }
run_user_absent() { [ ! -e "/run/user/$(/usr/bin/id -u)" ]; }
cmd_absent() { ! command -v "$1" >/dev/null 2>&1; }
all_openers_absent() {
  local name
  for name in "${OPENER_NAMES[@]}"; do
    cmd_absent "$name" || return 1
  done
  [ "$(compgen -c | /usr/bin/grep -c -E "$OPENER_PATTERN")" = 0 ]
}

# Exact accepted identity of the installed pass (design §3): the curated link
# resolves to /usr/bin/pass, a regular root-owned file with the accepted hash.
pass_script_sha256_match() {
  [ "$(/usr/bin/readlink -f -- "$PASS_ABS" 2>/dev/null)" = "$PASS_TARGET" ] || return 1
  [ -f "$PASS_TARGET" ] && [ ! -L "$PASS_TARGET" ] || return 1
  [ "$(/usr/bin/stat -c '%U:%G %a' -- "$PASS_TARGET" 2>/dev/null)" = "root:root 755" ] || return 1
  [ "$(/usr/bin/sha256sum -- "$PASS_TARGET" 2>/dev/null | /usr/bin/cut -d ' ' -f 1)" = "$PASS_SHA256" ]
}
# The Debian system-extension directory (hunk H7) is root-owned, not group or
# world writable, and empty.
pass_system_ext_dir_empty() {
  local meta out
  meta=$(/usr/bin/stat -c '%F %U:%G %A' -- "$PASS_EXT_DIR" 2>/dev/null) || return 1
  case "$meta" in
    'directory root:root d'????-??-?) ;; # %A: no group (6th) or other (9th) write bit
    *) return 1 ;;
  esac
  out=$(/usr/bin/find "$PASS_EXT_DIR" -mindepth 1 -print 2>/dev/null) || return 1
  [ -z "$out" ]
}

# count_find <find-args...>: number of printed paths, or `invalid` if find fails.
count_find() {
  local out lines=()
  out=$(/usr/bin/find "$@" -print 2>/dev/null) || {
    printf invalid
    return
  }
  if [ -z "$out" ]; then
    printf 0
  else
    mapfile -t lines <<<"$out"
    printf '%s' "${#lines[@]}"
  fi
}
# pgrep_count <pgrep-args...>: pgrep exits 1 on "none" (count 0), >1 on error.
pgrep_count() {
  local n rc
  n=$(/usr/bin/pgrep -c "$@" 2>/dev/null)
  rc=$?
  if [ "$rc" -le 1 ] && [[ $n =~ ^[0-9]+$ ]]; then printf '%s' "$n"; else printf invalid; fi
}
agent_count() { pgrep_count -u eanhl-cloud -x gpg-agent; }
pinentry_count() { pgrep_count pinentry; }
human_sessions() {
  local out
  out=$(/usr/bin/loginctl list-sessions --no-legend 2>/dev/null) || {
    printf invalid
    return
  }
  printf '%s\n' "$out" \
    | /usr/bin/awk '$6 == "user" || $6 == "user-early" || $6 == "user-incomplete" { n++ } END { print n + 0 }'
}
cli_pin_match() {
  [ -f "$CLI" ] && [ "$(/usr/bin/sha512sum -- "$CLI" 2>/dev/null | /usr/bin/cut -d ' ' -f 1)" = "$CLI_PIN" ]
}
anchor_in() { /usr/bin/grep -q -F -- "$1" "$2" 2>/dev/null; }

# A validation-only secondary process: the twelve literals with exactly ONE
# directory value replaced by a directory inside this probe's private /tmp.
secondary() { # secondary <GNUPGHOME|PASSWORD_STORE_DIR|XDG_CACHE_HOME> <dir> <cmd> [args...]
  local var=$1 dir=$2 entry
  local out=()
  shift 2
  case "$var" in GNUPGHOME | PASSWORD_STORE_DIR | XDG_CACHE_HOME) ;; *) return 64 ;; esac
  case "$dir" in "$T"/*) ;; *) return 64 ;; esac
  case "/$dir/" in */../* | */./*) return 64 ;; esac
  for entry in "${CREDENTIAL_ENV[@]}"; do
    if [ "${entry%%=*}" = "$var" ]; then out+=("$var=$dir"); else out+=("$entry"); fi
  done
  /usr/bin/env -i "${out[@]}" "$@"
}

# ── check groups ───────────────────────────────────────────────────────────

check_environment() { # check_environment exact|descendant
  if [ "$1" = exact ]; then
    printf '%s\0' "${INIT_ENV[@]}" | "$ENV_INSPECT" stdin-boundary || FAILURES=$((FAILURES + 1))
  else
    printf '%s\0' "${INIT_ENV[@]}" | "$ENV_INSPECT" stdin-descendant || FAILURES=$((FAILURES + 1))
  fi
  "$ENV_INSPECT" descendant || FAILURES=$((FAILURES + 1))
}

check_identity() {
  expect identity_is_svc true "$(tf is_svc)"
  expect groups_only_primary true "$(tf groups_only_primary)"
  expect stdin_is_tty false "$(tf stdin_is_tty)"
  expect run_user_absent true "$(tf run_user_absent)"
  emit_count human_sessions "$(human_sessions)"
  emit_count gpg_agent_count_at_start "$(agent_count)"
}

check_commands() {
  # Emitted name has no digits: the launcher's vocabulary is ^E3J9 [a-z_]+=…
  # (E3J9C §19.6). The function keeps its accurate SHA-256 name; it is not emitted.
  expect pass_script_hash_match true "$(tf pass_script_sha256_match)"
  expect pass_system_ext_dir_empty true "$(tf pass_system_ext_dir_empty)"
  expect tty_absent true "$(tf cmd_absent tty)"
  expect xdg_open_absent true "$(tf cmd_absent xdg-open)"
  expect openers_absent true "$(tf all_openers_absent)"
}

check_store_state() {
  emit store_gpg_id_present "$(tf test -f "$STORE/.gpg-id")"
  emit_count store_other_entry_count "$(count_find "$STORE" -mindepth 1 ! -path "$STORE/.gpg-id")"
}

check_metadata() {
  if [ -e "$ENTRY" ]; then
    emit entry_present true
    emit entry_mode "$(/usr/bin/stat -c %a -- "$ENTRY")"
    emit entry_size "$(/usr/bin/stat -c %s -- "$ENTRY")"
    emit entry_mtime "$(/usr/bin/stat -c %Y -- "$ENTRY")"
  else
    emit entry_present false
  fi
  expect fallback_file_count 0 "$(count_find "$SVC_HOME" "$SVC_CACHE" -name auth-session.json)"
  if [ -d "$LOG_DIR" ]; then
    emit_count log_count "$(count_find "$LOG_DIR" -maxdepth 1 -type f -name 'proton-drive.log*')"
    expect log_nonprivate_count 0 "$(count_find "$LOG_DIR" -maxdepth 1 -type f -name 'proton-drive.log*' -perm /077)"
  else
    emit log_count 0
  fi
  emit cli_present "$(tf test -f "$CLI")"
  if [ -f "$CLI" ]; then expect cli_pin_match true "$(tf cli_pin_match)"; fi
}

check_pinentry_and_cmds() {
  expect pinentry_count 0 "$(pinentry_count)"
  local hits=0
  if compgen -G "$T/*.err" >/dev/null; then
    hits=$(count_find "$T" -maxdepth 1 -name '*.err' -exec /usr/bin/grep -q -F 'command not found' {} \;)
  fi
  expect pass_cmd_not_found false "$(tf test "$hits" != 0)"
}

# L1 / A5: random content → insert → show → compare in memory → rm -f → absence.
# Line prefix: `canary_` in every mode.
run_canary() {
  local c got rc_ins rc_show rc_rm match=false
  c=$(/usr/bin/head -c 48 /dev/urandom | /usr/bin/base64 -w 0)
  printf '%s\n' "$c" | /usr/bin/timeout 60 pass insert -f -m "$CANARY_ENTRY" >/dev/null 2>"$T/canary-insert.err"
  rc_ins=$?
  expect canary_pinentry_count 0 "$(pinentry_count)"
  got=$(/usr/bin/timeout 60 pass show "$CANARY_ENTRY" 2>"$T/canary-show.err" </dev/null)
  rc_show=$?
  if [ "$rc_ins" = 0 ] && [ "$rc_show" = 0 ] && [ -n "$c" ] && [ "$got" = "$c" ]; then match=true; fi
  unset c got
  /usr/bin/timeout 60 pass rm -f "$CANARY_ENTRY" >/dev/null 2>"$T/canary-rm.err" </dev/null
  rc_rm=$?
  expect canary_insert_rc 0 "$rc_ins"
  expect canary_show_rc 0 "$rc_show"
  expect canary_match true "$match"
  expect canary_rm_rc 0 "$rc_rm"
  expect canary_removed true "$(tf test ! -e "$STORE/$CANARY_ENTRY.gpg" -a ! -e "$STORE/${CANARY_ENTRY%/*}")"
}

# A10 (primary store): an absent entry fails with pass's own anchor.
run_absent_entry() {
  /usr/bin/timeout 60 pass show e3j9-absent >/dev/null 2>"$T/absent.err" </dev/null
  local rc=$?
  expect absent_show_rc_nonzero true "$(tf test "$rc" -ne 0)"
  expect absent_anchor_present true "$(tf anchor_in 'is not in the password store' "$T/absent.err")"
}

# A10 (neg-uninit): a private empty store without .gpg-id refuses, via `cat`
# (this error path prints pass's usage text, hunk H2: text only).
run_neg_uninit() {
  local d="$T/uninit-store" rc
  /usr/bin/mkdir -m 0700 -- "$d" || return 1
  printf 'e3j9\n' | secondary PASSWORD_STORE_DIR "$d" /usr/bin/timeout 60 "$PASS_ABS" insert -f -m e3j9-neg/probe >/dev/null 2>"$T/uninit.err"
  rc=$?
  expect uninit_insert_rc_nonzero true "$(tf test "$rc" -ne 0)"
  expect uninit_anchor_present true "$(tf anchor_in 'You must run' "$T/uninit.err")"
}

# E3J9D/E3J9E only. Maps the CLI outcome to a closed label; stderr never leaves.
# The anchors are PROVISIONAL hypotheses (design §0.8, §11): replace them from
# E3J9E evidence. Unmatched text stays `other`, which fails the expectation.
run_provider() { # run_provider <expected-label> [VAR DIR]
  local expected=$1 rc label err="$T/provider.err"
  shift
  if ! cli_pin_match; then
    expect cli_pin_match true false
    expect provider_result "$expected" other
    return
  fi
  if [ "$#" -eq 2 ]; then
    secondary "$1" "$2" /usr/bin/timeout 120 "$CLI" filesystem info /my-files </dev/null >/dev/null 2>"$err"
  else
    /usr/bin/env -i "${CREDENTIAL_ENV[@]}" /usr/bin/timeout 120 "$CLI" filesystem info /my-files </dev/null >/dev/null 2>"$err"
  fi
  rc=$?
  if [ "$rc" = 0 ]; then
    label=ok
  elif [ "$rc" = 124 ]; then
    label=timeout
  elif anchor_in 'You need to login first' "$err"; then
    label=login_required
  elif anchor_in 'decryption failed' "$err" || anchor_in 'No secret key' "$err"; then
    label=pass_load_failed
  else
    label=other
  fi
  emit provider_rc "$rc"
  expect provider_result "$expected" "$label"
}

# E4/N4: the fixed decoys reached the wrapper's environment. This probe's
# parent is the wrapper-exec'd flock, which keeps the wrapper's environment
# (the relationship env-inspect's boundary mode proved on the host). The read
# is limited to /proc/<this probe's PPID>/environ; names and values are
# compared in memory, the array is unset straight after the check, and only
# booleans and a count leave this function (never a name, value or byte).
check_decoy_parent() {
  local comm='' readable=false count=0 exact=true entry name value n
  local pd=0 xdg=0 url=0 nonce=0
  local -a parent=()
  IFS= read -r comm 2>/dev/null <"$PROC_ROOT/$PPID/comm"
  expect decoy_parent_is_flock true "$(tf test "$comm" = flock)"
  if mapfile -d '' -t parent 2>/dev/null <"$PROC_ROOT/$PPID/environ" && [ "${#parent[@]}" -gt 0 ]; then
    readable=true
  fi
  for entry in "${parent[@]}"; do
    name=${entry%%=*}
    value=${entry#*=}
    case "$name" in
      PROTON_DRIVE_CACHE_DIR)
        pd=$((pd + 1))
        [ "$value" = "$E4_PDCACHE" ] || exact=false
        ;;
      XDG_CACHE_HOME)
        xdg=$((xdg + 1))
        [ "$value" = "$E4_XDGCACHE" ] || exact=false
        ;;
      PROTON_DRIVE_BASE_URL)
        url=$((url + 1))
        [ "$value" = "$E4_BASE_URL" ] || exact=false
        ;;
      E3J9_INJECTED)
        nonce=$((nonce + 1))
        [[ $value =~ $E4_NONCE_RE ]] || exact=false
        ;;
    esac
  done
  unset parent entry name value
  expect decoy_parent_env_readable true "$readable"
  for n in "$pd" "$xdg" "$url" "$nonce"; do
    [ "$n" -eq 0 ] || count=$((count + 1))
    [ "$n" -le 1 ] || exact=false
  done
  [ "$count" -eq 4 ] || exact=false
  expect decoy_parent_decoy_count 4 "$count"
  expect decoy_parent_values_exact true "$exact"
}

# E4/N4: both marker directories are new (no -p: a pre-existing path fails).
make_e4_markers() {
  /usr/bin/mkdir -m 0700 -- "$E4_PDCACHE" 2>/dev/null && /usr/bin/mkdir -m 0700 -- "$E4_XDGCACHE" 2>/dev/null
}

finish() {
  if [ "$NESTED" -eq 1 ]; then
    emit canary_failures "$FAILURES"
    if [ "$FAILURES" -eq 0 ]; then
      emit canary_result pass
      exit 0
    fi
    emit canary_result fail
    exit 1
  fi
  emit probe_failures "$FAILURES"
  if [ "$FAILURES" -eq 0 ]; then
    emit probe_result pass
    exit 0
  fi
  emit probe_result fail
  exit 1
}

# ── modes ──────────────────────────────────────────────────────────────────

[ "$NESTED" -eq 1 ] || emit probe_mode "$mode"
case "$mode" in
  precheck)
    check_environment exact
    check_identity
    check_commands
    ;;
  local)
    check_environment exact
    check_identity
    check_commands
    check_store_state
    run_canary
    run_absent_entry
    check_store_state
    check_metadata
    ;;
  canary | canary-a | canary-b | canary-nested)
    check_environment descendant
    run_canary
    ;;
  neg-uninit)
    check_environment exact
    check_commands
    run_neg_uninit
    ;;
  provider)
    check_environment exact
    check_identity
    check_metadata
    run_provider ok
    check_metadata
    ;;
  provider-freshcache)
    check_environment exact
    check_identity
    /usr/bin/mkdir -m 0700 -- "$T/freshcache"
    run_provider ok XDG_CACHE_HOME "$T/freshcache"
    emit_count freshcache_entry_count "$(count_find "$T/freshcache" -mindepth 1)"
    ;;
  neg-nokey)
    check_environment exact
    /usr/bin/mkdir -m 0700 -- "$T/nokey"
    run_provider pass_load_failed GNUPGHOME "$T/nokey"
    check_metadata
    ;;
  neg-nostore)
    check_environment exact
    /usr/bin/mkdir -m 0700 -- "$T/nostore"
    run_provider login_required PASSWORD_STORE_DIR "$T/nostore"
    check_metadata
    ;;
  e4-decoy)
    check_environment exact
    check_identity
    check_decoy_parent
    # Emitted names carry no digit: the launcher's vocabulary is ^E3J9 [a-z_]+=…
    expect decoy_marker_dirs_created true "$(tf make_e4_markers)"
    check_metadata
    run_provider ok
    expect decoy_pdcache_entry_count 0 "$(count_find "$E4_PDCACHE" -mindepth 1)"
    expect decoy_xdgcache_entry_count 0 "$(count_find "$E4_XDGCACHE" -mindepth 1)"
    check_metadata
    ;;
esac
check_pinentry_and_cmds
finish
