#!/usr/bin/bash
# Deterministic LOCAL tests for the E3J9 credential templates (E3J9C-R).
#
#   E3J9_PASS_UPSTREAM=<password-store 1.7.4 script> \
#   E3J9_PASS_INSTALLED=<Ubuntu pass 1.7.4-8 /usr/bin/pass copy> \
#     bash ops/backup/credential/test/credential-templates.test.sh
#
#   bash ops/backup/credential/test/credential-templates.test.sh --static-only
#     (no pass inputs: the accepted-delta checks are reported as NOT RUN, never
#     as passed; this mode does not satisfy the E3J9C-R verification step)
#
# Standalone: not part of ops/backup/run-suite.mjs. Needs bash, the real
# /usr/bin/flock and /usr/bin/env, GNU diffutils, setsid and timeout. It never
# uses sudo, systemctl, systemd-run, journalctl, gpg or pass: systemd, journal,
# setpriv, pgrep and /proc are stubs inside a temporary sandbox, and templates
# are exercised through sed-substituted copies.
#
# What these tests prove: template construction and logic on this machine. What
# they do NOT prove: any Hotel-Echo behaviour (units, uutils, GnuPG, systemd
# 259), dynamic-loader (LD_*) isolation, or protection against code already
# running as eanhl-cloud. The startup-injection test covers Bash's own startup
# mechanisms (BASH_ENV, imported functions) only.
#
# Mutation checks: each named check is re-run against a deliberately weakened
# copy of the template and must FAIL there, proving the check is sensitive.
set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
C=$(cd "$HERE/.." && pwd)
V=$C/validation
REPO=$(cd "$C/../../.." && pwd)
WRAPPER_SRC=$C/credential-exec
LAUNCHER_SRC=$C/eanhl-cloud-credential
PROBE_SRC=$V/eanhl-cloud-credential-probe.sh
INSPECT_SRC=$V/env-inspect
LOCKHOLD_SRC=$V/lockhold
OINV_SRC=$V/owned-inventory
PTY_SRC=$V/pty-marker
DELTA_SRC=$C/pass-1.7.4-8.accepted-delta.escaped

MODE=full
case "${1-}" in
  '') ;;
  --static-only) MODE=static ;;
  *)
    echo "usage: $0 [--static-only]" >&2
    exit 2
    ;;
esac
if [ "$MODE" = full ]; then
  if [ ! -f "${E3J9_PASS_UPSTREAM-}" ] || [ ! -f "${E3J9_PASS_INSTALLED-}" ]; then
    echo "full mode needs E3J9_PASS_UPSTREAM and E3J9_PASS_INSTALLED (or --static-only)" >&2
    exit 2
  fi
fi

W=$(cd -P "$(mktemp -d)" && pwd)
BG_PIDS=()
cleanup() {
  local p
  for p in "${BG_PIDS[@]}"; do kill "$p" 2>/dev/null; done
  chmod -R u+rwx "$W" 2>/dev/null
  rm -rf "$W"
}
trap cleanup EXIT

pass=0 fail=0 killed=0 survived=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; }
t() { local name=$1; shift; if "$@"; then ok "$name"; else no "$name"; fi; }
not() { ! "$@"; }
VOCAB='^E3J9 [a-z_]+=[a-z0-9_.:-]+$'
vocab_only() { ! printf '%s\n' "$1" | grep -v -E "$VOCAB" | grep -q .; }
ME=$(id -un)
MYGRP=$(id -gn)
MYUID=$(id -u)
MYGID=$(id -g)

# mutant <src> <dst> <sed-script>: write a weakened copy; fail if unchanged.
mutant() {
  sed -e "$3" "$1" >"$2"
  chmod +x "$2"
  ! cmp -s "$1" "$2"
}
# killed_if <name> <check-fn> <args...>: the check must FAIL on the mutant.
killed_if() {
  local name=$1
  shift
  if "$@"; then
    survived=$((survived + 1))
    fail=$((fail + 1))
    printf 'FAIL mutation survived: %s\n' "$name"
  else
    killed=$((killed + 1))
    printf 'ok   mutation killed: %s\n' "$name"
  fi
}
# mutation <name> <src> <sed-script> <check-fn> [args...]: the check runs with
# the mutant path as its first argument.
mutation() {
  local name=$1 src=$2 script=$3 dst
  shift 3
  dst=$W/mut-$((killed + survived))-$(basename "$src")
  if ! mutant "$src" "$dst" "$script"; then
    fail=$((fail + 1))
    printf 'FAIL mutation not applied: %s\n' "$name"
    return
  fi
  local fn=$1
  shift
  killed_if "$name" "$fn" "$dst" "$@"
}

manifest=$(grep -v -E '^(#|$)' "$C/credential-child-env.manifest")

# ── 1. static construction ─────────────────────────────────────────────────
for f in "$WRAPPER_SRC" "$LAUNCHER_SRC" "$PROBE_SRC" "$INSPECT_SRC" "$LOCKHOLD_SRC" "$OINV_SRC" "$PTY_SRC"; do
  t "shebang is '#!/usr/bin/bash -p': ${f#"$C/"}" test "$(head -1 "$f")" = '#!/usr/bin/bash -p'
done
wrapper_lits=$(sed -n '/\/usr\/bin\/env -i \\/,/"\$command_path"/p' "$WRAPPER_SRC" | sed -E 's/^ +//; s/ \\$//' | grep -E '^[A-Z_]+=')
inspect_lits=$(sed -n '/^readonly CREDENTIAL_ENV=(/,/^)/p' "$INSPECT_SRC" | sed -E 's/^ +//' | grep -E '^[A-Z_]+=')
probe_lits=$(sed -n '/^readonly CREDENTIAL_ENV=(/,/^)/p' "$PROBE_SRC" | sed -E 's/^ +//' | grep -E '^[A-Z_]+=')
t "manifest has exactly 12 literals" test "$(printf '%s\n' "$manifest" | wc -l)" -eq 12
t "wrapper literals == manifest (order)" test "$wrapper_lits" = "$manifest"
t "env-inspect literals == manifest (order)" test "$inspect_lits" = "$manifest"
t "probe literals == manifest (order)" test "$probe_lits" = "$manifest"
t "manifest names unique" test "$(printf '%s\n' "$manifest" | cut -d= -f1 | sort -u | wc -l)" -eq 12
core_allow=$(sed -n '/^const ENV_ALLOWLIST = Object.freeze(\[/,/\])/p' "$REPO/ops/backup/lib/internal/backup-cloud-cli-core.mjs" | grep -oE "'[A-Z_]+'" | tr -d "'")
subset=0
for n in $(printf '%s\n' "$manifest" | cut -d= -f1); do
  case "$n" in PROTON_DRIVE_CREDENTIALS_STORE | PROTON_DRIVE_LOG_LEVEL) continue ;; esac
  printf '%s\n' "$core_allow" | grep -q -x -- "$n" || subset=1
done
t "manifest names ⊆ ENV_ALLOWLIST ∪ two PROTON_DRIVE_* (read from core)" test "$subset" -eq 0
t "wrapper execs command-form flock --close" grep -q -E '^exec /usr/bin/flock --exclusive --close "\$lockmode" --conflict-exit-code 75 "\$LOCK_FILE" \\$' "$WRAPPER_SRC"
t "wrapper has no --no-fork / -F in code" bash -c "! grep -v '^#' '$WRAPPER_SRC' | grep -q -E -- '--no-fork|flock[^|]* -F'"
t "wrapper uses /usr/bin/env -i exactly once (code)" test "$(grep -v '^#' "$WRAPPER_SRC" | grep -c -F '/usr/bin/env -i')" -eq 1
t "wrapper literal lines contain no expansion" bash -c "! printf '%s\n' \"\$1\" | grep -q '[\$\`]'" _ "$wrapper_lits"
t "wrapper checks the lock file before flock" grep -q -F 'if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then' "$WRAPPER_SRC"
t "credential-bin manifest: 12 links, no uname/cut/tr/tty/tree" bash -c "
  lines=\$(grep -v -E '^(#|\$)' '$C/credential-bin.manifest'); [ \"\$(printf '%s\n' \"\$lines\" | wc -l)\" -eq 12 ] &&
  ! printf '%s\n' \"\$lines\" | grep -q -E '^(uname|cut|tr|tty|tree|which|git|xdg-open) '"

# Units: local transient props vs the provider properties. (E3J9D-R: the
# provider unit template is deleted; its assertions are replaced by the same
# assertions on PROVIDER_UNIT_PROPS and, in §10, on the rendered boot pair.)
base_props=$(sed -n '/^readonly BASE_PROPS=(/,/^)/p' "$LAUNCHER_SRC")
local_props=$(sed -n '/^readonly LOCAL_PROPS=(/,/^)/p' "$LAUNCHER_SRC")
provider_props=$(sed -n '/^readonly PROVIDER_UNIT_PROPS=(/,/^)/p' "$LAUNCHER_SRC")
t "LOCAL_PROPS has PrivateNetwork=yes" grep -q -F -- '--property=PrivateNetwork=yes' <<<"$local_props"
t "BASE/LOCAL props have no network-online" bash -c "! grep -q network-online <<<\"\$1\"" _ "$base_props$local_props"
t "NETWORK_PROPS used exactly twice (auth-login, auth-logout)" test "$(grep -c -F '"${NETWORK_PROPS[@]}"' "$LAUNCHER_SRC")" -eq 2
t "NETWORK_PROPS only inside cmd_auth_login/cmd_auth_logout" bash -c "
  awk '/^cmd_auth_login\\(\\) \\{/,/^}/' '$LAUNCHER_SRC' | grep -q -F '\"\${NETWORK_PROPS[@]}\"' &&
  awk '/^cmd_auth_logout\\(\\) \\{/,/^}/' '$LAUNCHER_SRC' | grep -q -F '\"\${NETWORK_PROPS[@]}\"'"
code_of() { sed -E -e 's/^[[:space:]]*#.*$//' "$1"; } # a template without its comment lines
t "no StateDirectory/CacheDirectory in launcher code" bash -c "! grep -q -E 'StateDirectory|CacheDirectory' <<<\"\$1\"" _ "$(code_of "$LAUNCHER_SRC")"
check_provider_props() { # the provider property table: network ordering, no private network, fixed hardening
  local l
  for l in After=network-online.target Wants=network-online.target PrivateNetwork=no Restart=no \
    RemainAfterExit=yes StandardInput=null StandardOutput=journal StandardError=journal \
    WorkingDirectory=/var/lib/eanhl-cloud UMask=0077 PrivateTmp=yes ProtectHome=yes \
    ProtectSystem=strict NoNewPrivileges=yes KillMode=control-group Type=oneshot TimeoutStartSec=300; do
    grep -q -x -E "[[:space:]]*$l" <<<"$provider_props" || return 1
  done
  ! grep -q -E 'PrivateNetwork=yes|Environment|--collect|StateDirectory|CacheDirectory' <<<"$provider_props"
}
t "provider props: network-online ordering, PrivateNetwork=no, Restart=no, fixed hardening, no Environment" check_provider_props
t "provider units: ExecStart is the wrapper with the table's probe argument (run and boot renderer)" bash -c "
  grep -q -F 'B_EXPECT_ARGV=\"\$WRAPPER --nonblock probe \$parg\"' '$LAUNCHER_SRC' &&
  grep -q -F '\"ExecStart=\$WRAPPER --nonblock probe \$(pp_mode_field provider 2)\"' '$LAUNCHER_SRC'"
t "no local probe unit template remains" test ! -e "$V/eanhl-cloud-credential-probe@.service"
t "no provider probe unit template remains (E3J9D-R)" test ! -e "$V/eanhl-cloud-credential-provider-probe@.service"
probe_modes=$(sed -n '/^readonly PROBE_MODES=(/,/^)/p' "$LAUNCHER_SRC")
t "launcher PROBE_MODES has no provider mode or canary-nested" bash -c "! grep -q -E 'provider|neg-nokey|neg-nostore|canary-nested|e4-decoy|n3-busy' <<<\"\$1\"" _ "$probe_modes"
t "launcher bound runner always passes local:<mode>" grep -q -F 'bound_start "probe-$mode" none --nonblock probe "local:$mode"' "$LAUNCHER_SRC"
t "RESIDENT_AGENT_RULES is empty in the template (fail closed until M8/L2)" grep -q -x 'readonly RESIDENT_AGENT_RULES=()' "$LAUNCHER_SRC"
t "preflight and agent rule never name cmdline/environ" bash -c "! awk '/^(preflight_auth_login|agent_rule_holds)\\(\\) \\{/,/^}/' '$LAUNCHER_SRC' | grep -q -E 'cmdline|environ'"

# ── 1b. provider-probe command surface (E3J9D-R, static) ────────────────────
t "dispatch arms: the eleven subcommands plus provider-probe, nothing else" test \
  "$(sed -n '/^case "\${1-}" in$/,/^esac$/p' "$LAUNCHER_SRC" | grep -o -E '^  [a-z-]+\)' | tr -d ' )' | tr '\n' ' ')" = \
  'keygen pass-init probe probe-stop pty-marker env-proof auth-login auth-logout entry-remove canary-remove key-delete provider-probe '
t "provider-probe verbs: exactly run, schedule|collect, discard" test \
  "$(sed -n '/^cmd_provider_probe() {/,/^}/p' "$LAUNCHER_SRC" | grep -o -E '^    [a-z |]+\)' | tr -d ' )' | tr '\n' ' ')" = 'run schedule|collect discard '
t "provider modes: exactly the six closed modes" test \
  "$(sed -n '/^readonly PROVIDER_MODES=(/,/^)/p' "$LAUNCHER_SRC" | grep -o -E "^  '[a-z0-9-]+\|" | tr -d " '|" | tr '\n' ' ')" = \
  'provider provider-freshcache neg-nokey neg-nostore n3-busy e4-decoy '
t "slots: exactly now, t20m (20min), t6h15m (6h15min), boot (10min)" test \
  "$(sed -n '/^readonly PP_SLOTS=(/,/^)/p' "$LAUNCHER_SRC" | grep -o -E "^  '[^']*'" | tr -d " '" | tr '\n' ' ')" = \
  'now||| t20m|20min|OnActiveUSec|20min t6h15m|6h15min|OnActiveUSec|6h15min boot|10min|OnBootUSec|10min '
t "'provider:' in launcher code: only PROVIDER_MODES and the one prefix strip in pp_probe_mode" test \
  "$(code_of "$LAUNCHER_SRC" | grep 'provider:' | grep -v -E "^  '[a-z0-9-]+\|provider:")" = '  printf '"'"'%s'"'"' "${parg#provider:}"'
check_setenv_surface() { # check_setenv_surface <launcher-src>: --setenv only in pty-marker, env-proof and the e4-decoy arm
  local f=$1 lines want
  lines=$(code_of "$f" | grep -o -E -- '--setenv=[A-Z0-9_]+=[^"]*' | sort)
  want=$(printf '%s\n' '--setenv=E3J9_INJECTED=' '--setenv=GNUPGHOME=/nonexistent-e3j9' \
    '--setenv=PASSWORD_STORE_DIR=/nonexistent-e3j9' '--setenv=PASSWORD_STORE_GPG_OPTS=--e3j9-invalid' \
    '--setenv=PATH=/nonexistent-e3j9' '--setenv=GPG_TTY=/dev/e3j9-decoy' \
    '--setenv=PROTON_DRIVE_BASE_URL=http://127.0.0.1:9' '--setenv=E3J9_PTY_NONCE=' \
    '--setenv=PROTON_DRIVE_CACHE_DIR=$E4_PDCACHE' '--setenv=XDG_CACHE_HOME=$E4_XDGCACHE' \
    '--setenv=PROTON_DRIVE_BASE_URL=$E4_BASE_URL' '--setenv=E3J9_INJECTED=e3j9nonce$e4_nonce' | sort)
  [ "$lines" = "$want" ] || return 1
  # The four E4 decoys exist only inside cmd_pp_run's e4-decoy branch; E4_DECOYS is assigned once.
  [ "$(sed -n '/^cmd_pp_run() {/,/^}/p' "$f" | grep -c -E -- '--setenv=(PROTON_DRIVE_CACHE_DIR=\$E4|XDG_CACHE_HOME=\$E4|PROTON_DRIVE_BASE_URL=\$E4|E3J9_INJECTED=e3j9nonce\$e4)')" -eq 4 ] &&
    [ "$(code_of "$f" | grep -c -E '^[[:space:]]*E4_DECOYS=\($')" -eq 1 ] &&
    grep -q -x -F 'readonly E4_PDCACHE=/tmp/e3j9-e4-pdcache' "$f" && grep -q -x -F 'readonly E4_XDGCACHE=/tmp/e3j9-e4-xdgcache' "$f" &&
    grep -q -x -F 'readonly E4_BASE_URL=http://127.0.0.1:9' "$f"
}
t "--setenv surface: pty-marker, env-proof and the e4-decoy arm only, exact names and fixed values" check_setenv_surface "$LAUNCHER_SRC"
mutation "--setenv added to the provider arm (static)" "$LAUNCHER_SRC" 's/^  local decoys=()$/  local decoys=(--setenv=E3J9_EXTRA=1)/' check_setenv_surface
t "E4 decoy constants: launcher == probe" bash -c "for n in E4_PDCACHE E4_XDGCACHE E4_BASE_URL; do [ \"\$(grep -x -E \"readonly \$n=.*\" '$LAUNCHER_SRC')\" = \"\$(grep -x -E \"readonly \$n=.*\" '$PROBE_SRC')\" ] || exit 1; done"
check_e4_nonce_source() { # the E4 marker is generated by fresh_nonce, never read from the environment
  [ "$(grep -c -F 'if ! e4_nonce=$(fresh_nonce 16); then' "$1")" -eq 1 ] && ! code_of "$1" | grep -q -E 'E4_NONCE|NONCE_OVERRIDE|\$\{?E3J9_'
}
t "E4 marker comes only from fresh_nonce (no environment input)" check_e4_nonce_source "$LAUNCHER_SRC"
mutation "E4 nonce accepted from the environment (static)" "$LAUNCHER_SRC" 's/if ! e4_nonce=\$(fresh_nonce 16); then/if ! e4_nonce=${E4_NONCE_OVERRIDE:-$(fresh_nonce 16)}; then/' check_e4_nonce_source
check_collect_count() { # --collect stays only in run_quiet, run_capture, pty-marker, auth-login and auth-logout
  [ "$(code_of "$1" | grep -c -F -- '--collect')" -eq 5 ]
}
t "--collect only in run_quiet, run_capture, pty-marker, auth-login, auth-logout (never bound/provider units)" check_collect_count "$LAUNCHER_SRC"
mutation "provider units gain --collect (static)" "$LAUNCHER_SRC" 's/  if ! "\$SYSTEMD_RUN" --quiet --no-block --unit="\$B_UNIT" --description="\$desc" \\/  if ! "$SYSTEMD_RUN" --quiet --no-block --collect --unit="$B_UNIT" --description="$desc" \\/' check_collect_count
check_local_privnet() { sed -n '/^readonly LOCAL_PROPS=(/,/^)/p' "$1" | grep -q -F -- '--property=PrivateNetwork=yes'; }
mutation "LOCAL_PROPS without PrivateNetwork=yes (static)" "$LAUNCHER_SRC" '/^readonly LOCAL_PROPS=(/,/^)/{/--property=PrivateNetwork=yes/d}' check_local_privnet
t "launcher never runs systemctl start/restart/link/edit or enable --now" bash -c "! grep -q -E '\"\\\$SYSTEMCTL\" (start|restart|link|edit)|enable --now' <<<\"\$1\"" _ "$(code_of "$LAUNCHER_SRC")"
t "systemctl enable/disable only in the boot schedule, rollback and cleanup functions" test \
  "$(awk '/^[a-z_]+\(\) \{/{fn=$1} /"\$SYSTEMCTL" (enable|disable)/{print fn}' "$LAUNCHER_SRC" | sort -u | tr '\n' ' ')" = 'cmd_pp_schedule() pp_cleanup_pair() pp_schedule_rollback() '
t "no rm/mv/ln/install/cp/tee or redirect write under the unit directories in the launcher" bash -c "
  ! grep -E '(UNIT_DIR|WANTS_DIR)' <<<\"\$1\" | grep -q -E '(^|[^a-z_])(rm|mv|ln|install|cp|tee)[[:space:]]|>[[:space:]]*\"?\\\$(UNIT_DIR|WANTS_DIR)'" _ "$(code_of "$LAUNCHER_SRC")"
check_journal_forms() { # every journalctl call is one of the fixed forms
  local code n_all n_sync
  code=$(code_of "$LAUNCHER_SRC")
  n_all=$(grep -c -F '"$JOURNALCTL"' <<<"$code")
  n_sync=$(grep -c -F '"$JOURNALCTL" --sync >/dev/null 2>&1' <<<"$code")
  [ "$(grep -c -F '"$JOURNALCTL" --no-pager --quiet --since "@$1" -o json --all' <<<"$code")" -eq 1 ] &&
    [ "$(grep -c -F '"$JOURNALCTL" --no-pager --quiet -o json --output-fields=_SYSTEMD_INVOCATION_ID \' <<<"$code")" -eq 1 ] &&
    [ "$(grep -c -F '"$JOURNALCTL" --no-pager --quiet -o cat \' <<<"$code")" -eq 1 ] &&
    [ "$n_all" -eq $((n_sync + 3)) ] &&
    [ "$(grep -A1 -F -- '--output-fields=_SYSTEMD_INVOCATION_ID \' <<<"$code" | tail -1 | sed -E 's/^ +//')" = '"_SYSTEMD_UNIT=$1" 2>/dev/null) || return 1' ] &&
    [ "$(grep -A1 -F -- '-o cat \' <<<"$code" | tail -1 | sed -E 's/^ +//')" = '"_SYSTEMD_UNIT=$B_UNIT.service" "_SYSTEMD_INVOCATION_ID=$B_ID" 2>/dev/null)' ] &&
    ! grep -F '"$JOURNALCTL"' <<<"$code" | grep -q -E -- ' -f | --follow| -u '
}
t "every journalctl call is a fixed form (json proof: one _SYSTEMD_UNIT match; cat read: unit AND invocation)" check_journal_forms
HELPER_SRC=$V/unit-publish
t "unit-publish: perl -T -c" bash -c "perl -T -c '$HELPER_SRC' >/dev/null 2>&1"
t "unit-publish: only Fcntl, POSIX and IO::Handle (plus strict/warnings)" test \
  "$(grep -o -E '^use [A-Za-z:]+' "$HELPER_SRC" | sort | tr '\n' ' ')" = 'use Fcntl use IO::Handle use POSIX use strict use warnings '
check_helper_no_exec() { # no program execution, pipe open, rename or glob in the helper's code
  local code
  code=$(code_of "$1")
  ! grep -q -E '(^|[^a-z_$>])(system|exec|rename|glob)[[:space:]]*\(|(^|[^a-z_])qx[^a-z_]|`' <<<"$code" &&
    ! grep -E '(^|[^a-z_])open\(' <<<"$code" | grep -q -F '|'
}
t "unit-publish: no system/exec/qx/backticks/pipe open/rename/glob in code" check_helper_no_exec "$HELPER_SRC"
t "unit-publish: unlink only in the identity-proven removal paths" test \
  "$(awk '/^sub [a-z_]+/{fn=$2} /unlink\(/{print fn}' "$HELPER_SRC" | sort -u | tr '\n' ' ')" = 'op_unpublish remove_proven '
check_helper_opens() { # write-mode sysopen: O_EXCL|O_NOFOLLOW; the read re-open: O_NOFOLLOW
  ! grep -E 'sysopen\(' "$1" | grep -E 'O_WRONLY' | grep -v -q -F 'O_CREAT | O_EXCL | O_NOFOLLOW' &&
    grep -q -F 'sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW)' "$1"
}
t "unit-publish: every write-mode sysopen has O_EXCL|O_NOFOLLOW; the read re-open has O_NOFOLLOW" check_helper_opens "$HELPER_SRC"
t "unit-publish: emitted names match ^[a-z_]+\$" bash -c "! grep -o -E \"emit\\('[^']*'\" '$HELPER_SRC' | sed -E \"s/^emit\\('//; s/'\\\$//\" | grep -v -x -E '[a-z_]+' | grep -q ."
t "unit-publish: the stem grammar is the boot slot's provider grammar only" grep -q -F 'my $STEM_RE     = qr/\A(eanhl-cloud-cred-pprobe-boot-provider-[0-9a-f]{32})\z/;' "$HELPER_SRC"
t "launcher has no trailing 'exit 0' masking a failed subcommand" bash -c "[ \"\$(tail -1 '$LAUNCHER_SRC')\" = esac ]"
# Emitted-name grammar (E3J9C §19.6). The launcher accepts only ^E3J9 [a-z_]+=…
# names. The previous extractor's class [a-z_"${}]+ stopped at the first digit
# (pass_script_sha256_match was read as pass_script_sha and passed) and skipped
# every quoted name. This check takes the COMPLETE first token of every
# production emit / expect / emit_count call (comments removed), plus every
# literal `printf 'E3J9 <name>='`, in every template, and classifies it:
#   - a plain or quoted literal must match ^[a-z_]+$ exactly;
#   - a dynamic token must contain exactly one placeholder enumerated in
#     DYN_NAMES for that file; every expansion must match ^[a-z_]+$, and the
#     enumeration itself is tied to the source by the assertions below;
#   - any other dynamic token fails as unenumerated (never silently skipped).
EMIT_SRCS=("$LAUNCHER_SRC" "$WRAPPER_SRC" "$PROBE_SRC" "$INSPECT_SRC" "$LOCKHOLD_SRC" "$OINV_SRC" "$PTY_SRC")
# <file basename>|<placeholder>|<values> (space-separated; @ = empty; FORWARD =
# the probe's expect/emit_count forwarders, whose literal names are checked at
# their call sites).
DYN_NAMES=(
  'eanhl-cloud-credential|${label//-/_}|entry_remove canary_remove'
  'eanhl-cloud-credential|${last}|primary subkey'
  'env-inspect|${p}|@ helper_'
  'eanhl-cloud-credential-probe.sh|$1|FORWARD'
)
emit_call_tokens() { # emit_call_tokens <file>: the complete first token of each production call
  sed -E -e 's/^[[:space:]]*#.*$//' -e 's/[[:space:]]#[[:space:]].*$//' "$1" |
    grep -o -E '(^|[;&|({[:space:]])(emit_count|emit|expect)[[:space:]]+[^[:space:];)]+' |
    sed -E 's/^[;&|({[:space:]]*(emit_count|emit|expect)[[:space:]]+//'
}
emitted_name_violations() { # emitted_name_violations <file>...: one line per violation
  local f base tok name entry efile ph vals v found
  for f in "$@"; do
    base=${f##*/}
    while IFS= read -r tok; do
      [ -n "$tok" ] || continue
      if [[ $tok == *'$'* ]]; then
        found=0
        for entry in "${DYN_NAMES[@]}"; do
          IFS='|' read -r efile ph vals <<<"$entry"
          [ "$efile" = "$base" ] && [[ $tok == *"$ph"* ]] || continue
          [[ ${tok//"$ph"/} == *'$'* ]] && continue
          found=1
          [ "$vals" = FORWARD ] && continue
          for v in $vals; do
            [ "$v" = @ ] && v=''
            name=${tok//"$ph"/$v}
            name=${name//\"/}
            name=${name//\'/}
            [[ $name =~ ^[a-z_]+$ ]] || printf '%s: %s -> %s\n' "$base" "$tok" "$name"
          done
        done
        [ "$found" -eq 1 ] || printf '%s: unenumerated dynamic name %s\n' "$base" "$tok"
      else
        name=${tok//\"/}
        name=${name//\'/}
        [[ $name =~ ^[a-z_]+$ ]] || printf '%s: %s\n' "$base" "$tok"
      fi
    done < <(emit_call_tokens "$f")
    while IFS= read -r name; do
      [[ $name =~ ^[a-z_]+$ ]] || printf '%s: printf name %s\n' "$base" "$name"
    done < <(grep -o -E "printf 'E3J9 [^%=']*=" "$f" | sed -E "s/^printf 'E3J9 //; s/=\$//")
  done
}
check_emitted_names() { # check_emitted_names <file>...: 0 only if no violation (violations printed)
  local v
  v=$(emitted_name_violations "$@")
  [ -z "$v" ] && return 0
  printf '%s\n' "$v" | sed 's/^/     violation: /'
  return 1
}
t "emitted names: every production emit/expect/emit_count/printf name in every template matches ^[a-z_]+\$ (full token)" check_emitted_names "${EMIT_SRCS[@]}"
n_tokens=$(for f in "${EMIT_SRCS[@]}"; do emit_call_tokens "$f"; done | grep -c .)
t "emitted names: the extractor sees the templates' calls (>= 150 tokens, got $n_tokens)" test "$n_tokens" -ge 150
# The enumerated dynamic values are the source's only values.
t "emitted names: remove_fixed_entry labels are exactly entry-remove and canary-remove" test "$(grep -o -E 'remove_fixed_entry [a-z-]+' "$LAUNCHER_SRC" | sort -u | tr '\n' ' ')" = 'remove_fixed_entry canary-remove remove_fixed_entry entry-remove '
t "emitted names: key metadata \$last is only primary, subkey or empty" test -z "$(grep -o -E '(^|[[:space:]])last=[^[:space:];]*' "$LAUNCHER_SRC" | sed -E 's/^[[:space:]]*//' | grep -v -x -E 'last=(""|primary|subkey)')"
t "emitted names: env-inspect prefixes are only \"\" and helper_" test -z "$(sed -E -e 's/^[[:space:]]*#.*$//' -e 's/[[:space:]]#[[:space:]].*$//' "$INSPECT_SRC" | grep -o -E 'print_(boundary|descendant) [^[:space:]|;]+' | awk '{print $2}' | grep -v -x -E '""|helper_')"
t "emitted names: the probe's \$1 forwarders are exactly the two in expect() and emit_count()" bash -c "[ \"\$(grep -c -F 'emit \"\$1\"' '$PROBE_SRC')\" -eq 2 ] && sed -n '/^expect() {/,/^}/p' '$PROBE_SRC' | grep -q -F 'emit \"\$1\" \"\$3\"' && sed -n '/^emit_count() {/,/^}/p' '$PROBE_SRC' | grep -q -F 'emit \"\$1\" \"\$2\"'"
# The extractor itself: full tokens, quoted and dynamic names, comments ignored.
EFX=$W/emit-fixtures
mkdir -p "$EFX"
printf '%s\n' '  expect pass_script_sha256_match true "$(tf x)"' >"$EFX/digits"
printf '%s\n' '  emit "quoted_9name" v' >"$EFX/quoted"
printf '%s\n' '  emit "$unknown_name" v' >"$EFX/dynamic"
printf '%s\n' '# emit bad9 x' '  emit ok_name "x" # trailing emit bad9 y' '  [ -n "$x" ] && emit other_name "$x"' >"$EFX/clean"
t "extractor: a digit name is reported in full (not truncated)" test "$(emitted_name_violations "$EFX/digits")" = 'digits: pass_script_sha256_match'
t "extractor: a quoted literal with a digit is reported" test "$(emitted_name_violations "$EFX/quoted")" = 'quoted: "quoted_9name"'
t "extractor: an unenumerated dynamic name is reported" test "$(emitted_name_violations "$EFX/dynamic")" = 'dynamic: unenumerated dynamic name "$unknown_name"'
t "extractor: comments ignored, chained calls read, valid names pass" test -z "$(emitted_name_violations "$EFX/clean")"
check_emitted_names_probe() { # check_emitted_names_probe <probe-src>: the grammar check with a (mutant) probe
  local probe_copy=$W/emit-probe/eanhl-cloud-credential-probe.sh
  mkdir -p "${probe_copy%/*}"
  cp "$1" "$probe_copy"
  check_emitted_names "$LAUNCHER_SRC" "$WRAPPER_SRC" "$probe_copy" "$INSPECT_SRC" "$LOCKHOLD_SRC" "$OINV_SRC" "$PTY_SRC" >/dev/null
}
mutation "probe emits pass_script_sha256_match again (static grammar check)" "$PROBE_SRC" 's/expect pass_script_hash_match /expect pass_script_sha256_match /' check_emitted_names_probe
t "no private-key / token markers in templates" bash -c "! grep -r -I -i -E 'BEGIN PGP|PRIVATE KEY|accessToken\"?:|refreshToken\"?:|https://account\.proton|Bearer ' --exclude-dir=test '$C'"

# ── 2. accepted pass delta (escaped manifest) ─────────────────────────────
# decode_delta <manifest> <out>: exact inverse of the documented encoding.
# Returns non-zero on any malformed line or unknown escape (fail closed).
decode_delta() {
  local line b
  : >"$2"
  while IFS= read -r line; do
    case "$line" in
      '#' | '# '*) continue ;;
      '|'*'|') ;;
      *) return 1 ;;
    esac
    [ "${#line}" -ge 2 ] || return 1
    b=${line:1:${#line}-2}
    b=${b//\\\\/$'\x01'}
    b=${b//\\t/$'\t'}
    case "$b" in *\\*) return 1 ;; esac
    b=${b//$'\x01'/\\}
    printf '%s\n' "$b" >>"$2"
  done <"$1"
}
DEC=$W/delta.decoded
t "accepted delta: decodes (framing and escapes valid)" decode_delta "$DELTA_SRC" "$DEC"
t "accepted delta: body lines all framed |…|, preamble lines '#'" bash -c "! grep -v -E '^(#( .*)?|\|.*\|)\$' '$DELTA_SRC' | grep -q ."
t "accepted delta: no TAB, CR, trailing space or blank line" bash -c "! LC_ALL=C grep -q -P '\t|\r| \$|^\$' '$DELTA_SRC'"
if command -v git >/dev/null 2>&1; then
  wsout=$(git diff --no-index --check /dev/null "$DELTA_SRC" 2>&1)
  wsrc=$?
  t "accepted delta: git whitespace check clean (untracked-file form)" test "$wsrc" -eq 1 -a -z "$wsout"
fi
t "accepted delta: no /tmp, claude-, home path or timestamp" bash -c "! grep -q -E '/tmp|claude-|/home/|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}' '$DELTA_SRC'"
t "accepted delta: decoded body has 6 unified hunks" test "$(grep -c '^@@' "$DEC")" -eq 6
t "accepted delta: decoded body has 13 change lines" test "$(grep -v -E '^(---|\+\+\+) ' "$DEC" | grep -c -E '^[-+]')" -eq 13
t "accepted delta: labels fixed" bash -c "head -2 '$DEC' | diff - <(printf '%s\n' '--- a/src/password-store.sh (password-store 1.7.4)' '+++ b/usr/bin/pass (Ubuntu pass 1.7.4-8)') >/dev/null"
up_hash=b48d710a8da2473b83491bd3c1971256f4c17c067dab1e9a7a3ac453170bbcd7
in_hash=b0da432e8d377a67c7a74a9111c6b32889cce62f6e4f506a7bbdba817a268632
raw_hash=185a3b10396d5dea1898c30a17874512f4d6a6f02d9053de0aaea2214638ef3c
t "accepted delta: preamble carries both full input hashes" bash -c "grep -q -x '#            sha256 $up_hash' '$DELTA_SRC' && grep -q -x '#            sha256 $in_hash' '$DELTA_SRC'"
t "accepted delta: decoded sha256 == preamble raw-diff hash" bash -c "grep -q -x '# raw diff:  sha256 $raw_hash' '$DELTA_SRC' && [ \"\$(sha256sum '$DEC' | cut -d ' ' -f 1)\" = $raw_hash ]"
printf '%s\n' '# x' '|a\qb|' >"$W/bad-escape"
printf '%s\n' '# x' 'unframed' >"$W/bad-frame"
t "decoder refuses an unknown escape" not decode_delta "$W/bad-escape" "$W/bd1"
t "decoder refuses an unframed body line" not decode_delta "$W/bad-frame" "$W/bd2"
t "probe PASS_SHA256 == accepted installed hash" grep -q -x "readonly PASS_SHA256=$in_hash" "$PROBE_SRC"
if [ "$MODE" = full ]; then
  t "input upstream sha256 == preamble" test "$(sha256sum "$E3J9_PASS_UPSTREAM" | cut -d ' ' -f 1)" = "$up_hash"
  t "input installed sha256 == preamble" test "$(sha256sum "$E3J9_PASS_INSTALLED" | cut -d ' ' -f 1)" = "$in_hash"
  LC_ALL=C TZ=UTC diff -u --label 'a/src/password-store.sh (password-store 1.7.4)' --label 'b/usr/bin/pass (Ubuntu pass 1.7.4-8)' "$E3J9_PASS_UPSTREAM" "$E3J9_PASS_INSTALLED" >"$W/regen.diff"
  t "decoded delta == regenerated raw diff, byte for byte (cmp)" cmp -s "$DEC" "$W/regen.diff"
  t "plain diff: exactly the 7 change blocks H1-H7" test "$(diff "$E3J9_PASS_UPSTREAM" "$E3J9_PASS_INSTALLED" | grep -E '^[0-9]' | tr '\n' ' ')" = '249d248 297c296 405c404 417c416 503c502 509c508 679c678 '
else
  printf 'NOT RUN accepted-delta regeneration and input hashes (--static-only)\n'
fi

# ── 3. wrapper behaviour in a sandbox (real /usr/bin/flock and /usr/bin/env) ─
S=$W/sbx
mkdir -p "$S/bin" "$S/val" "$S/locks"
: >"$S/locks/credential.lock"
printf '#!/bin/sh\necho "${FAKE_ID:-eanhl-cloud}"\n' >"$S/bin/id"
printf '#!/bin/sh\n/usr/bin/cat /proc/$$/environ > "%s/child.env"; printf "%%s\\n" "$@" > "%s/child.args"\n' "$S" "$S" >"$S/val/dumper"
cp "$S/val/dumper" "$S/bin/gpg-cmd"
cp "$S/val/dumper" "$S/val/pty-marker"
printf '#!/bin/sh\n/usr/bin/sleep "${1:-3}"\n' >"$S/val/lockhold"
chmod +x "$S/bin/id" "$S/val/"* "$S/bin/gpg-cmd"
cp "$S/val/dumper" "$S/val/dump-inspect"
cp "$S/val/dumper" "$S/val/env-inspect"

build_wrapper() { # build_wrapper <src> <dst> [lock-path]
  local lock=${3:-$S/locks/credential.lock}
  sed -e "s#/usr/bin/id#$S/bin/id#" \
    -e "s#^readonly LOCK_FILE=.*#readonly LOCK_FILE=$lock#" \
    -e "s#^readonly VALIDATION_DIR=.*#readonly VALIDATION_DIR=$S/val#" \
    -e "s#gpg) command_path=/opt/eanhl-cloud/credential-bin/gpg#gpg) command_path=$S/bin/gpg-cmd#" \
    -e "s#env-inspect) command_path=\$VALIDATION_DIR/env-inspect#env-inspect) command_path=\$VALIDATION_DIR/dump-inspect#" \
    "$1" >"$2"
  chmod +x "$2"
}
WR=$W/wrapper
build_wrapper "$WRAPPER_SRC" "$WR"

check_env_exact() { # check_env_exact <wrapper>
  rm -f "$S/child.env"
  E3J9_INJECTED=e3j9nonce0123 GNUPGHOME=/nonexistent-e3j9 PASSWORD_STORE_DIR=/nonexistent-e3j9 \
    PASSWORD_STORE_GPG_OPTS=--e3j9-invalid GPG_TTY=/dev/e3j9-decoy PROTON_DRIVE_BASE_URL=http://127.0.0.1:9 \
    INVOCATION_ID=abc JOURNAL_STREAM=1:2 "$1" --nonblock env-inspect boundary -x --batch || return 1
  [ "$(tr '\0' '\n' <"$S/child.env" | sort)" = "$(printf '%s\n' "$manifest" | sort)" ]
}
t "child exec-time env == 12 literals exactly (decoys in parent)" check_env_exact "$WR"
t "args passed through verbatim" test "$(cat "$S/child.args")" = "$(printf 'boundary\n-x\n--batch')"
"$WR" --nonblock env-inspect a '' b
t "an empty argv element survives the wrapper (GNU env)" test "$(cat "$S/child.args")" = "$(printf 'a\n\nb')"
"$WR" --nonblock gpg --list-secret-keys
t "gpg id maps to fixed path; env still exact" test "$(tr '\0' '\n' <"$S/child.env" | sort)" = "$(printf '%s\n' "$manifest" | sort)"
FAKE_ID=utiz "$WR" --nonblock env-inspect boundary
t "wrong identity → 64" test "$?" -eq 64
"$WR" --nonblock bash -c id
t "unknown command id → 64" test "$?" -eq 64
"$WR" --nonblock /usr/bin/id
t "absolute path as id → 64" test "$?" -eq 64
for lm in --no-fork --wait=0 --wait=3601 --wait=01; do
  "$WR" "$lm" env-inspect boundary
  t "lockmode $lm → 64" test "$?" -eq 64
done
"$WR" --nonblock
t "missing command id → 64" test "$?" -eq 64
E3J9_PTY_NONCE=zz "$WR" --nonblock pty-marker
t "pty-marker bad nonce → 64" test "$?" -eq 64
E3J9_PTY_NONCE=0123456789abcdef0123456789abcdef "$WR" --nonblock pty-marker extra args
t "pty-marker rc 0" test "$?" -eq 0
t "pty-marker: nonce is the only positional arg" test "$(cat "$S/child.args")" = 0123456789abcdef0123456789abcdef
t "pty-marker: nonce not in child env" bash -c "! tr '\0' '\n' <'$S/child.env' | grep -q 0123456789abcdef"
mv "$S/val/lockhold" "$S/val/lockhold.off"
"$WR" --nonblock lockhold
t "validation id refused when tool not installed → 64" test "$?" -eq 64
mv "$S/val/lockhold.off" "$S/val/lockhold"

check_lock_missing() { # check_lock_missing <wrapper-src>: 64 and the lock is not created
  local lock=$W/nolock/credential.lock w=$W/wr-nolock
  mkdir -p "$W/nolock"
  rm -f "$lock"
  build_wrapper "$1" "$w" "$lock"
  "$w" --nonblock env-inspect boundary
  [ "$?" -eq 64 ] && [ ! -e "$lock" ]
}
check_lock_symlink() {
  local lock=$W/symlock/credential.lock w=$W/wr-symlock
  mkdir -p "$W/symlock"
  : >"$W/symlock/real"
  ln -sf "$W/symlock/real" "$lock"
  build_wrapper "$1" "$w" "$lock"
  "$w" --nonblock env-inspect boundary
  [ "$?" -eq 64 ]
}
t "lock file missing → 64, never created" check_lock_missing "$WRAPPER_SRC"
t "lock file is a symlink → 64" check_lock_symlink "$WRAPPER_SRC"

"$WR" --nonblock lockhold 3 &
holder=$!
sleep 0.5
"$WR" --nonblock env-inspect boundary
t "K4 nonblock while held → 75" test "$?" -eq 75
s0=$(date +%s%N)
"$WR" --wait=1 env-inspect boundary
rcw=$?
el=$((($(date +%s%N) - s0) / 1000000))
t "K4 --wait=1 while held → 75" test "$rcw" -eq 75
t "K4 --wait=1 waited ≥ 900 ms" test "$el" -ge 900
printf '#!/bin/sh\n/usr/bin/setsid -f /usr/bin/sleep 5 </dev/null >/dev/null 2>&1\nexit 0\n' >"$S/val/lockhold"
wait "$holder"
"$WR" --nonblock lockhold
sleep 0.3
"$WR" --nonblock env-inspect boundary
t "K2 detached descendant does not hold lock (--close)" test "$?" -eq 0
pkill -f '^/usr/bin/sleep 5$' 2>/dev/null

# Bash startup injection only (BASH_ENV, imported function `[`). This does NOT
# test dynamic-loader variables or direct execution by an eanhl-cloud process.
check_startup_injection() { # check_startup_injection <wrapper>
  local marker=$W/benv.marker
  rm -f "$marker" "$S/child.env"
  printf 'touch %s\n' "$marker" >"$W/benv.sh"
  env 'BASH_FUNC_[%%=() { return 1; }' BASH_ENV="$W/benv.sh" FAKE_ID=utiz \
    "$1" --nonblock env-inspect boundary >/dev/null 2>&1
  [ "$?" -eq 64 ] && [ ! -e "$marker" ] && [ ! -e "$S/child.env" ]
}
t "Bash startup mechanisms (BASH_ENV, imported [) cannot run code or bypass the id check" check_startup_injection "$WR"
mutation "wrapper without bash -p" "$WR" '1s|^#!/usr/bin/bash -p$|#!/usr/bin/bash|' check_startup_injection
mutation "wrapper without the lock-file pre-check" "$WRAPPER_SRC" '/^if \[ -L "\$LOCK_FILE" \] || \[ ! -f "\$LOCK_FILE" \]; then$/,/^fi$/d' check_lock_missing

# Stop window (documents the E3J9 limitation; it is NOT fixed): flock(1) has no
# SIGTERM handler, so a TERM to the whole group releases the lock while a
# TERM-trapping command is still running.
check_stop_window() {
  local lock=$W/sw.lock pidf=$W/sw.pid child alive rc
  : >"$lock"
  rm -f "$pidf"
  setsid /usr/bin/flock --close --nonblock --exclusive "$lock" \
    bash -c 'echo $$ > "$1"; trap "sleep 1.5; exit 0" TERM; while :; do sleep 0.1; done' _ "$pidf" 2>/dev/null &
  local leader=$!
  BG_PIDS+=("$leader")
  disown "$leader"
  for _ in $(seq 1 50); do [ -s "$pidf" ] && break; sleep 0.1; done
  child=$(cat "$pidf")
  kill -TERM -- "-$leader" 2>/dev/null
  sleep 0.4
  kill -0 "$child" 2>/dev/null && alive=1 || alive=0
  /usr/bin/flock --nonblock --exclusive "$lock" true
  rc=$?
  sleep 1.5
  [ "$alive" -eq 1 ] && [ "$rc" -eq 0 ]
}
t "stop window demonstrated: lock free while the command still runs (limitation)" check_stop_window

# ── 4. env-inspect ─────────────────────────────────────────────────────────
EI=$W/env-inspect
sed -e "s#/usr/bin/id -un#$S/bin/id#" "$INSPECT_SRC" >"$EI"
chmod +x "$EI"
twelve=()
while IFS= read -r l; do twelve+=("$l"); done <<<"$manifest"
run_inspect() { local mode=$1; shift; printf '%s\0' "$@" | "$EI" "$mode"; }
out=$(run_inspect stdin-boundary "${twelve[@]}"); rc=$?
t "boundary exact → rc 0 and env_initial_exact=true" bash -c "[ $rc -eq 0 ] && grep -q -x 'E3J9 env_initial_exact=true' <<<\"\$1\"" _ "$out"
t "boundary output vocabulary-only" vocab_only "$out"
out=$(run_inspect stdin-boundary "${twelve[@]}" PWD=/var/lib/eanhl-cloud); rc=$?
t "boundary + PWD → not exact" test "$rc" -eq 1
mod=("${twelve[@]}"); mod[5]=GNUPGHOME=/nonexistent-e3j9
out=$(run_inspect stdin-boundary "${mod[@]}"); rc=$?
t "boundary with decoy value → not exact" test "$rc" -eq 1
out=$(run_inspect stdin-boundary "${twelve[@]}" E3J9_INJECTED=e3j9nonceabc)
t "boundary nonce → nonce_absent=false, value never printed" bash -c "grep -q -x 'E3J9 env_nonce_absent=false' <<<\"\$1\" && ! grep -q e3j9nonceabc <<<\"\$1\"" _ "$out"
out=$(run_inspect stdin-boundary "${twelve[@]:0:11}"); rc=$?
t "boundary missing literal → not exact" test "$rc" -eq 1
out=$(run_inspect stdin-descendant "${twelve[@]}" PWD=/var/lib/eanhl-cloud SHLVL=2 _=/usr/bin/x GPG_TTY= GIT_CEILING_DIRECTORIES=/var/lib/eanhl-cloud/password-store/..); rc=$?
t "descendant with permitted union → rc 0" test "$rc" -eq 0
for bad in GPG_TTY=/dev/pts/3 GIT_CEILING_DIRECTORIES=/var/lib/eanhl-cloud PWD=/ INVOCATION_ID=x FOO=bar LISTEN_FDS=1; do
  run_inspect stdin-descendant "${twelve[@]}" "$bad" >/dev/null
  t "descendant rejects ${bad%%=*}" test "$?" -eq 1
done
FAKE_ID=utiz run_inspect stdin-boundary "${twelve[@]}" >/dev/null
t "env-inspect refuses wrong identity → 64" test "$?" -eq 64
"$EI" observe x 5 >/dev/null
t "observe refuses non-root → 64" test "$?" -eq 64
# The real `boundary` mode, exec'd by the real flock → env -i chain.
cp "$EI" "$S/val/real-inspect"
WRB=$W/wrapper-boundary
build_wrapper "$WRAPPER_SRC" "$WRB"
sed -i -e "s#env-inspect) command_path=\$VALIDATION_DIR/dump-inspect#env-inspect) command_path=\$VALIDATION_DIR/real-inspect#" "$WRB"
out=$(INVOCATION_ID=abc JOURNAL_STREAM=1:2 E3J9_INJECTED=e3j9noncexyz "$WRB" --nonblock env-inspect boundary); rc=$?
t "real boundary mode: rc 0" test "$rc" -eq 0
for want in env_initial_exact=true env_nonce_absent=true wrapper_parent_is_flock=true wrapper_env_readable=true wrapper_has_invocation_id=true wrapper_has_journal_stream=true; do
  t "real boundary mode: $want" grep -q -x "E3J9 $want" <<<"$out"
done
t "real boundary mode: vocabulary-only" vocab_only "$out"

# ── 5. probe ───────────────────────────────────────────────────────────────
PR=$W/probe
printf '#!/bin/sh\necho "E3J9 lockhold_stub=true"\necho "E3J9 probe_result=pass"\n' >"$W/lockhold-stub"
chmod +x "$W/lockhold-stub"
sed -e "s#/usr/bin/id -un#$S/bin/id#" -e "s#^readonly LOCKHOLD=.*#readonly LOCKHOLD=$W/lockhold-stub#" "$PROBE_SRC" >"$PR"
chmod +x "$PR"
for bad in precheck provider:local local:provider local:bogus provider:canary ''; do
  out=$("$PR" "$bad"); rc=$?
  t "probe refuses '$bad' (64, mode_refused)" test "$rc" -eq 64 -a "$out" = 'E3J9 mode_refused=true'
done
for m in lockhold-hold lockhold-long lockhold-detach busy-a; do
  out=$("$PR" "local:$m")
  t "probe local:$m: first line is probe_mode=$m" test "$(head -1 <<<"$out")" = "E3J9 probe_mode=$m"
done
extract() { sed -n "/^$2() {/,/^}/p" "$1"; }
PF=$W/probe-funcs.sh
{
  echo 'FAILURES=0'
  extract "$PR" emit
  extract "$PR" emit_count
  extract "$PR" count_find
  extract "$PR" pgrep_count
  extract "$PR" human_sessions
  sed -n '/^readonly CREDENTIAL_ENV=(/,/^)/p' "$PR"
  extract "$PR" secondary
} >"$PF"
# check_commands output against the LAUNCHER's own vocabulary (E3J9C §19.6: on
# Hotel-Echo its pass-hash record was counted as non-vocabulary, failing every
# probe run). Real emit/tf/expect/check_commands; only the predicates are stubbed.
LAUNCHER_VOCAB=$(sed -n "s/^readonly VOCAB='\(.*\)'\$/\1/p" "$LAUNCHER_SRC")
t "launcher VOCAB extracted for the probe checks" test "$LAUNCHER_VOCAB" = '^E3J9 [a-z_]+=[a-z0-9_.:-]+$'
check_check_commands_vocab() { # check_check_commands_vocab <probe-src>
  local fx=$W/cc-funcs.sh out
  {
    echo 'FAILURES=0'
    extract "$1" emit
    grep -x -E 'tf\(\) \{.*\}' "$1"
    extract "$1" expect
    extract "$1" check_commands
    printf '%s\n' 'pass_script_sha256_match() { return 0; }' 'pass_system_ext_dir_empty() { return 0; }' \
      'cmd_absent() { return 0; }' 'all_openers_absent() { return 0; }'
  } >"$fx"
  out=$(bash -c ". '$fx'; check_commands; echo \"FAILURES=\$FAILURES\"")
  [ "$(grep -c '^E3J9 ' <<<"$out")" -eq 5 ] && grep -q -x 'FAILURES=0' <<<"$out" &&
    ! grep '^E3J9 ' <<<"$out" | grep -v -q -E "$LAUNCHER_VOCAB" &&
    grep -q -x 'E3J9 pass_script_hash_match=true' <<<"$out"
}
t "probe check_commands: all 5 records match the launcher VOCAB (incl. pass_script_hash_match=true)" check_check_commands_vocab "$PROBE_SRC"
mutation "probe emits pass_script_sha256_match again (runtime check_commands vs launcher VOCAB)" "$PROBE_SRC" 's/expect pass_script_hash_match /expect pass_script_sha256_match /' check_check_commands_vocab
t "probe emit sanitises empty/odd values" bash -c ". '$PF'; [ \"\$(emit x '')\" = 'E3J9 x=invalid' ] && [ \"\$(emit x 'A B')\" = 'E3J9 x=invalid' ] && [ \"\$(emit x 3)\" = 'E3J9 x=3' ]"
check_count_find() { # check_count_find <funcs-file>
  mkdir -p "$W/cf/empty" "$W/cf/two"
  : >"$W/cf/two/a"
  : >"$W/cf/two/b"
  (
    . "$1"
    [ "$(count_find "$W/cf/does-not-exist")" = invalid ] &&
      [ "$(count_find "$W/cf/empty" -mindepth 1)" = 0 ] &&
      [ "$(count_find "$W/cf/two" -mindepth 1)" = 2 ]
  )
}
t "probe count_find: failure → invalid; 0 and 2 counted" check_count_find "$PF"
mutation "probe count_find returns 0 on failure" "$PF" '/^count_find() {/,/^}/s/printf invalid/printf 0/' check_count_find
t "probe emit_count: invalid is a failure" bash -c ". '$PF'; emit_count n invalid >/dev/null; emit_count m 4 >/dev/null; [ \"\$FAILURES\" -eq 1 ]"
mkdir -p "$W/pstub"
printf '#!/bin/sh\nexit 2\n' >"$W/pstub/pgrep-err"
printf '#!/bin/sh\necho 0\nexit 1\n' >"$W/pstub/pgrep-none"
printf '#!/bin/sh\nexit 1\n' >"$W/pstub/loginctl-err"
printf '#!/bin/sh\nprintf "%%s\\n" "1 104 u tty1 seat0 user active" "2 0 root - - manager active"\n' >"$W/pstub/loginctl-ok"
chmod +x "$W/pstub/"*
t "probe pgrep_count: pgrep error → invalid" bash -c "sed 's#/usr/bin/pgrep#$W/pstub/pgrep-err#' '$PF' > '$W/pf1'; . '$W/pf1'; [ \"\$(pgrep_count x)\" = invalid ]"
t "probe pgrep_count: none → 0" bash -c "sed 's#/usr/bin/pgrep#$W/pstub/pgrep-none#' '$PF' > '$W/pf2'; . '$W/pf2'; [ \"\$(pgrep_count x)\" = 0 ]"
t "probe human_sessions: loginctl error → invalid" bash -c "sed 's#/usr/bin/loginctl#$W/pstub/loginctl-err#' '$PF' > '$W/pf3'; . '$W/pf3'; [ \"\$(human_sessions)\" = invalid ]"
t "probe human_sessions: counts CLASS=user in column 6" bash -c "sed 's#/usr/bin/loginctl#$W/pstub/loginctl-ok#' '$PF' > '$W/pf4'; . '$W/pf4'; [ \"\$(human_sessions)\" = 1 ]"
check_secondary() { # check_secondary <funcs-file>
  (
    . "$1"
    T=$W/st
    mkdir -p "$T/ok"
    secondary GNUPGHOME "$T/../x" /usr/bin/true && exit 1
    secondary GNUPGHOME "$T/./x" /usr/bin/true && exit 1
    secondary PATH "$T/ok" /usr/bin/true && exit 1
    secondary GNUPGHOME /tmp/x /usr/bin/true && exit 1
    secondary GNUPGHOME "$T/ok" /usr/bin/true
  )
}
t "probe secondary: rejects .., ., non-directory vars and paths outside \$T" check_secondary "$PF"
mutation "probe secondary without the .. rejection" "$PF" '/case "\/\$dir\/" in/d' check_secondary
ext_pat=$(grep -o -E "'directory root:root d'[^)]*\)" "$PROBE_SRC" | sed 's/)$//')
t "probe ext-dir pattern: accepts 755, rejects group/other write" bash -c "
  m() { case \"\$1\" in $ext_pat) return 0 ;; *) return 1 ;; esac; }
  m 'directory root:root drwxr-xr-x' && ! m 'directory root:root drwxrwxr-x' && ! m 'directory root:root drwxr-xrwx' && ! m 'directory utiz:root drwxr-xr-x'"
t "probe provider anchors: generic 'Failed to load' removed" bash -c "! grep -q -F \"'Failed to load'\" '$PROBE_SRC'"

# 5b. E4/N4 probe arm and run_provider (E3J9D-R). The REAL probe code runs in a
# sandbox copy: a sandbox /proc/<parent>, store, private-tmp marker directories
# and a FAKE CLI (never the real one, never any network) that writes a unique
# leak marker and a URL to both of its streams. Nothing may reach the probe's
# stdout except closed vocabulary records.
P4=$W/p4
LEAK=e3j9leakmarkerzq
mkdir -p "$P4/stub" "$P4/proc/parent" "$P4/home/password-store/ch.proton.drive/drive-sdk-cli" "$P4/cache" "$P4/tmp" "$P4/ptmp" "$P4/rt"
printf 'entry-bytes\n' >"$P4/home/password-store/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
chmod 600 "$P4/home/password-store/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
cat >"$P4/cli" <<EOF
#!/bin/sh
# Fake Proton CLI for the harness: marker + URL on both streams; outcome from files.
echo "stdout $LEAK https://example.invalid/auth?token=$LEAK"
echo "stderr $LEAK https://example.invalid/auth?token=$LEAK" >&2
[ ! -e "$P4/cli.anchor" ] || /usr/bin/cat "$P4/cli.anchor" >&2
[ ! -e "$P4/cli.writes" ] || : >"$P4/tmp/e3j9-e4-pdcache/crossed"
exit \$(/usr/bin/cat "$P4/cli.rc" 2>/dev/null || echo 0)
EOF
printf '#!/bin/sh\ncase "$1" in -un) echo eanhl-cloud ;; -u) echo 104 ;; -G | -g) echo 107 ;; *) exit 1 ;; esac\n' >"$P4/stub/id"
printf '#!/bin/sh\nexit 0\n' >"$P4/stub/loginctl"
printf '#!/bin/sh\necho 0\nexit 1\n' >"$P4/stub/pgrep"
cat >"$P4/stub/env-inspect" <<'EOF'
#!/bin/sh
case "$1" in
  stdin-boundary) printf 'E3J9 %s\n' env_initial_exact=true env_unexpected_count=0 env_forbidden_absent=true env_nonce_absent=true env_systemd_absent=true ;;
  descendant) printf 'E3J9 %s\n' helper_env_descendant_within_permitted=true helper_env_pwd_is_workdir=true helper_env_unexpected_count=0 helper_env_wrong_value_count=0 helper_env_forbidden_absent=true helper_env_nonce_absent=true helper_env_systemd_absent=true ;;
esac
exit 0
EOF
chmod +x "$P4/cli" "$P4/stub/"*
P4_CLI_SHA=$(sha512sum "$P4/cli" | cut -d ' ' -f 1)
build_p4() { # build_p4 <probe-src> <dst>: the sandbox copy
  sed -e "s#/usr/bin/id#$P4/stub/id#g" -e "s#/usr/bin/loginctl#$P4/stub/loginctl#g" -e "s#/usr/bin/pgrep#$P4/stub/pgrep#g" \
    -e "s#^readonly ENV_INSPECT=.*#readonly ENV_INSPECT=$P4/stub/env-inspect#" \
    -e "s#^readonly SVC_HOME=.*#readonly SVC_HOME=$P4/home#" -e "s#^readonly SVC_CACHE=.*#readonly SVC_CACHE=$P4/cache#" \
    -e "s#^readonly STORE=.*#readonly STORE=$P4/home/password-store#" \
    -e "s#^readonly CLI=.*#readonly CLI=$P4/cli#" -e "s#^readonly CLI_PIN=.*#readonly CLI_PIN=$P4_CLI_SHA#" \
    -e "s#^readonly PROC_ROOT=.*#readonly PROC_ROOT=$P4/proc#" -e 's#"$PROC_ROOT/$PPID/#"$PROC_ROOT/parent/#g' \
    -e "s#^readonly E4_PDCACHE=.*#readonly E4_PDCACHE=$P4/tmp/e3j9-e4-pdcache#" \
    -e "s#^readonly E4_XDGCACHE=.*#readonly E4_XDGCACHE=$P4/tmp/e3j9-e4-xdgcache#" \
    -e "s#/usr/bin/mktemp -d /tmp/e3j9-probe.XXXXXXXX#/usr/bin/mktemp -d $P4/ptmp/e3j9-probe.XXXXXXXX#" "$1" >"$2"
  chmod +x "$2"
}
PR4=$W/probe-e4
build_p4 "$PROBE_SRC" "$PR4"
check_p4_copy() { # every sandbox constant of the e4 copy points into $P4; no real tool, /tmp or $PPID path left
  local l
  for l in "readonly CLI=$P4/cli" "readonly PROC_ROOT=$P4/proc" "readonly E4_PDCACHE=$P4/tmp/e3j9-e4-pdcache" \
    "readonly E4_XDGCACHE=$P4/tmp/e3j9-e4-xdgcache" "readonly SVC_HOME=$P4/home" "readonly STORE=$P4/home/password-store" \
    "readonly ENV_INSPECT=$P4/stub/env-inspect"; do
    grep -q -x -F "$l" "$PR4" || return 1
  done
  ! grep -q -E '/usr/bin/(id|pgrep|loginctl)|mktemp -d /tmp/e3j9-probe\.|\$PROC_ROOT/\$PPID' "$PR4" && grep -q -F "mktemp -d $P4/ptmp/" "$PR4"
}
t "e4 probe copy: every sandbox constant substituted" check_p4_copy
# The wrapper's environment as the flock parent holds it: the four fixed decoys.
e4_parent() { # e4_parent [comm] [entries...]: default = flock + the exact decoys
  local comm=${1:-flock}
  shift || true
  printf '%s\n' "$comm" >"$P4/proc/parent/comm"
  if [ "$#" -eq 0 ]; then
    set -- "PROTON_DRIVE_CACHE_DIR=$P4/tmp/e3j9-e4-pdcache" "XDG_CACHE_HOME=$P4/tmp/e3j9-e4-xdgcache" \
      PROTON_DRIVE_BASE_URL=http://127.0.0.1:9 E3J9_INJECTED=e3j9nonce0123456789abcdef0123456789abcdef \
      INVOCATION_ID=abc JOURNAL_STREAM=1:2
  fi
  printf '%s\0' "$@" >"$P4/proc/parent/environ"
}
e4_reset() { rm -rf "$P4/tmp"/* "$P4/cli.anchor" "$P4/cli.writes" "$P4/cli.rc"; e4_parent; }
e4_run() { # e4_run <probe copy>: runs provider:e4-decoy; stdout in $P4/out, stderr in $P4/err
  (cd "$P4" && "$1" provider:e4-decoy </dev/null >"$P4/out" 2>"$P4/err")
  echo $? >"$P4/rc"
}
e4_rec() { grep -x -E "E3J9 $1=[a-z0-9_.:-]+" "$P4/out" | sed 's/^E3J9 [a-z_]*=//'; }
e4_reset
e4_run "$PR4"
t "e4-decoy: clean run → probe_result=pass, exit 0, first line probe_mode=e4-decoy" bash -c "
  [ \"\$(cat '$P4/rc')\" = 0 ] && [ \"\$(head -1 '$P4/out')\" = 'E3J9 probe_mode=e4-decoy' ] && grep -q -x 'E3J9 probe_result=pass' '$P4/out'"
for want in decoy_parent_is_flock=true decoy_parent_env_readable=true decoy_parent_decoy_count=4 decoy_parent_values_exact=true \
  decoy_marker_dirs_created=true decoy_pdcache_entry_count=0 decoy_xdgcache_entry_count=0 provider_rc=0 provider_result=ok entry_mode=600; do
  t "e4-decoy clean run: $want" grep -q -x "E3J9 $want" "$P4/out"
done
t "e4-decoy: stdout vocabulary-only; no leak marker, URL or decoy value on stdout or stderr" bash -c "
  ! grep -v -q -E '^E3J9 [a-z_]+=[a-z0-9_.:-]+\$' '$P4/out' && ! grep -q -E '$LEAK|example\\.invalid|127\\.0\\.0\\.1|e3j9nonce0123' '$P4/out' '$P4/err'"
t "e4-decoy: each E4 record name appears exactly once" bash -c "for n in decoy_parent_is_flock decoy_parent_env_readable decoy_parent_decoy_count decoy_parent_values_exact decoy_marker_dirs_created decoy_pdcache_entry_count decoy_xdgcache_entry_count; do [ \"\$(grep -c \"^E3J9 \$n=\" '$P4/out')\" -eq 1 ] || exit 1; done"
e4_expect_fail() { # e4_expect_fail <probe copy>: probe_result=fail, exit 1, no leak on stdout
  e4_run "$1"
  [ "$(cat "$P4/rc")" = 1 ] && grep -q -x 'E3J9 probe_result=fail' "$P4/out" && ! grep -q -E "$LEAK|example\\.invalid" "$P4/out"
}
check_e4_wrong_value() { # a decoy with a wrong fixed value → values_exact=false → fail
  e4_reset
  e4_parent flock "PROTON_DRIVE_CACHE_DIR=$P4/tmp/e3j9-e4-pdcache" "XDG_CACHE_HOME=$P4/tmp/e3j9-e4-xdgcache" \
    PROTON_DRIVE_BASE_URL=http://127.0.0.1:8 E3J9_INJECTED=e3j9nonce0123456789abcdef0123456789abcdef
  e4_expect_fail "$1" && [ "$(e4_rec decoy_parent_values_exact)" = false ]
}
t "e4-decoy: wrong decoy value → fail" check_e4_wrong_value "$PR4"
sc_e4_not_flock() { e4_reset; e4_parent bash; e4_expect_fail "$1" && [ "$(e4_rec decoy_parent_is_flock)" = false ]; }
sc_e4_unreadable() { e4_reset; rm -f "$P4/proc/parent/environ"; e4_expect_fail "$1" && [ "$(e4_rec decoy_parent_env_readable)" = false ] && [ "$(e4_rec decoy_parent_decoy_count)" = 0 ]; }
sc_e4_three() {
  e4_reset
  e4_parent flock "PROTON_DRIVE_CACHE_DIR=$P4/tmp/e3j9-e4-pdcache" "XDG_CACHE_HOME=$P4/tmp/e3j9-e4-xdgcache" PROTON_DRIVE_BASE_URL=http://127.0.0.1:9
  e4_expect_fail "$1" && [ "$(e4_rec decoy_parent_decoy_count)" = 3 ]
}
sc_e4_bad_marker() {
  e4_reset
  e4_parent flock "PROTON_DRIVE_CACHE_DIR=$P4/tmp/e3j9-e4-pdcache" "XDG_CACHE_HOME=$P4/tmp/e3j9-e4-xdgcache" PROTON_DRIVE_BASE_URL=http://127.0.0.1:9 E3J9_INJECTED=notanonce
  e4_expect_fail "$1" && [ "$(e4_rec decoy_parent_values_exact)" = false ]
}
sc_e4_duplicate() {
  e4_reset
  e4_parent flock "PROTON_DRIVE_CACHE_DIR=$P4/tmp/e3j9-e4-pdcache" "PROTON_DRIVE_CACHE_DIR=$P4/tmp/e3j9-e4-pdcache" \
    "XDG_CACHE_HOME=$P4/tmp/e3j9-e4-xdgcache" PROTON_DRIVE_BASE_URL=http://127.0.0.1:9 E3J9_INJECTED=e3j9nonce0123456789abcdef0123456789abcdef
  e4_expect_fail "$1" && [ "$(e4_rec decoy_parent_values_exact)" = false ]
}
t "e4-decoy: parent is not flock → decoy_parent_is_flock=false, fail" sc_e4_not_flock "$PR4"
t "e4-decoy: parent environment unreadable → env_readable=false, count 0, fail" sc_e4_unreadable "$PR4"
t "e4-decoy: only three decoys → count 3, fail" sc_e4_three "$PR4"
t "e4-decoy: marker not matching ^e3j9nonce[0-9a-f]{32}\$ → values_exact=false, fail" sc_e4_bad_marker "$PR4"
t "e4-decoy: a duplicated decoy name → values_exact=false, fail" sc_e4_duplicate "$PR4"
check_e4_marker_preexists() { # a pre-existing marker directory → decoy_marker_dirs_created=false → fail
  e4_reset
  mkdir -p "$P4/tmp/e3j9-e4-pdcache"
  e4_expect_fail "$1" && [ "$(e4_rec decoy_marker_dirs_created)" = false ]
}
t "e4-decoy: a marker directory pre-exists → fail" check_e4_marker_preexists "$PR4"
check_e4_crossed_decoy() { # the CLI writes into a marker directory (a crossed decoy) → count 1 → fail
  e4_reset
  : >"$P4/cli.writes"
  e4_expect_fail "$1" && [ "$(e4_rec decoy_pdcache_entry_count)" = 1 ]
}
t "e4-decoy: a crossed cache decoy (marker directory populated) → fail" check_e4_crossed_decoy "$PR4"
mutation "probe check_decoy_parent always true" "$PR4" 's/^check_decoy_parent() {$/check_decoy_parent() { expect decoy_parent_is_flock true true; expect decoy_parent_env_readable true true; expect decoy_parent_decoy_count 4 4; expect decoy_parent_values_exact true true; return 0/' check_e4_wrong_value
mutation "probe skips the E4 marker-directory counts" "$PR4" '/expect decoy_pdcache_entry_count 0/d; /expect decoy_xdgcache_entry_count 0/d' check_e4_crossed_decoy
mutation "probe marker mkdir with -p" "$PR4" 's#/usr/bin/mkdir -m 0700 -- "\$E4_PDCACHE"#/usr/bin/mkdir -p -m 0700 -- "$E4_PDCACHE"#' check_e4_marker_preexists
e4_reset
# run_provider: every exit path maps to its closed label; CLI text never leaves.
RPF=$P4/rp-funcs.sh
{
  echo 'FAILURES=0'
  sed -n '/^readonly CLI=/p; /^readonly CLI_PIN=/p' "$PR4"
  sed -n '/^readonly CREDENTIAL_ENV=(/,/^)/p' "$PR4"
  extract "$PR4" emit
  grep -x -E 'tf\(\) \{.*\}' "$PR4"
  extract "$PR4" expect
  extract "$PR4" anchor_in
  extract "$PR4" cli_pin_match
  extract "$PR4" secondary
  extract "$PR4" run_provider
} >"$RPF"
rp_case() { # rp_case <cli rc> <anchor text|''> <expected label>
  rm -f "$P4/cli.anchor"
  echo "$1" >"$P4/cli.rc"
  [ -z "$2" ] || printf '%s\n' "$2" >"$P4/cli.anchor"
  local out
  out=$(bash -c ". '$RPF'; T='$P4/rt'; run_provider '$3'; echo \"FAILURES=\$FAILURES\"" 2>"$P4/rp.err")
  grep -q -x "E3J9 provider_result=$3" <<<"$out" && grep -q -x 'FAILURES=0' <<<"$out" &&
    ! grep -q -E "$LEAK|example\\.invalid" <<<"$out" && ! grep -q -E "$LEAK|example\\.invalid" "$P4/rp.err" &&
    [ -z "$(ls -A "$P4/rt" 2>/dev/null | grep -v -x provider.err)" ]
}
t "run_provider: exit 0 → ok, CLI text never printed" rp_case 0 '' ok
t "run_provider: exit 124 → timeout" rp_case 124 '' timeout
t "run_provider: login anchor → login_required" rp_case 1 'You need to login first' login_required
t "run_provider: decryption anchor → pass_load_failed" rp_case 1 'decryption failed' pass_load_failed
t "run_provider: unknown text → other" rp_case 1 '' other
rm -f "$P4/cli.rc" "$P4/cli.anchor"

# ── 6. launcher (stubs; never real systemd/journal/setpriv/pgrep) ──────────
L=$W/launcher
SB=$W/lsbx
ST=$W/lstate
mkdir -p "$SB/stub" "$SB/val" "$SB/home/password-store" "$SB/home/gnupg" "$SB/home/locks" "$SB/cache" "$SB/proc" "$ST"
chmod 700 "$SB/home" "$SB/home/password-store" "$SB/home/gnupg" "$SB/home/locks" "$SB/cache"
printf 'cli-bytes\n' >"$SB/cli"
CLI_SHA=$(sha512sum "$SB/cli" | cut -d ' ' -f 1)
printf '#!/bin/sh\nexit 0\n' >"$SB/wrapper"
for v in eanhl-cloud-credential-probe.sh env-inspect lockhold pty-marker; do printf '#!/bin/sh\nexit 0\n' >"$SB/val/$v"; done
chmod +x "$SB/wrapper" "$SB/val/"*
cat >"$SB/stub/id" <<'EOF'
#!/usr/bin/bash
if [ "$#" -eq 1 ] && [ "$1" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi
EOF
cat >"$SB/stub/systemctl" <<'EOF'
#!/usr/bin/bash
# Per-unit state: $st/u/<unit> exists once systemd-run started it (its argv in
# $st/u/<stem>.service.argv); $st/u/<unit>.stopped after a successful stop.
# Overrides: loadstate (any unit), stop_rc, reset_rc, gc_on_stop (unit
# unloaded once stopped; transient provider units always are, as systemd
# garbage-collects them, unless pprobe_no_gc).
# E3J9D-R: properties are derived the way systemd renders them, from the
# recorded argv (or, for the persistent boot pair, from the unit file in
# $STUB_UNIT_DIR). Overrides: uprop.<unit>.<P> (one unit), prop.<service|timer>.<P>
# (provider units), lprop.<P> (local units), result, nrestarts, netonline,
# triggered (scheduled units fired), boot_timer_state; enable_rc,
# disable_rc, reload_rc; units / units_rc as before, now filtered by the
# pattern and --state, plus the live provider units.
st=$STUB_STATE
echo "systemctl $*" >>"$st/calls"
mkdir -p "$st/u"
is_pprobe() { [[ $1 == eanhl-cloud-cred-pprobe-* ]]; }
is_scheduled() { [[ $1 == eanhl-cloud-cred-pprobe-t20m-* || $1 == eanhl-cloud-cred-pprobe-t6h15m-* || $1 == eanhl-cloud-cred-pprobe-boot-* ]]; }
stem_of() { local u=${1%.service}; printf '%s' "${u%.timer}"; }
file_of() { [ -n "${STUB_UNIT_DIR-}" ] && [ -f "$STUB_UNIT_DIR/$1" ] && printf '%s' "$STUB_UNIT_DIR/$1"; }
gone_after_stop() { [ -e "$st/gc_on_stop" ] || { is_pprobe "$1" && [ -z "$(file_of "$1")" ] && [ ! -e "$st/pprobe_no_gc" ]; }; }
loadstate() {
  if [ -e "$st/loadstate" ]; then cat "$st/loadstate"
  elif [ -e "$st/u/$1.stopped" ] && gone_after_stop "$1"; then echo not-found
  elif [ -e "$st/u/$1" ] || [ -n "$(file_of "$1")" ]; then echo loaded
  else echo not-found; fi
}
state_of() { # ActiveState without side effects
  if [ -e "$st/u/$1.stopped" ]; then echo inactive
  elif is_pprobe "$1" && [[ $1 == *.timer ]]; then
    if [ -n "$(file_of "$1")" ]; then cat "$st/boot_timer_state" 2>/dev/null || echo inactive; else echo active; fi
  elif is_scheduled "$1" && [ ! -e "$st/triggered" ]; then echo inactive
  else cat "$st/active" 2>/dev/null || echo active; fi
}
fmt_span() { case "$1" in 6h15min) printf '6h 15min' ;; *) printf '%s' "$1" ;; esac; }
derive() { # derive <unit> <property>: systemd's --value rendering
  local u=$1 p=$2 kind=service stem f a k v line cmd='' env='' onactive='' onboot='' i
  local -a args=() rest=()
  local -A P=()
  [[ $u == *.timer ]] && kind=timer
  if [ -e "$st/uprop.$u.$p" ]; then cat "$st/uprop.$u.$p"; return; fi
  if is_pprobe "$u"; then
    if [ -e "$st/prop.$kind.$p" ]; then cat "$st/prop.$kind.$p"; return; fi
  elif [ -e "$st/lprop.$p" ]; then
    cat "$st/lprop.$p"
    return
  fi
  stem=$(stem_of "$u")
  if [ -f "$st/u/$stem.service.argv" ]; then
    mapfile -d '' -t args <"$st/u/$stem.service.argv"
    for ((i = 0; i < ${#args[@]}; i++)); do
      a=${args[$i]}
      case "$a" in
        --uid=*) P[User]=${a#--uid=} ;;
        --gid=*) P[Group]=${a#--gid=} ;;
        --description=*) P[Description]=${a#--description=} ;;
        --property=*)
          k=${a#--property=}
          v=${k#*=}
          k=${k%%=*}
          case "$k" in After | Wants) P[$k]="${P[$k]:+${P[$k]} }$v" ;; *) P[$k]=$v ;; esac
          ;;
        --setenv=*) env="${env:+$env }${a#--setenv=}" ;;
        --on-active=*) onactive=${a#--on-active=} ;;
        --timer-property=*)
          k=${a#--timer-property=}
          P[T_${k%%=*}]=${k#*=}
          ;;
        -*) ;;
        *)
          cmd=$a
          rest=("${args[@]:$((i + 1))}")
          break
          ;;
      esac
    done
    P[Environment]=$env
    P[FragmentPath]=/run/systemd/transient/$u
    P[UnitFileState]=transient
  elif f=$(file_of "$u"); then
    while IFS= read -r line; do
      case "$line" in
        '' | '['* | '#'*) ;;
        ExecStart=*)
          v=${line#ExecStart=}
          cmd=${v%% *}
          read -r -a rest <<<"${v#"$cmd"}"
          ;;
        OnBootSec=*) onboot=${line#OnBootSec=} ;;
        *=*)
          k=${line%%=*}
          v=${line#*=}
          case "$k" in
            After | Wants) P[$k]="${P[$k]:+${P[$k]} }$v" ;;
            RemainAfterElapse | Persistent | Unit) P[T_$k]=$v ;;
            *) P[$k]=$v ;;
          esac
          ;;
      esac
    done <"$f"
    P[FragmentPath]=$f
    if [ -L "$STUB_WANTS_DIR/$u" ]; then P[UnitFileState]=enabled; else P[UnitFileState]=disabled; fi
  fi
  if [ "$kind" = timer ]; then
    case "$p" in
      Unit) printf '%s\n' "${P[T_Unit]:-$stem.service}" ;;
      TimersMonotonic)
        if [ -n "$onactive" ]; then
          printf '{ OnActiveUSec=%s ; next_elapse=%s }\n' "$(fmt_span "$onactive")" "$([ -e "$st/triggered" ] && echo 0 || echo '19min 59.5s')"
        elif [ -n "$onboot" ]; then
          printf '{ OnBootUSec=%s ; next_elapse=%s }\n' "$onboot" '9min 58.1s'
        else
          printf '\n'
        fi
        ;;
      TimersCalendar) printf '\n' ;;
      RemainAfterElapse) printf '%s\n' "${P[T_RemainAfterElapse]:-yes}" ;;
      Persistent) printf '%s\n' "${P[T_Persistent]:-no}" ;;
      LastTriggerUSecMonotonic) if [ -e "$st/triggered" ]; then echo '20min 1.2s'; else echo 0; fi ;;
      *) printf '%s\n' "${P[$p]-}" ;;
    esac
    return
  fi
  case "$p" in
    UMask) printf '%s\n' "${P[UMask]:-0022}" ;;
    PrivateTmp | ProtectHome | ProtectSystem | NoNewPrivileges | RemainAfterExit | PrivateNetwork | Restart) printf '%s\n' "${P[$p]:-no}" ;;
    KillMode) printf '%s\n' "${P[KillMode]:-control-group}" ;;
    Type) printf '%s\n' "${P[Type]:-simple}" ;;
    StandardInput) printf '%s\n' "${P[StandardInput]:-null}" ;;
    StandardOutput) printf '%s\n' "${P[StandardOutput]:-journal}" ;;
    StandardError) printf '%s\n' "${P[StandardError]:-inherit}" ;;
    After) printf 'sysinit.target %ssystem.slice basic.target\n' "${P[After]:+${P[After]} }" ;;
    ExecStart)
      if [ -n "$cmd" ]; then
        printf '{ path=%s ; argv[]=%s ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\n' "$cmd" "$cmd${rest[*]:+ ${rest[*]}}"
      else
        printf '\n'
      fi
      ;;
    Result) cat "$st/result" 2>/dev/null || echo success ;;
    NRestarts) cat "$st/nrestarts" 2>/dev/null || echo 0 ;;
    *) printf '%s\n' "${P[$p]-}" ;;
  esac
}
live_units() { # the live provider units (transient records and boot files)
  local f u
  for f in "$st"/u/eanhl-cloud-cred-pprobe-*; do
    [ -e "$f" ] || continue
    u=${f##*/}
    case "$u" in *.argv | *.stopped) continue ;; esac
    [ "$(loadstate "$u")" = loaded ] || continue
    printf '%s loaded %s x\n' "$u" "$(state_of "$u")"
  done
  if [ -n "${STUB_UNIT_DIR-}" ]; then
    for f in "$STUB_UNIT_DIR"/eanhl-cloud-cred-pprobe-*.service "$STUB_UNIT_DIR"/eanhl-cloud-cred-pprobe-*.timer; do
      [ -f "$f" ] || continue
      u=${f##*/}
      [ -e "$st/u/$u" ] && continue
      printf '%s loaded %s x\n' "$u" "$(state_of "$u")"
    done
  fi
}
case "$1" in
  show)
    unit=$6
    case "$3" in
      LoadState) loadstate "$unit" ;;
      InvocationID)
        if is_scheduled "$unit" && [ ! -e "$st/triggered" ]; then echo
        elif [ -e "$st/waited" ] && [ -e "$st/invid_after" ]; then cat "$st/invid_after"
        else cat "$st/invid" 2>/dev/null; fi
        ;;
      ActiveState)
        if [ "$unit" = network-online.target ]; then
          cat "$st/netonline" 2>/dev/null || echo active
          exit 0
        fi
        touch "$st/waited"
        state_of "$unit"
        ;;
      SubState) cat "$st/sub" 2>/dev/null || echo exited ;;
      ExecMainStatus) cat "$st/status" 2>/dev/null || echo 0 ;;
      *) derive "$unit" "$3" ;;
    esac
    ;;
  list-units)
    rc=$(cat "$st/units_rc" 2>/dev/null || echo 0)
    [ "$rc" = 0 ] || exit "$rc"
    pat='' states=''
    for a in "${@:2}"; do
      case "$a" in
        --state=*) states=${a#--state=} ;;
        -*) ;;
        *) pat=$a ;;
      esac
    done
    { cat "$st/units" 2>/dev/null; live_units; } | while read -r name load active rest; do
      [ -n "$name" ] || continue
      # shellcheck disable=SC2053 # a glob pattern, as systemctl matches it
      [ -z "$pat" ] || [[ $name == $pat ]] || continue
      [ -z "$states" ] || [[ ",$states," == *",$active,"* ]] || continue
      printf '%s %s %s %s\n' "$name" "$load" "$active" "$rest"
    done
    exit 0
    ;;
  stop)
    rc=$(cat "$st/stop_rc" 2>/dev/null || echo 0)
    [ "$rc" = 0 ] && touch "$st/u/$3.stopped"
    exit "$rc" ;;
  reset-failed)
    exit "$(cat "$st/reset_rc" 2>/dev/null || echo 0)" ;;
  enable)
    rc=$(cat "$st/enable_rc" 2>/dev/null || echo 0)
    [ "$rc" = 0 ] && ln -s "$STUB_UNIT_DIR/$3" "$STUB_WANTS_DIR/$3"
    exit "$rc" ;;
  disable)
    rm -f "$STUB_WANTS_DIR/$3"
    exit "$(cat "$st/disable_rc" 2>/dev/null || echo 0)" ;;
  daemon-reload)
    exit "$(cat "$st/reload_rc" 2>/dev/null || echo 0)" ;;
esac
exit 0
EOF
cat >"$SB/stub/systemd-run" <<'EOF'
#!/usr/bin/bash
# Records the unit (and, E3J9D-R, its complete argv for property derivation;
# --on-active also creates the transient timer); simulates the key/store
# effects of the few commands the launcher runs, driven by files in
# $STUB_STATE; $STUB_STORE is the sandbox store.
st=$STUB_STATE
echo "systemd-run $*" >>"$st/run_calls"
mkdir -p "$st/u"
unit='' timer=0
for a in "$@"; do
  case "$a" in
    --unit=*)
      unit=${a#--unit=}
      touch "$st/u/$unit.service"
      ;;
    --on-active=*) timer=1 ;;
    --setenv=E3J9_PTY_NONCE=* | --setenv=E3J9_INJECTED=*) printf '%s\n' "${a#--setenv=*=}" >"$st/nonce" ;;
  esac
done
if [ -n "$unit" ]; then
  printf '%s\0' "$@" >"$st/u/$unit.service.argv"
  [ "$timer" -eq 0 ] || touch "$st/u/$unit.timer"
fi
# Provider-run side effects for the postcondition tests (the CLI rewriting the
# entry with another mode, a fallback file, an extra entry, a lingering process).
if [[ $unit == eanhl-cloud-cred-pprobe-* ]]; then
  [ ! -e "$st/post_entry_mode" ] || chmod "$(cat "$st/post_entry_mode")" "$STUB_STORE/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
  [ ! -e "$st/post_fallback" ] || : >"$STUB_STORE/../auth-session.json"
  [ ! -e "$st/post_extra" ] || : >"$STUB_STORE/extra.gpg"
  if [ -e "$st/pids_after" ]; then
    cp "$st/pids_after" "$st/pids"
    echo 0 >"$st/pgrep_rc"
  fi
fi
case " $* " in *' --quick-generate-key '*) touch "$st/generated" ;; esac
case " $* " in *' --delete-secret-and-public-key '*) touch "$st/deleted" ;; esac
case " $* " in
  *' pass init '*)
    if [ -e "$st/init_writes" ]; then
      cat "$st/init_writes" >"$STUB_STORE/.gpg-id"
      chmod 600 "$STUB_STORE/.gpg-id"
    fi
    [ -e "$st/init_extra" ] && : >"$STUB_STORE/extra.gpg" ;;
  *' pass rm -f '*)
    [ -e "$st/rm_keeps" ] || rm -f "$STUB_STORE/${*: -1}.gpg"
    [ -e "$st/lock_parent_after" ] && chmod 000 "$STUB_STORE/ch.proton.drive" ;;
  *' auth logout '*)
    [ -e "$st/lock_parent_after" ] && chmod 000 "$STUB_STORE/ch.proton.drive" ;;
esac
case " $* " in
  *' --pipe '*)
    if [ -e "$st/deleted" ]; then cat "$st/keylist_deleted" 2>/dev/null
    elif [ -e "$st/generated" ] && [ -e "$st/keylist_after" ]; then cat "$st/keylist_after"
    else cat "$st/keylist" 2>/dev/null; fi ;;
esac
case " $* " in *' --pipe '*) exit "$(cat "$st/pipe_rc" 2>/dev/null || echo 0)" ;; esac
exit "$(cat "$st/run_rc" 2>/dev/null || echo 0)"
EOF
cat >"$SB/stub/journalctl" <<'EOF'
#!/usr/bin/bash
st=$STUB_STATE
echo "journalctl $*" >>"$st/calls"
[ "$1" = --sync ] && exit 0
# E3J9D-R per-unit id view (never-reused and single-invocation proofs): only
# the invocation-id field is requested; journald adds cursor, timestamps and
# _BOOT_ID. Before the unit exists only history.tsv is visible; afterwards
# idjson.tsv (if present) or journal.tsv. Knobs: idjson_rc, json_boot (every
# record's _BOOT_ID), json_noinv (records lack the invocation id).
case " $* " in
  *' --output-fields=_SYSTEMD_INVOCATION_ID '*)
    rc=$(cat "$st/idjson_rc" 2>/dev/null || echo 0)
    [ "$rc" = 0 ] || exit "$rc"
    unit=''
    for a in "$@"; do case "$a" in _SYSTEMD_UNIT=*) unit=${a#_SYSTEMD_UNIT=} ;; esac; done
    if [ -e "$st/idjson_fail_started" ] && { [ -e "$st/u/$unit" ] || [ -f "${STUB_UNIT_DIR:-/nonexistent}/$unit" ]; }; then exit 1; fi
    src=$st/journal.tsv
    [ -f "$st/idjson.tsv" ] && src=$st/idjson.tsv
    if [ ! -e "$st/u/$unit" ] && ! [ -f "${STUB_UNIT_DIR:-/nonexistent}/$unit" ]; then src=$st/history.tsv; fi
    [ -f "$src" ] || exit 0
    boot=$(tr -d '\n-' <"$STUB_BOOT_FILE")
    [ -e "$st/json_boot" ] && boot=$(cat "$st/json_boot")
    while IFS=$'\t' read -r rinv rprefix msg; do
      case "$unit" in "$rprefix"*) ;; *) continue ;; esac
      if [ -e "$st/json_noinv" ]; then
        printf '{"__CURSOR":"s=1","__REALTIME_TIMESTAMP":"1","__MONOTONIC_TIMESTAMP":"1","_BOOT_ID":"%s"}\n' "$boot"
      else
        printf '{"__CURSOR":"s=1","__REALTIME_TIMESTAMP":"1","__MONOTONIC_TIMESTAMP":"1","_BOOT_ID":"%s","_SYSTEMD_INVOCATION_ID":"%s"}\n' "$boot" "$rinv"
      fi
    done <"$src"
    exit 0
    ;;
esac
rc=$(cat "$st/journal_rc" 2>/dev/null || echo 0)
[ "$rc" = 0 ] || exit "$rc"
case " $* " in
  *' json '*)
    jrc=$(cat "$st/json_rc" 2>/dev/null || echo 0)
    [ "$jrc" = 0 ] || exit "$jrc"
    cat "$st/journal_json" 2>/dev/null
    [ -e "$st/leak_nonce" ] && [ -e "$st/nonce" ] && printf '{"MESSAGE":"%s"}\n' "$(cat "$st/nonce")"
    exit 0 ;;
esac
unit='' inv=''
for a in "$@"; do
  case "$a" in
    _SYSTEMD_UNIT=*) unit=${a#_SYSTEMD_UNIT=} ;;
    _SYSTEMD_INVOCATION_ID=*) inv=${a#_SYSTEMD_INVOCATION_ID=} ;;
  esac
done
[ -f "$st/journal.tsv" ] || exit 0
while IFS=$'\t' read -r rinv rprefix msg; do
  [ -n "$inv" ] && [ "$inv" != "$rinv" ] && continue
  case "$unit" in "$rprefix"*) printf '%s\n' "$msg" ;; esac
done <"$st/journal.tsv"
exit 0
EOF
cat >"$SB/stub/setpriv" <<'EOF'
#!/usr/bin/bash
# Records every call, its physical working directory and its exact argv (NUL-
# separated, one record per call ending in an empty element). With
# $st/require_root_cwd present it models the Hotel-Echo failure: the real
# service identity cannot use an operator's working directory (GNU find: "Failed
# to restore initial working directory"), so any cwd other than exactly / exits 97.
st=$STUB_STATE
echo "setpriv $*" >>"$st/setpriv_calls"
cwd=$(pwd -P)
printf '%s\n' "$cwd" >>"$st/setpriv_cwd"
printf '%s\0' "$@" '' >>"$st/setpriv_argv"
if [ -e "$st/require_root_cwd" ] && [ "$cwd" != / ]; then exit 97; fi
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done
shift
if [ -e "$st/find_fail" ] && [ "${1##*/}" = find ]; then exit 1; fi
if [ -e "$st/bash_fail" ] && [ "${1##*/}" = bash ]; then exit 1; fi
exec "$@"
EOF
cat >"$SB/stub/pgrep" <<'EOF'
#!/usr/bin/bash
st=$STUB_STATE
cat "$st/pids" 2>/dev/null
exit "$(cat "$st/pgrep_rc" 2>/dev/null || echo 1)"
EOF
cat >"$SB/stub/od" <<'EOF'
#!/usr/bin/bash
# /dev/urandom through od, unless od_out forces the output (nonce tests).
st=$STUB_STATE
if [ -f "$st/od_out" ]; then
  cat "$st/od_out"
  exit 0
fi
exec /usr/bin/od "$@"
EOF
chmod +x "$SB/stub/"*
# E3J9D-R sandbox: the boot id (canonical, one LF) and a root-like
# /etc/systemd/system chain owned by the test user, modes 0755.
BOOT_UUID=0123abcd-4567-89ab-cdef-0123456789ab
BOOT_HEX=0123abcd456789abcdef0123456789ab
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
ER=$SB/etcroot
UD=$ER/etc/systemd/system
WD=$UD/timers.target.wants
mkdir -p "$WD"
chmod 755 "$ER" "$ER/etc" "$ER/etc/systemd" "$UD" "$WD"
UPL=$W/unit-publish-launcher
sed -e "s#^readonly SVC=.*#readonly SVC=$ME#" \
  -e "s#^readonly WRAPPER=.*#readonly WRAPPER=$SB/wrapper#" \
  -e "s#^readonly VALIDATION_DIR=.*#readonly VALIDATION_DIR=$SB/val#" \
  -e "s#^readonly SVC_HOME=.*#readonly SVC_HOME=$SB/home#" \
  -e "s#^readonly SVC_CACHE=.*#readonly SVC_CACHE=$SB/cache#" \
  -e "s#^readonly STORE=.*#readonly STORE=$SB/home/password-store#" \
  -e "s#^readonly GNUPG_DIR=.*#readonly GNUPG_DIR=$SB/home/gnupg#" \
  -e "s#^readonly LOCK_FILE=.*#readonly LOCK_FILE=$SB/home/locks/credential.lock#" \
  -e "s#^readonly CLI=.*#readonly CLI=$SB/cli#" \
  -e "s#^readonly CLI_PIN=.*#readonly CLI_PIN=$CLI_SHA#" \
  -e "s#^readonly PROC_ROOT=.*#readonly PROC_ROOT=$SB/proc#" \
  -e "s#^readonly SYSTEMCTL=.*#readonly SYSTEMCTL=$SB/stub/systemctl#" \
  -e "s#^readonly SYSTEMD_RUN=.*#readonly SYSTEMD_RUN=$SB/stub/systemd-run#" \
  -e "s#^readonly JOURNALCTL=.*#readonly JOURNALCTL=$SB/stub/journalctl#" \
  -e "s#^readonly SETPRIV=.*#readonly SETPRIV=$SB/stub/setpriv#" \
  -e "s#^readonly PGREP=.*#readonly PGREP=$SB/stub/pgrep#" \
  -e "s#^readonly OD=.*#readonly OD=$SB/stub/od#" \
  -e "s#^readonly BOOT_ID_FILE=.*#readonly BOOT_ID_FILE=$SB/boot_id#" \
  -e "s#^readonly UNIT_DIR=.*#readonly UNIT_DIR=$UD#" \
  -e "s#^readonly WANTS_DIR=.*#readonly WANTS_DIR=$WD#" \
  -e "s#^readonly UNIT_PUBLISH=.*#readonly UNIT_PUBLISH=$UPL#" \
  -e "s#^readonly ROOT_UID=.*#readonly ROOT_UID=$MYUID#" \
  -e "s#^readonly ROOT_GID=.*#readonly ROOT_GID=$MYGID#" \
  -e "s#^readonly PP_WAIT=.*#readonly PP_WAIT=2#" \
  -e "s#/usr/bin/id#$SB/stub/id#g" \
  -e "s#/usr/bin/sleep#/usr/bin/true#g" \
  -e "s#bound_wait_read 330#bound_wait_read 2#g" \
  "$LAUNCHER_SRC" | sed -e "s#\"\$SVC \$SVC\"#\"$ME $MYGRP\"#g" -e "s#700 \$SVC \$SVC#700 $ME $MYGRP#g" -e "s#600 \$SVC \$SVC#600 $ME $MYGRP#g" >"$L"
# Test-only resident-agent rules (NOT host facts): exact exe, PPid 1, and a
# cgroup inside a credential transient unit.
export RULE_LINE='readonly RESIDENT_AGENT_RULES=("/usr/bin/gpg-agent|1|^/system\.slice/eanhl-cloud-cred-[a-z0-9-]+\.service$" "/usr/libexec/keyboxd|1|^/system\.slice/eanhl-cloud-cred-[a-z0-9-]+\.service$")'
awk '$0 == "readonly RESIDENT_AGENT_RULES=()" { print ENVIRON["RULE_LINE"]; next } { print }' "$L" >"$L.tmp" && mv "$L.tmp" "$L"
chmod +x "$L"
t "launcher test copy: resident-agent rules injected (test values only)" grep -q -F 'readonly RESIDENT_AGENT_RULES=("/usr/bin/gpg-agent|1|' "$L"
t "launcher test copy: every stubbed constant substituted" bash -c "! grep -q -E '^readonly (SYSTEMCTL|SYSTEMD_RUN|JOURNALCTL|SETPRIV|PGREP)=/usr/bin' '$L' && ! grep -q '/usr/bin/id' '$L'"
export STUB_STATE=$ST
t "launcher test copy: every E3J9D-R constant substituted (od, boot id, unit dirs, helper, root ids, wait)" bash -c "
  for l in 'readonly OD=$SB/stub/od' 'readonly BOOT_ID_FILE=$SB/boot_id' 'readonly UNIT_DIR=$UD' 'readonly WANTS_DIR=$WD' \
    'readonly UNIT_PUBLISH=$UPL' 'readonly ROOT_UID=$MYUID' 'readonly ROOT_GID=$MYGID' 'readonly PP_WAIT=2'; do grep -q -x -F \"\$l\" '$L' || exit 1; done
  ! grep -q -E '^readonly (UNIT_DIR|WANTS_DIR|BOOT_ID_FILE)=/(etc|proc)' '$L'"
export STUB_UNIT_DIR=$UD STUB_WANTS_DIR=$WD STUB_BOOT_FILE=$SB/boot_id
export STUB_STORE=$SB/home/password-store
libify() { sed '/^case "\${1-}" in$/,$d' "$1" >"$2"; }
LLIB=$W/launcher-lib
libify "$L" "$LLIB"
stub_register_local() { # stub_register_local <unit> <local mode>: the unit exists exactly as the launcher builds it
  mkdir -p "$ST/u"
  touch "$ST/u/$1.service"
  bash -c ". '$LLIB'; printf '%s\0' --quiet --no-block --unit='$1' --description=\"\$BOUND_DESC\" \"\${LOCAL_BOUND_PROPS[@]}\" \"\$WRAPPER\" --nonblock probe 'local:$2'" >"$ST/u/$1.service.argv"
}
FPR=AAAABBBBCCCCDDDDEEEEFFFF0000111122223333
keylist() { printf '%s\n' 'sec:u:255:22:0123456789ABCDEF:1790000000:::u:::scESC:::+::ed25519:::0:' "fpr:::::::::$FPR:" 'grp:::::::::0000000000000000000000000000000000000000:' 'uid:u::::1790000000::HASH::EANHL cloud uploader credential store (Hotel-Echo)::::::::::0:' 'ssb:u:255:18:FEDCBA9876543210:1790000000::::::e:::+::cv25519::' 'fpr:::::::::9999888877776666555544443333222211110000:' 'grp:::::::::1111111111111111111111111111111111111111:'; }
reset_state() {
  rm -rf "$ST"
  mkdir -p "$ST"
  keylist >"$ST/keylist"
}

# 6a. key-metadata parser (public metadata only)
reset_state
lout=$(bash -c ". '$LLIB'; emit_key_metadata \"\$(list_secret_keys)\"; primary_fpr_upper \"\$(list_secret_keys)\"; emit x_bad 'Has Upper'")
t "key metadata: fpr lowercase" grep -q -x "E3J9 key_primary_fpr=${FPR,,}" <<<"$lout"
t "key metadata: counts and uid match" bash -c "grep -q -x 'E3J9 key_secret_count=1' <<<\"\$1\" && grep -q -x 'E3J9 key_subkey_count=1' <<<\"\$1\" && grep -q -x 'E3J9 key_uid_match=true' <<<\"\$1\"" _ "$lout"
t "key metadata: usage/caps/curve/expiry" bash -c "grep -q -x 'E3J9 key_primary_usage=sc' <<<\"\$1\" && grep -q -x 'E3J9 key_total_caps=esc' <<<\"\$1\" && grep -q -x 'E3J9 key_subkey_curve=cv25519' <<<\"\$1\" && grep -q -x 'E3J9 key_primary_expires=never' <<<\"\$1\"" _ "$lout"
t "key metadata: keygrip never printed" bash -c "! grep -q -E '0{40}|1{40}' <<<\"\$1\"" _ "$lout"
t "primary_fpr_upper" grep -q -x "$FPR" <<<"$lout"
t "launcher emit sanitises out-of-vocabulary value" grep -q -x 'E3J9 x_bad=invalid' <<<"$lout"

# 6b. journal_hits_since fails closed
check_hits_invalid() { # check_hits_invalid <launcher-lib>
  reset_state
  echo 1 >"$ST/journal_rc"
  [ "$(bash -c ". '$1'; journal_hits_since 0 marker")" = invalid ]
}
t "journal_hits_since: unreadable journal → invalid (never 0)" check_hits_invalid "$LLIB"
reset_state
printf '{"MESSAGE":"a marker b"}\n{"MESSAGE":"x"}\n' >"$ST/journal_json"
t "journal_hits_since: counts marker lines" test "$(bash -c ". '$LLIB'; journal_hits_since 0 marker")" = 1
mutation "journal_hits_since ignores journalctl failure" "$LLIB" '/^journal_hits_since() {/,/^}/s/if \[ "\$rc" -ne 0 \]; then/if false; then/' check_hits_invalid

# 6c. pass-init refuses when the store scan fails (never counts as empty)
check_pass_init_scan_fail() { # check_pass_init_scan_fail <launcher>
  reset_state
  touch "$ST/find_fail"
  local out
  out=$("$1" pass-init "$FPR")
  grep -q -x 'E3J9 launcher_refused=store_unreadable' <<<"$out"
}
t "pass-init: failed store scan → refused store_unreadable" check_pass_init_scan_fail "$L"
mutation "svc_count ignores find failure" "$L" '/^svc_count() {/,/^}/s/\[ "\$rc" -eq 0 \] || return 1/:/' check_pass_init_scan_fail
reset_state
printf '%s\n' "$FPR" >"$ST/init_writes"
out=$("$L" pass-init "$FPR")
rc=$?
t "pass-init: empty store → key match, unit run, postconditions, exit 0" bash -c "[ $rc -eq 0 ] && grep -q -x 'E3J9 pass_init_key_match=true' <<<\"\$1\" && grep -q -x 'E3J9 pass_init_postconditions_ok=true' <<<\"\$1\"" _ "$out"
rm -f "$SB/home/password-store/.gpg-id"
t "pass-init: every store read went through setpriv" grep -q -- '--reuid=' "$ST/setpriv_calls"
reset_state
: >"$SB/home/password-store/stray"
out=$("$L" pass-init "$FPR")
t "pass-init: non-empty store → refused store_not_empty" grep -q -x 'E3J9 launcher_refused=store_not_empty' <<<"$out"
rm -f "$SB/home/password-store/stray"
out=$("$L" pass-init not-a-fpr)
t "pass-init: bad fingerprint refused" grep -q -x 'E3J9 launcher_refused=bad_fingerprint' <<<"$out"

# 6d. keygen refuses a non-empty GNUPGHOME before any gpg run
reset_state
: >"$SB/home/gnupg/leftover"
out=$("$L" keygen)
t "keygen: non-empty GNUPGHOME → refused, no unit started" bash -c "grep -q -x 'E3J9 launcher_refused=gnupghome_not_empty' <<<\"\$1\" && [ ! -e '$ST/run_calls' ]" _ "$out"
rm -f "$SB/home/gnupg/leftover"

# 6d'. safe working directory before every privilege drop (E3J9C §19.5). On
# Hotel-Echo the launcher was run from /home/utiz (0750); setpriv inherited that
# cwd and GNU find as eanhl-cloud failed, so keygen refused gnupghome_unreadable.
# Here the launcher is invoked from a private caller directory and the setpriv
# stub (require_root_cwd) refuses any cwd other than exactly /. This proves the
# template enters / before the (stubbed) setpriv boundary; the real GNU find
# behaviour is the recorded host reproduction, not something this test runs.
PRIV=$W/private-caller
mkdir -p "$PRIV"
chmod 700 "$PRIV"
cwd_all_root() { [ -s "$ST/setpriv_cwd" ] && ! grep -v -x -F / "$ST/setpriv_cwd" | grep -q .; }
reset_state
touch "$ST/require_root_cwd"
(cd "$PRIV" && "$SB/stub/setpriv" --reuid="$ME" -- /usr/bin/true)
t "safe-cwd model: the stub refuses a non-/ cwd (exit 97)" test "$?" -eq 97
check_launcher_safe_cwd() { # check_launcher_safe_cwd <launcher>: keygen from a private cwd
  reset_state
  : >"$ST/keylist"
  keylist >"$ST/keylist_after"
  rm -rf "$SB/home/gnupg"/* "$SB/home/gnupg"/.[!.]* 2>/dev/null
  touch "$ST/require_root_cwd"
  (cd "$PRIV" && "$1" keygen) >"$ST/out"
  local rc=$?
  [ "$rc" -eq 0 ] && grep -q -x 'E3J9 gnupghome_entry_count_before=0' "$ST/out" &&
    grep -q -x 'E3J9 keygen_postconditions_ok=true' "$ST/out" && cwd_all_root
}
t "keygen from a private caller cwd: svc_meta/svc_count reach setpriv with cwd /, exit 0" check_launcher_safe_cwd "$L"
mutation "launcher as_svc without the safe-cwd step" "$L" 's#^as_svc() ( cd / || exit 70; exec #as_svc() ( exec #' check_launcher_safe_cwd
check_pi_safe_cwd() { # check_pi_safe_cwd <launcher>: pass-init (svc_meta, svc_count, .gpg-id read)
  reset_state
  printf '%s\n' "$FPR" >"$ST/init_writes"
  touch "$ST/require_root_cwd"
  (cd "$PRIV" && "$1" pass-init "$FPR") >"$ST/out"
  local rc=$?
  rm -f "$SB/home/password-store/.gpg-id"
  [ "$rc" -eq 0 ] && grep -q -x 'E3J9 pass_init_postconditions_ok=true' "$ST/out" && cwd_all_root
}
t "pass-init from a private caller cwd: every store read reaches setpriv with cwd /, exit 0" check_pi_safe_cwd "$L"
cat >"$W/as-svc-argv.sh" <<'EOF'
# as-svc-argv.sh <launcher-lib> <private-dir> <state>: as_svc preserves argv,
# stdout/stderr redirection and exit status exactly.
. "$1"
cd "$2" || exit 90
args=('%s\0' 'a b' '' '-x' $'new\nline' '*' '--' "'q'" '$HOME')
as_svc /usr/bin/printf "${args[@]}" >"$3/argv_out" || exit 91
/usr/bin/printf "${args[@]}" >"$3/argv_direct"
cmp -s "$3/argv_out" "$3/argv_direct" || exit 92
printf '%s\0' --reuid="$SVC" --regid="$SVC" --clear-groups -- /usr/bin/printf "${args[@]}" '' >"$3/argv_expected"
tail_rec=$(tail -c "$(wc -c <"$3/argv_expected")" "$3/setpriv_argv" | od -An -tx1)
[ "$tail_rec" = "$(od -An -tx1 <"$3/argv_expected")" ] || exit 93
as_svc /bin/sh -c 'exit 42'
[ "$?" -eq 42 ] || exit 94
[ "$(as_svc /bin/sh -c 'echo out; echo err >&2' 2>/dev/null)" = out ] || exit 95
[ "$(as_svc /bin/sh -c 'echo out; echo err >&2' 2>&1 >/dev/null)" = err ] || exit 96
exit 0
EOF
reset_state
touch "$ST/require_root_cwd"
bash "$W/as-svc-argv.sh" "$LLIB" "$PRIV" "$ST"
t "as_svc from a private cwd: argv byte-for-byte, exit status and stdout/stderr preserved" test "$?" -eq 0
t "as_svc from a private cwd: every setpriv call saw cwd /" cwd_all_root
sed 's#^as_svc() ( cd / || exit 70; #as_svc() ( cd /nonexistent-e3j9 || exit 70; #' "$LLIB" >"$W/llib-nocd"
reset_state
bash -c ". '$W/llib-nocd'; as_svc /usr/bin/true" 2>/dev/null
rc=$?
t "as_svc: failing to enter the safe cwd → exit 70, setpriv never runs (fail closed)" bash -c "! cmp -s '$LLIB' '$W/llib-nocd' && [ $rc -eq 70 ] && [ ! -e '$ST/setpriv_calls' ]"

# 6e. the invocation-bound probe operation
INV=0123456789abcdef0123456789abcdef
OLD=fedcba9876543210fedcba9876543210
probe_setup() { # probe_setup <mode>
  reset_state
  echo "$INV" >"$ST/invid"
}
jrec() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$ST/journal.tsv"; }
run_probe() { "$1" probe "$2" >"$ST/out"; echo $? >"$ST/rc"; }
res() { grep -x -E 'E3J9 probe_run_result=[a-z]+' "$ST/out" | sed 's/.*=//'; }
rc_of() { cat "$ST/rc"; }

reset_state
"$L" probe provider >"$ST/out"
t "probe op: provider mode refused before any unit" bash -c "[ \$? -ne 0 ] || true; grep -q -x 'E3J9 launcher_refused=usage' '$ST/out' && [ ! -e '$ST/run_calls' ]"
reset_state
"$L" probe canary-nested >"$ST/out"
t "probe op: canary-nested refused" grep -q -x 'E3J9 launcher_refused=usage' "$ST/out"

probe_setup local
echo loaded >"$ST/loadstate"
run_probe "$L" local
t "probe op: unit name collision → refused, no start" bash -c "grep -q -x 'E3J9 bound_unit_collision=true' '$ST/out' && [ ! -e '$ST/run_calls' ] && [ \"\$(cat '$ST/rc')\" = 70 ]"

probe_setup local
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
run_probe "$L" local
t "probe op: bound invocation, clean records → pass, exit 0" test "$(res):$(rc_of)" = pass:0
t "probe op: started exactly one unit with local:<mode> and PrivateNetwork" bash -c "[ \"\$(wc -l <'$ST/run_calls')\" -eq 1 ] && grep -q -- 'probe local:local' '$ST/run_calls' && grep -q -- '--property=PrivateNetwork=yes' '$ST/run_calls' && ! grep -q -- '--collect' '$ST/run_calls'"
t "probe op: non-keep mode is stopped and reset" bash -c "grep -q '^systemctl stop' '$ST/calls' && grep -q '^systemctl reset-failed' '$ST/calls'"
t "probe op: output vocabulary-only" vocab_only "$(cat "$ST/out")"

check_stale_excluded() { # check_stale_excluded <launcher>: stale records must not pass
  probe_setup local
  jrec "$OLD" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
  jrec "$OLD" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
  jrec "$INV" eanhl-cloud-cred-other- 'E3J9 probe_result=pass'
  # E3J9D-R: isolate the bound read's invocation filter from the single-
  # invocation proof, which alone also rejects these records (tested below).
  printf '%s\t%s\t%s\n' "$INV" eanhl-cloud-cred-probe-local- x >"$ST/idjson.tsv"
  run_probe "$1" local
  [ "$(res):$(rc_of)" = fail:1 ]
}
t "probe op: records of another invocation/unit are excluded → fail" check_stale_excluded "$L"
mutation "bound reader without the _SYSTEMD_INVOCATION_ID match" "$L" 's/ "_SYSTEMD_INVOCATION_ID=\$B_ID"//' check_stale_excluded

check_first_line_rule() {
  probe_setup local
  jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 other=1'
  jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
  jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
  run_probe "$1" local
  [ "$(res)" = fail ]
}
t "probe op: first record must be probe_mode=<mode>" check_first_line_rule "$L"
mutation "classifier without the first-line rule" "$L" '/^classify_probe() {/,/^}/{/\[ "\${B_RECORDS\[0\]}" = "E3J9 probe_mode=\$mode" \]/d}' check_first_line_rule

probe_setup local
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
jrec "$INV" eanhl-cloud-cred-probe-local- 'free text with a secret-looking thing'
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
run_probe "$L" local
t "probe op: non-vocabulary record counted, never printed, fails" bash -c "[ \"\$(grep -c secret-looking '$ST/out')\" -eq 0 ] && grep -q -x 'E3J9 bound_nonvocab_lines=1' '$ST/out' && [ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ]"

probe_setup local
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
run_probe "$L" local
t "probe op: duplicated result line → fail" test "$(res)" = fail

probe_setup local
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
echo 1 >"$ST/status"
run_probe "$L" local
t "probe op: non-zero exit status → fail" test "$(res):$(rc_of)" = fail:1

probe_setup local
: >"$ST/invid"
run_probe "$L" local
t "probe op: invocation never bound → exit 70, unit stopped" bash -c "grep -q -x 'E3J9 bound_invocation=false' '$ST/out' && [ \"\$(cat '$ST/rc')\" = 70 ] && grep -q '^systemctl stop' '$ST/calls'"

probe_setup local
echo "$OLD" >"$ST/invid_after"
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_mode=local'
jrec "$INV" eanhl-cloud-cred-probe-local- 'E3J9 probe_result=pass'
run_probe "$L" local
t "probe op: invocation changed during the wait → fail" bash -c "grep -q -x 'E3J9 bound_invocation_changed=true' '$ST/out' && [ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ]"

probe_setup local
echo activating >"$ST/active"
echo start >"$ST/sub"
run_probe "$L" local
t "probe op: wait timeout → fail, unit stopped" bash -c "grep -q -x 'E3J9 bound_wait_timeout=true' '$ST/out' && [ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ]"

probe_setup local
echo 1 >"$ST/journal_rc"
run_probe "$L" local
t "probe op: journal unreadable → fail" bash -c "grep -q -x 'E3J9 bound_journal_ok=false' '$ST/out' && [ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ]"

probe_setup busy-a
echo 75 >"$ST/status"
echo failed >"$ST/active"
run_probe "$L" busy-a
t "probe op: busy-a with 75 and no records → busy, exit 0" test "$(res):$(rc_of)" = busy:0
probe_setup busy-a
jrec "$INV" eanhl-cloud-cred-probe-busy-a- 'E3J9 probe_mode=busy-a'
jrec "$INV" eanhl-cloud-cred-probe-busy-a- 'E3J9 unexpected_acquire=true'
jrec "$INV" eanhl-cloud-cred-probe-busy-a- 'E3J9 probe_result=fail'
echo 1 >"$ST/status"
echo failed >"$ST/active"
run_probe "$L" busy-a
t "probe op: busy-a that acquired the lock → fail, exit 1" test "$(res):$(rc_of)" = fail:1
probe_setup canary-a
echo 75 >"$ST/status"
echo failed >"$ST/active"
run_probe "$L" canary-a
t "probe op: canary-a busy is accepted (K6)" test "$(res):$(rc_of)" = busy:0
probe_setup local
echo 75 >"$ST/status"
echo failed >"$ST/active"
run_probe "$L" local
t "probe op: local busy is NOT accepted" test "$(res):$(rc_of)" = busy:1
probe_setup canary
jrec "$INV" eanhl-cloud-cred-probe-canary- 'E3J9 probe_mode=canary'
jrec "$INV" eanhl-cloud-cred-probe-canary- 'E3J9 probe_result=pass'
run_probe "$L" canary
t "probe op: keep mode (canary, K3) is left running" bash -c "grep -q -x 'E3J9 probe_unit_kept=true' '$ST/out' && ! grep -q '^systemctl stop' '$ST/calls'"
reset_state
echo loaded >"$ST/loadstate"
stub_register_local eanhl-cloud-cred-probe-canary-00112233aabbccdd canary
out=$("$L" probe-stop 'eanhl-cloud-cred-probe-canary-00112233aabbccdd')
rc=$?
t "probe-stop: loaded unit stopped and reset → exit 0" bash -c "[ $rc -eq 0 ] && grep -q -x 'E3J9 probe_stopped=true' <<<\"\$1\"" _ "$out"
out=$("$L" probe-stop 'sshd')
t "probe-stop: refuses other unit names" grep -q -x 'E3J9 launcher_refused=usage' <<<"$out"

# 6f. auth-login preflight (metadata only; FIFO tripwires on cmdline/environ)
pf_setup() {
  reset_state
  rm -rf "$SB/proc"
  mkdir -p "$SB/proc"
  rm -f "$SB/home/password-store/"* "$SB/home/password-store/.gpg-id"
  printf '%s\n' "$FPR" >"$SB/home/password-store/.gpg-id"
  chmod 600 "$SB/home/password-store/.gpg-id"
  : >"$SB/home/locks/credential.lock"
  printf 'cli-bytes\n' >"$SB/cli"
}
pf_proc() { # pf_proc <pid> <exe-target> [ppid] [cgroup-file-content] [euid]
  local ppid=${3:-1} cg=${4:-0::/system.slice/eanhl-cloud-cred-keygen-0a1b2c3d.service} eu=${5:-$MYUID}
  [ -n "$cg" ] || cg=0::/system.slice/eanhl-cloud-cred-keygen-0a1b2c3d.service
  mkdir -p "$SB/proc/$1"
  ln -s "$2" "$SB/proc/$1/exe"
  printf 'Name:\tx\nPPid:\t%s\nUid:\t%s\t%s\t%s\t%s\n' "$ppid" "$MYUID" "$eu" "$MYUID" "$MYUID" >"$SB/proc/$1/status"
  printf '%s\n' "$cg" >"$SB/proc/$1/cgroup"
  mkfifo "$SB/proc/$1/cmdline" "$SB/proc/$1/environ"
  printf '%s\n' "$1" >>"$ST/pids"
  echo 0 >"$ST/pgrep_rc"
}
pf_run() { # pf_run <launcher-lib>; rc 0 only if the preflight passes (124 = hung on a tripwire)
  timeout 10 bash -c ". '$1'; preflight_auth_login" >"$ST/pf_out"
}
pf_setup
t "preflight: clean state passes" pf_run "$LLIB"
pf_setup
pf_proc 101 /usr/bin/gpg-agent
t "preflight: one allowlisted resident gpg-agent passes (tripwires untouched)" pf_run "$LLIB"
pf_setup
pf_proc 101 /usr/bin/gpg-agent
pf_proc 102 /usr/libexec/keyboxd
t "preflight: gpg-agent + keyboxd, once each, pass" pf_run "$LLIB"
check_pf_refuses() { # check_pf_refuses <launcher-lib> <scenario-fn>
  "$2"
  pf_run "$1"
  local rc=$?
  [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]
}
sc_two_agents() { pf_setup; pf_proc 101 /usr/bin/gpg-agent; pf_proc 102 /usr/bin/gpg-agent; }
sc_cli() { pf_setup; pf_proc 101 "$SB/cli"; }
sc_other() { pf_setup; pf_proc 101 /usr/bin/bash; }
sc_deleted() { pf_setup; pf_proc 101 '/usr/bin/gpg-agent (deleted)'; }
sc_vanished() { pf_setup; printf '999\n' >"$ST/pids"; echo 0 >"$ST/pgrep_rc"; }
sc_pgrep_err() { pf_setup; echo 3 >"$ST/pgrep_rc"; }
sc_unit() { pf_setup; echo 'eanhl-cloud-cred-probe-local-x.service loaded active exited' >"$ST/units"; }
sc_units_err() { pf_setup; echo 1 >"$ST/units_rc"; }
sc_store_extra() { pf_setup; : >"$SB/home/password-store/extra"; }
sc_gpgid_mismatch() { pf_setup; printf '%s\n' 9999888877776666555544443333222211110000 >"$SB/home/password-store/.gpg-id"; }
sc_fallback() { pf_setup; : >"$SB/home/auth-session.json"; }
sc_pin() { pf_setup; printf 'other-bytes\n' >"$SB/cli"; }
sc_lock_symlink() { pf_setup; rm -f "$SB/home/locks/credential.lock"; ln -s "$SB/cli" "$SB/home/locks/credential.lock"; }
sc_lock_busy() {
  pf_setup
  /usr/bin/flock --exclusive "$SB/home/locks/credential.lock" sleep 5 &
  BG_PIDS+=("$!")
  disown "$!"
  sleep 0.3
}
sc_agent_wrong_ppid() { pf_setup; pf_proc 101 /usr/bin/gpg-agent 555; }
sc_agent_wrong_cgroup() { pf_setup; pf_proc 101 /usr/bin/gpg-agent 1 '0::/user.slice/user-1000.slice/session-1.scope'; }
sc_agent_two_cgroup_lines() { pf_setup; pf_proc 101 /usr/bin/gpg-agent 1 $'0::/system.slice/eanhl-cloud-cred-a-1.service\n1:name=x:/'; }
sc_agent_v1_cgroup() { pf_setup; pf_proc 101 /usr/bin/gpg-agent 1 '1:name=systemd:/system.slice/eanhl-cloud-cred-a-1.service'; }
sc_agent_wrong_euid() { pf_setup; pf_proc 101 /usr/bin/gpg-agent 1 '' 0; }
for sc in sc_agent_wrong_ppid sc_agent_wrong_cgroup sc_agent_two_cgroup_lines sc_agent_v1_cgroup sc_agent_wrong_euid sc_two_agents sc_cli sc_other sc_deleted sc_vanished sc_pgrep_err sc_unit sc_units_err sc_store_extra sc_gpgid_mismatch sc_fallback sc_pin sc_lock_symlink sc_lock_busy; do
  t "preflight refuses: ${sc#sc_}" check_pf_refuses "$LLIB" "$sc"
  rm -f "$SB/home/auth-session.json" "$SB/home/password-store/extra"
done
# Release the sc_lock_busy holder and give later scenarios a fresh lock inode.
for p in "${BG_PIDS[@]}"; do
  kill "$p" 2>/dev/null
  wait "$p" 2>/dev/null
done
BG_PIDS=()
rm -f "$SB/home/locks/credential.lock"
: >"$SB/home/locks/credential.lock"
sc_cli
pf_run "$LLIB"
t "preflight: CLI process named preflight_cli_running" grep -q -x 'E3J9 preflight_cli_running=true' "$ST/pf_out"
t "preflight: output vocabulary-only" vocab_only "$(cat "$ST/pf_out")"
mutation "agent rule without the cgroup check" "$LLIB" 's/if \[ "\${#cg_lines\[@\]}" -ne 1 \] || \[\[ \${cg_lines\[0\]} != 0::\* \]\] || ! \[\[ \${cg_lines\[0\]#0::} =~ \$r_cg \]\]; then/if false; then/' check_pf_refuses sc_agent_wrong_cgroup
mutation "agent rule without the parent check" "$LLIB" 's/\[ "\$ppid" = "\$r_ppid" \] || {/true || {/' check_pf_refuses sc_agent_wrong_ppid
mutation "preflight without the per-process rule check" "$LLIB" 's/agent_rule_holds "\$pid" "\$matched" || {/true || {/' check_pf_refuses sc_agent_wrong_cgroup

# 6g. fixed destructive subcommands refuse without their preconditions
reset_state
echo 'eanhl-cloud-cred-x.service loaded active running' >"$ST/units"
out=$("$L" entry-remove)
t "entry-remove: refuses while a credential unit is active" grep -q -x 'E3J9 launcher_refused=credential_unit_active' <<<"$out"
reset_state
out=$("$L" canary-remove)
t "canary-remove: refuses when the entry is absent, no unit run" bash -c "grep -q -x 'E3J9 launcher_refused=entry_not_regular_file' <<<\"\$1\" && [ ! -e '$ST/run_calls' ]" _ "$out"
reset_state
mkdir -p "$SB/home/password-store/ch.proton.drive/drive-sdk-cli"
: >"$SB/home/password-store/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
out=$("$L" key-delete "$FPR")
t "key-delete: refuses while the store holds an entry" grep -q -x 'E3J9 launcher_refused=store_has_entries' <<<"$out"
rm -rf "$SB/home/password-store/ch.proton.drive"
out=$("$L" key-delete 9999888877776666555544443333222211110000)
t "key-delete: refuses a fingerprint that is not the key's" grep -q -x 'E3J9 launcher_refused=fingerprint_mismatch' <<<"$out"
out=$("$L" bogus)
t "launcher: unknown subcommand refused" grep -q -x 'E3J9 launcher_refused=usage' <<<"$out"

# 6h. postconditions and exit statuses (every subcommand exits 0 only on full success)
SP=$SB/home/password-store
GD=$SB/home/gnupg
keylist_no_subkey() { keylist | grep -v -E '^(ssb|fpr:::::::::9999|grp:::::::::1111)'; }
keylist_expiring() { keylist | sed 's/^sec:u:255:22:0123456789ABCDEF:1790000000::/sec:u:255:22:0123456789ABCDEF:1790000000:1890000000:/'; }
keylist_two_uids() { keylist; printf '%s\n' 'uid:u::::1790000000::HASH2::Someone else::::::::::0:'; }
kg_run() { # kg_run <launcher> <after-listing-fn>: returns the launcher's exit status
  reset_state
  : >"$ST/keylist"
  rm -rf "$GD"/* "$GD"/.[!.]* 2>/dev/null
  "$2" >"$ST/keylist_after"
  "$1" keygen >"$ST/out"
}
kg_run "$L" keylist
t "keygen: expected topology → postconditions ok, exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 key_topology_ok=true' '$ST/out' && grep -q -x 'E3J9 keygen_postconditions_ok=true' '$ST/out'"
check_keygen_rejects() { # check_keygen_rejects <launcher> <listing-fn>
  kg_run "$1" "$2"
  local rc=$?
  [ "$rc" -eq 70 ] && grep -q -x 'E3J9 key_topology_ok=false' "$ST/out" && ! grep -q 'keygen_postconditions_ok' "$ST/out"
}
for fn in keylist_no_subkey keylist_expiring keylist_two_uids; do
  t "keygen: wrong topology ($fn) → exit 70" check_keygen_rejects "$L" "$fn"
done
mutation "keygen without the topology postcondition" "$L" 's/check_key_topology "\$listing" || fail_post key_topology/check_key_topology "$listing" || :/' check_keygen_rejects keylist_no_subkey

pi_run() { # pi_run <launcher> [init_writes-fpr] [extra]
  reset_state
  rm -f "$SP/.gpg-id" "$SP/extra.gpg"
  [ -n "${2-}" ] && printf '%s\n' "$2" >"$ST/init_writes"
  [ -n "${3-}" ] && touch "$ST/init_extra"
  "$1" pass-init "$FPR" >"$ST/out"
}
pi_run "$L"
t "pass-init: unit rc 0 but no .gpg-id → exit 70 (gpg_id_unreadable)" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 launcher_failed=gpg_id_unreadable' '$ST/out'"
check_pi_mismatch() {
  pi_run "$1" 9999888877776666555544443333222211110000
  [ "$?" -eq 70 ] && grep -q -x 'E3J9 launcher_failed=gpg_id_mismatch' "$ST/out"
}
t "pass-init: .gpg-id holds another fingerprint → exit 70" check_pi_mismatch "$L"
mutation "pass-init ignores a .gpg-id mismatch" "$L" 's/fail_post gpg_id_mismatch/:/' check_pi_mismatch
pi_run "$L" "$FPR" extra
t "pass-init: an extra store entry after init → exit 70" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 launcher_failed=store_not_gpg_id_only' '$ST/out'"
rm -f "$SP/.gpg-id" "$SP/extra.gpg"
reset_state
echo 1 >"$ST/run_rc"
"$L" pass-init "$FPR" >"$ST/out"
t "pass-init: failing unit → exit 70" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 launcher_failed=pass_init_unit' '$ST/out'"

check_logout_unit_fail() {
  reset_state
  rm -rf "$SP/ch.proton.drive"
  echo 1 >"$ST/run_rc"
  "$1" auth-logout >"$ST/out"
  [ "$?" -ne 0 ] && grep -q -x 'E3J9 auth_logout_unit_rc=1' "$ST/out"
}
t "auth-logout: failing unit → non-zero exit" check_logout_unit_fail "$L"
mutation "auth-logout ignores the unit result" "$L" 's/\[ "\$rc" -eq 0 \] || fail_post auth_logout_unit/:/' check_logout_unit_fail
reset_state
mkdir -p "$SP/ch.proton.drive/drive-sdk-cli"
: >"$SP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
"$L" auth-logout >"$ST/out"
t "auth-logout: entry still present → non-zero exit" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 auth_entry_after_logout=present' '$ST/out'"
rm -rf "$SP/ch.proton.drive"
reset_state
"$L" auth-logout >"$ST/out"
t "auth-logout: unit ok and entry proven absent → exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 auth_entry_after_logout=absent' '$ST/out'"
reset_state
touch "$ST/bash_fail"
"$L" auth-logout >"$ST/out"
t "auth-logout: entry state unknown (check error) → non-zero exit" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 auth_entry_after_logout=error' '$ST/out'"

er_setup() {
  reset_state
  mkdir -p "$SP/ch.proton.drive/drive-sdk-cli"
  printf 'not-a-real-entry\n' >"$SP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
  chmod 600 "$SP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
}
er_setup
"$L" entry-remove >"$ST/out"
t "entry-remove: entry removed and proven absent → exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 entry_after=absent' '$ST/out'"
er_setup
touch "$ST/bash_fail"
"$L" entry-remove >"$ST/out"
t "entry-remove: absence check error is not absence → exit 70" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 entry_after=error' '$ST/out'"
er_setup
touch "$ST/rm_keeps"
"$L" entry-remove >"$ST/out"
t "entry-remove: entry still present after the unit → exit 70" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 entry_after=present' '$ST/out'"
rm -rf "$SP/ch.proton.drive"

kd_setup() {
  reset_state
  rm -rf "$SP/ch.proton.drive"
  printf '%s\n' "$FPR" >"$SP/.gpg-id"
  chmod 600 "$SP/.gpg-id"
  mkdir -p "$GD/openpgp-revocs.d"
  : >"$GD/openpgp-revocs.d/$FPR.rev"
}
kd_setup
"$L" key-delete "$FPR" >"$ST/out"
t "key-delete: key gone, revocation file gone → exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 key_secret_count_after=0' '$ST/out' && grep -q -x 'E3J9 revocation_file_after=absent' '$ST/out' && [ ! -e '$GD/openpgp-revocs.d/$FPR.rev' ]"
check_kd_key_remains() {
  kd_setup
  keylist >"$ST/keylist_deleted"
  "$1" key-delete "$FPR" >"$ST/out"
  [ "$?" -eq 70 ] && grep -q -x 'E3J9 launcher_failed=secret_key_remains' "$ST/out"
}
t "key-delete: secret key still listed afterwards → exit 70" check_kd_key_remains "$L"
mutation "key-delete without the final key-count postcondition" "$L" 's/\[ "\$count" = 0 \] || fail_post secret_key_remains/:/' check_kd_key_remains
kd_setup
touch "$ST/bash_fail"
"$L" key-delete "$FPR" >"$ST/out"
t "key-delete: store state unknown → refused, no deletion" bash -c "[ $? -eq 70 ] && grep -q -x 'E3J9 launcher_refused=store_state_unknown' '$ST/out' && ! grep -q -- '--delete-secret-and-public-key' '$ST/run_calls'"
rm -rf "$GD/openpgp-revocs.d" "$SP/.gpg-id"

# 6h'. svc_exists: a genuine filesystem presence proof (no stubs below the
# setpriv pass-through; real directories, real modes, real symlinks)
FX=$SB/home/fsx
fs_setup() {
  reset_state
  chmod -R u+rwx "$FX" 2>/dev/null
  rm -rf "$FX"
  mkdir -p "$FX/a" "$FX/locked" "$FX/xonly"
  : >"$FX/a/file"
  : >"$FX/afile"
  : >"$FX/locked/obj"
  : >"$FX/xonly/obj"
  ln -s "$FX/a/does-not-exist" "$FX/a/dangle"
  ln -s "$FX/a" "$FX/linkdir"
  chmod 000 "$FX/locked"
  chmod 100 "$FX/xonly"
}
fs_restore() { chmod -R u+rwx "$FX" 2>/dev/null; }
sx() { bash -c ". '$1'; svc_exists '$2'"; }
fs_setup
t "svc_exists: present object → present" test "$(sx "$LLIB" fsx/a/file)" = present
t "svc_exists: absent object under traversable parents → absent" test "$(sx "$LLIB" fsx/a/none)" = absent
t "svc_exists: missing intermediate directory → absent" test "$(sx "$LLIB" fsx/missing/x)" = absent
t "svc_exists: dangling symlink → present" test "$(sx "$LLIB" fsx/a/dangle)" = present
t "svc_exists: parent mode 000 → error, never absent" test "$(sx "$LLIB" fsx/locked/obj)" = error
t "svc_exists: parent mode 000, absent name → error, never absent" test "$(sx "$LLIB" fsx/locked/none)" = error
t "svc_exists: parent searchable but unreadable (mode 100) → error" test "$(sx "$LLIB" fsx/xonly/none)" = error
t "svc_exists: intermediate symlink is not traversed → error" test "$(sx "$LLIB" fsx/linkdir/file)" = error
t "svc_exists: intermediate regular file → error" test "$(sx "$LLIB" fsx/afile/x)" = error
for bad in '../x' 'fsx/../fsx' 'fsx/./a' '/abs' 'fsx//a' 'fsx/a/' '-x' 'fsx/-a' 'fsx/a b' 'fsx/*' '' 'fsx/a/fi?e'; do
  t "svc_exists: malformed path '$bad' → error" test "$(sx "$LLIB" "$bad")" = error
done
t "svc_exists script itself refuses '..' (validation not only in the wrapper)" bash -c ". '$LLIB'; as_svc /usr/bin/bash -p -c \"\$SVC_EXISTS_SCRIPT\" _ \"\$SVC_HOME\" 'fsx/../fsx' >/dev/null 2>&1; [ \$? -eq 12 ]"
t "svc_exists script refuses a relative root" bash -c ". '$LLIB'; as_svc /usr/bin/bash -p -c \"\$SVC_EXISTS_SCRIPT\" _ relative fsx >/dev/null 2>&1; [ \$? -eq 12 ]"
check_access_error() { # check_access_error <launcher-lib>: inaccessible never reads as absent
  fs_setup
  [ "$(sx "$1" fsx/locked/obj)" = error ] && [ "$(sx "$1" fsx/xonly/none)" = error ]
}
t "svc_exists: access errors stay distinct from absence" check_access_error "$LLIB"
mutation "svc_exists maps a failed cd to absent" "$LLIB" 's/  cd -P -- "\$part" 2>\/dev\/null || exit 12/  cd -P -- "$part" 2>\/dev\/null || exit 11/' check_access_error
mutation "svc_exists maps a failed listing to absent" "$LLIB" 's/-maxdepth 1 -print 2>\/dev\/null) || exit 12/-maxdepth 1 -print 2>\/dev\/null) || exit 11/' check_access_error
mutation "svc_exists reverted to the [ -e ] || [ -L ] test" "$LLIB" 's/as_svc \/usr\/bin\/bash -p -c "\$SVC_EXISTS_SCRIPT" _ "\$SVC_HOME" "\$rel"/as_svc \/usr\/bin\/bash -p -c '"'"'if [ -e "$1\/$2" ] || [ -L "$1\/$2" ]; then exit 10; fi; exit 11'"'"' _ "$SVC_HOME" "$rel"/' check_access_error
fs_restore
rm -rf "$FX"

# Callers cannot succeed when their postcondition lookup is indeterminate
reset_state
mkdir -p "$SP/ch.proton.drive/drive-sdk-cli"
touch "$ST/lock_parent_after"
"$L" auth-logout >"$ST/out"
rc=$?
chmod -R u+rwx "$SP/ch.proton.drive"
t "auth-logout: entry parent inaccessible after the unit → error, exit 70" bash -c "[ $rc -eq 70 ] && grep -q -x 'E3J9 auth_entry_after_logout=error' '$ST/out'"
rm -rf "$SP/ch.proton.drive"
er_setup
touch "$ST/lock_parent_after"
"$L" entry-remove >"$ST/out"
rc=$?
chmod -R u+rwx "$SP/ch.proton.drive"
t "entry-remove: entry parent inaccessible after removal → error, exit 70" bash -c "[ $rc -eq 70 ] && grep -q -x 'E3J9 entry_after=error' '$ST/out'"
rm -rf "$SP/ch.proton.drive"
kd_setup
rm -f "$GD/openpgp-revocs.d/$FPR.rev"
chmod 100 "$GD/openpgp-revocs.d"
"$L" key-delete "$FPR" >"$ST/out"
rc=$?
chmod 700 "$GD/openpgp-revocs.d"
t "key-delete: revocation dir unreadable → lookup error, exit 70" bash -c "[ $rc -eq 70 ] && grep -q -x 'E3J9 revocation_file_after=error' '$ST/out' && ! grep -q key_delete_postconditions_ok '$ST/out'"
kd_setup
chmod 000 "$SP"
"$L" key-delete "$FPR" >"$ST/out"
rc=$?
chmod 700 "$SP"
t "key-delete: store unreadable → refused before deletion" bash -c "[ $rc -ne 0 ] && ! grep -q -- '--delete-secret-and-public-key' '$ST/run_calls'"
rm -rf "$GD/openpgp-revocs.d" "$SP/.gpg-id"

# pty-marker (tty check removed in this TEST copy only)
LT=$W/launcher-notty
sed 's/\[ -t 0 \] && \[ -t 1 \] || refuse no_terminal/:/' "$L" >"$LT"
chmod +x "$LT"
t "no-tty test copy differs only where intended" test "$(diff "$L" "$LT" | grep -c '^<')" -eq 2
reset_state
"$LT" pty-marker >"$ST/out"
t "pty-marker: unit ok and zero journal hits → exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 pty_marker_journal_hits=0' '$ST/out' && grep -q -x 'E3J9 pty_marker_result=pass' '$ST/out'"
check_pty_leak() {
  reset_state
  touch "$ST/leak_nonce"
  "$1" pty-marker >"$ST/out"
  [ "$?" -ne 0 ] && grep -q -x 'E3J9 pty_marker_journal_hits=1' "$ST/out"
}
t "pty-marker: nonce found in the journal → non-zero exit" check_pty_leak "$LT"
mutation "pty-marker ignores journal hits" "$LT" 's/if \[ "\$rc" -eq 0 \] \&\& \[ "\$hits" = 0 \]; then/if [ "$rc" -eq 0 ]; then/' check_pty_leak
reset_state
echo 1 >"$ST/json_rc"
"$LT" pty-marker >"$ST/out"
t "pty-marker: journal unreadable (hits invalid) → non-zero exit" bash -c "[ $? -ne 0 ] && grep -q -x 'E3J9 pty_marker_journal_hits=invalid' '$ST/out'"
reset_state
echo 1 >"$ST/run_rc"
"$LT" pty-marker >"$ST/out"
t "pty-marker: failing unit → non-zero exit" test "$?" -ne 0
reset_state
echo 1 >"$ST/run_rc"
t "auth-login (tty-free copy): failing unit → non-zero exit" bash -c "sed 's/\[ -t 0 \] && \[ -t 1 \] || refuse no_terminal/:/' '$LLIB' > '$W/llib-notty'; . '$W/llib-notty'; preflight_auth_login() { return 0; }; (cmd_auth_login) >/dev/null; [ \$? -ne 0 ]"

# env-proof aggregates three steps and the nonce search
ep_setup() { # ep_setup [skip-step]
  probe_setup env
  [ "${1-}" = boundary ] || jrec "$INV" eanhl-cloud-cred-envproof-boundary- 'E3J9 env_initial_exact=true'
  if [ "${1-}" != canary ]; then
    jrec "$INV" eanhl-cloud-cred-envproof-canary- 'E3J9 probe_mode=local'
    jrec "$INV" eanhl-cloud-cred-envproof-canary- 'E3J9 probe_result=pass'
  fi
  if [ "${1-}" != observe ]; then
    jrec "$INV" eanhl-cloud-cred-envproof-observe- 'E3J9 probe_mode=lockhold-hold'
    jrec "$INV" eanhl-cloud-cred-envproof-observe- 'E3J9 probe_result=pass'
  fi
}
ep_setup
"$L" env-proof >"$ST/out"
t "env-proof: three passing steps, zero hits → exit 0" bash -c "[ $? -eq 0 ] && [ \"\$(grep -c -x 'E3J9 envproof_step_result=pass' '$ST/out')\" -eq 3 ] && grep -q -x 'E3J9 envproof_result=pass' '$ST/out'"
for step in boundary canary observe; do
  ep_setup "$step"
  "$L" env-proof >"$ST/out"
  t "env-proof: failing $step step → exit 1" bash -c "[ $? -eq 1 ] && grep -q -x 'E3J9 envproof_result=fail' '$ST/out'"
done
check_ep_leak() {
  ep_setup
  touch "$ST/leak_nonce"
  "$1" env-proof >"$ST/out"
  [ "$?" -eq 1 ] && grep -q -x 'E3J9 envproof_nonce_journal_hits=1' "$ST/out"
}
t "env-proof: nonce found in the journal → exit 1" check_ep_leak "$L"
mutation "env-proof ignores the nonce search" "$L" 's/\[ "\$hits" = 0 \] || all=fail/:/' check_ep_leak
ep_setup
echo 1 >"$ST/json_rc"
"$L" env-proof >"$ST/out"
t "env-proof: nonce search unreadable → exit 1" bash -c "[ $? -eq 1 ] && grep -q -x 'E3J9 envproof_nonce_journal_hits=invalid' '$ST/out'"

# 6i. cleanup is part of every result
pass_records() { jrec "$INV" "eanhl-cloud-cred-probe-$1-" "E3J9 probe_mode=$1"; jrec "$INV" "eanhl-cloud-cred-probe-$1-" 'E3J9 probe_result=pass'; }
check_cleanup_stop_fail() {
  probe_setup local
  pass_records local
  echo 5 >"$ST/stop_rc"
  run_probe "$1" local
  [ "$(res):$(rc_of)" = fail:1 ] && grep -q -x 'E3J9 bound_cleanup_ok=false' "$ST/out"
}
t "cleanup: stop fails → probe fails despite a clean pass" check_cleanup_stop_fail "$L"
mutation "probe ignores the cleanup result" "$L" 's/bound_cleanup || outcome=fail/bound_cleanup || :/' check_cleanup_stop_fail
probe_setup local
pass_records local
echo 1 >"$ST/reset_rc"
run_probe "$L" local
t "cleanup: reset fails on a still-loaded unit → fail" bash -c "[ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ] && grep -q -x 'E3J9 bound_cleanup_ok=false' '$ST/out'"
probe_setup local
pass_records local
echo 1 >"$ST/reset_rc"
touch "$ST/gc_on_stop"
run_probe "$L" local
t "cleanup: reset fails but the unit is already unloaded → pass" test "$(res):$(rc_of)" = pass:0
probe_setup canary
jrec "$INV" eanhl-cloud-cred-probe-canary- 'E3J9 probe_mode=canary'
jrec "$INV" eanhl-cloud-cred-probe-canary- 'E3J9 probe_result=fail'
echo 1 >"$ST/status"
run_probe "$L" canary
t "cleanup: failed keep-mode probe is cleaned up, not kept" bash -c "! grep -q probe_unit_kept '$ST/out' && grep -q '^systemctl stop' '$ST/calls' && grep -q -x 'E3J9 bound_cleanup_ok=true' '$ST/out' && [ \"\$(cat '$ST/rc')\" = 1 ]"
probe_setup canary
pass_records canary
echo activating >"$ST/active"
echo start >"$ST/sub"
run_probe "$L" canary
t "cleanup: indeterminate keep-mode probe (timeout) is cleaned up" bash -c "! grep -q probe_unit_kept '$ST/out' && grep -q -x 'E3J9 bound_cleanup_ok=true' '$ST/out'"
probe_setup local
echo 1 >"$ST/run_rc"
echo 5 >"$ST/stop_rc"
run_probe "$L" local
t "cleanup: start failure reports cleanup failure, exit 70" bash -c "grep -q -x 'E3J9 bound_start_ok=false' '$ST/out' && grep -q -x 'E3J9 bound_cleanup_ok=false' '$ST/out' && [ \"\$(cat '$ST/rc')\" = 70 ]"
probe_setup local
: >"$ST/invid"
echo 5 >"$ST/stop_rc"
run_probe "$L" local
t "cleanup: unbound invocation reports cleanup failure" bash -c "grep -q -x 'E3J9 bound_invocation=false' '$ST/out' && grep -q -x 'E3J9 bound_cleanup_ok=false' '$ST/out'"
probe_setup local
echo activating >"$ST/active"
echo start >"$ST/sub"
echo 5 >"$ST/stop_rc"
run_probe "$L" local
t "cleanup: timeout reports cleanup failure, fail" bash -c "grep -q -x 'E3J9 bound_wait_timeout=true' '$ST/out' && grep -q -x 'E3J9 bound_cleanup_ok=false' '$ST/out' && [ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ]"
probe_setup local
echo "$OLD" >"$ST/invid_after"
pass_records local
run_probe "$L" local
t "cleanup: changed invocation still cleaned up and reported" grep -q -x 'E3J9 bound_cleanup_ok=true' "$ST/out"
probe_setup local
echo 1 >"$ST/journal_rc"
echo 5 >"$ST/stop_rc"
run_probe "$L" local
t "cleanup: journal failure reports cleanup failure" bash -c "grep -q -x 'E3J9 bound_journal_ok=false' '$ST/out' && grep -q -x 'E3J9 bound_cleanup_ok=false' '$ST/out'"
t "cleanup paths print only vocabulary" vocab_only "$(cat "$ST/out")"
check_probe_stop_fail() { # check_probe_stop_fail <launcher> <state-file> <value>
  reset_state
  echo loaded >"$ST/loadstate"
  stub_register_local eanhl-cloud-cred-probe-canary-00112233aabbccdd canary
  echo "$3" >"$ST/$2"
  "$1" probe-stop eanhl-cloud-cred-probe-canary-00112233aabbccdd >"$ST/out"
  [ "$?" -eq 1 ] && grep -q -x 'E3J9 probe_stopped=false' "$ST/out"
}
t "probe-stop: stop fails → exit 1" check_probe_stop_fail "$L" stop_rc 5
t "probe-stop: reset fails on a loaded unit → exit 1" check_probe_stop_fail "$L" reset_rc 1
mutation "probe-stop ignores cleanup failure" "$L" 's/if cleanup_unit "\$unit"; then/if cleanup_unit "$unit" || true; then/' check_probe_stop_fail stop_rc 5
reset_state
"$L" probe-stop eanhl-cloud-cred-probe-canary-00112233aabbccdd >"$ST/out"
t "probe-stop: unknown/unloaded unit → exit 1 (a typo never succeeds)" bash -c "[ $? -eq 1 ] && grep -q -x 'E3J9 probe_unit_found=false' '$ST/out'"

# ── 7. lockhold root helpers ───────────────────────────────────────────────
LH=$W/lockhold
LHS=$W/lh
mkdir -p "$LHS"
: >"$LHS/real"
sed -e "s#^readonly LOCK_FILE=.*#readonly LOCK_FILE=$LHS/credential.lock#" \
  -e "s#^readonly SETPRIV=.*#readonly SETPRIV=$SB/stub/setpriv#" "$LOCKHOLD_SRC" >"$LH"
LHF=$W/lockhold-funcs.sh
{
  sed -n '/^readonly LOCK_FILE=/p; /^readonly SETPRIV=/p; /^readonly FLOCK=/p' "$LH"
  extract "$LH" lock_free
} >"$LHF"
check_lock_free_symlink() { # check_lock_free_symlink <funcs>: symlink → 2, setpriv never called
  reset_state
  rm -f "$LHS/credential.lock"
  ln -s "$LHS/real" "$LHS/credential.lock"
  bash -c ". '$1'; lock_free"
  [ "$?" -eq 2 ] && [ ! -e "$ST/setpriv_calls" ]
}
t "lockhold free: refuses a symlinked lock, never opens it" check_lock_free_symlink "$LHF"
mutation "lockhold free without the symlink check" "$LHF" '/^lock_free() {/,/^}/{/\[ -L "\$LOCK_FILE" \] && return 2/d}' check_lock_free_symlink
reset_state
rm -f "$LHS/credential.lock"
: >"$LHS/credential.lock"
bash -c ". '$LHF'; lock_free"
t "lockhold free: regular lock acquired as eanhl-cloud via setpriv" bash -c "[ $? -eq 0 ] && grep -q -- '--reuid=eanhl-cloud' '$ST/setpriv_calls'"
t "lockhold held: matches device major:minor and inode" grep -q -F 'printf '"'"'%02x:%02x'"'"' "$major" "$minor"' "$LOCKHOLD_SRC"
t "lockhold hold: runs the nested canary and prints probe_result" bash -c "grep -q -F '\"\$PROBE\" local:canary-nested' '$LOCKHOLD_SRC' && [ \"\$(grep -c -F 'emit probe_result' '$LOCKHOLD_SRC')\" -eq 3 ]"

LHR=$W/lockhold-root
sed -e 's#\[ "$(/usr/bin/id -u)" = 0 \]#true#' "$LH" >"$LHR"
chmod +x "$LHR"
reset_state
rm -f "$LHS/credential.lock"
ln -s "$LHS/real" "$LHS/credential.lock"
"$LHR" free >"$ST/out"
t "lockhold free: symlinked lock → false and non-zero exit" bash -c "[ $? -ne 0 ] && grep -q -x 'E3J9 lock_free_nonblock=false' '$ST/out'"
rm -f "$LHS/credential.lock"
: >"$LHS/credential.lock"
"$LHR" free >"$ST/out"
t "lockhold free: free lock → true and exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 lock_free_nonblock=true' '$ST/out'"

# 7'. lock_free enters / before setpriv (same defect class as §6d'). The setpriv
# stub refuses any cwd other than /; the caller runs from a private directory.
check_lock_free_safe_cwd() { # check_lock_free_safe_cwd <funcs>
  reset_state
  rm -f "$LHS/credential.lock"
  : >"$LHS/credential.lock"
  touch "$ST/require_root_cwd"
  (cd "$PRIV" && bash -c ". '$1'; lock_free")
  [ "$?" -eq 0 ] && cwd_all_root
}
t "lockhold free from a private caller cwd: setpriv sees cwd /, acquire succeeds" check_lock_free_safe_cwd "$LHF"
mutation "lockhold lock_free without the safe-cwd step" "$LHF" '/^lock_free() {/,/^}/s#( cd / || exit 70; exec #( exec #' check_lock_free_safe_cwd
reset_state
rm -f "$LHS/credential.lock"
: >"$LHS/credential.lock"
touch "$ST/require_root_cwd"
# --close: only the flock parent holds the lock, so killing it releases the lock.
/usr/bin/flock --exclusive --close "$LHS/credential.lock" /usr/bin/sleep 4 &
BG_PIDS+=("$!")
holder=$!
for _ in $(seq 1 40); do
  /usr/bin/flock --nonblock "$LHS/credential.lock" /usr/bin/true || break
  sleep 0.1
done
(cd "$PRIV" && bash -c ". '$LHF'; lock_free")
rc=$?
kill "$holder" 2>/dev/null
wait "$holder" 2>/dev/null
t "lockhold free from a private cwd while held: exit 75 preserved, setpriv saw cwd /" bash -c "[ $rc -eq 75 ] && ! grep -v -x -F / '$ST/setpriv_cwd' | grep -q . && [ -s '$ST/setpriv_cwd' ]"
reset_state
touch "$ST/require_root_cwd"
(cd "$PRIV" && "$LHR" free) >"$ST/out"
t "lockhold free (root mode) from a private cwd → true, exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 lock_free_nonblock=true' '$ST/out'"
t "lockhold: the pre-open symlink/regular checks still precede setpriv" bash -c "sed -n '/^lock_free() {/,/^}/p' '$LOCKHOLD_SRC' | grep -n -E 'return 2|SETPRIV' | awk -F: 'NR<=2 && \$0 !~ /return 2/ {bad=1} END {exit bad}'"

# ── 8. owned-inventory expected sets ───────────────────────────────────────
OF=$W/oinv.sh
sed -n '/^readonly H=/p; /^readonly C=/p; /^expected_path() {/,/^}/p' "$OINV_SRC" | sed 's/^readonly //' >"$OF"
exp_ok() { (scan_mode=$1; . "$OF"; expected_path "$2"); }
for p in /var/lib/eanhl-cloud /var/lib/eanhl-cloud/gnupg/pubring.kbx /var/lib/eanhl-cloud/gnupg/private-keys-v1.d/X.key \
  /var/lib/eanhl-cloud/password-store/.gpg-id /var/lib/eanhl-cloud/locks/credential.lock /var/cache/eanhl-cloud/x/y \
  /var/lib/eanhl-cloud/.local/state/proton-drive-cli/proton-drive.log.1 /var/lib/eanhl-cloud/password-store/ch.proton.drive/drive-sdk-cli/auth-session.gpg; do
  t "expected (default): $p" exp_ok default "$p"
  t "unexpected (expect-none): $p" bash -c "! (scan_mode=none; . '$OF'; expected_path '$p')"
done
for p in /var/lib/eanhl-cloud/password-store/e3j9-canary /var/lib/eanhl-cloud/password-store/e3j9-canary/probe.gpg /var/lib/eanhl-cloud/locks/other \
  /tmp/x /home/utiz/f /run/user/104 /dev/shm/x /var/lib/eanhl-cloud/.bash_history /var/lib/eanhl-cloud/password-store/ch.proton.drive/drive-sdk-cli/auth-session.json \
  /var/lib/eanhl-cloud/.local/state/proton-drive-cli/sub/proton-drive.log /var/lib/eanhl-cloud-evil /var/lib/eanhl-cloud/.local/state/other; do
  t "unexpected (default): $p" bash -c "! (scan_mode=default; . '$OF'; expected_path '$p')"
done
t "owned-inventory scans /run, /dev/shm and /var/tmp" grep -q -F 'for root in / /var /var/tmp /opt /etc /usr/local /tmp /home /run /dev/shm; do' "$OINV_SRC"
# Preconditions, run end-to-end on a sandbox copy (stubbed pgrep/systemctl; the
# scan roots replaced by one sandbox directory; never a real filesystem scan).
OIS=$W/oi
mkdir -p "$OIS/var/lib/eanhl-cloud/"{gnupg,password-store,config,data,locks} "$OIS/var/cache/eanhl-cloud"
chmod 700 "$OIS/var/lib/eanhl-cloud" "$OIS/var/lib/eanhl-cloud/"{gnupg,password-store,config,data,locks} "$OIS/var/cache/eanhl-cloud"
: >"$OIS/var/lib/eanhl-cloud/locks/credential.lock"
chmod 600 "$OIS/var/lib/eanhl-cloud/locks/credential.lock"
OIR=$W/oinv-run
sed -e 's#\[ "$(/usr/bin/id -u)" = 0 \]#true#' \
  -e "s#/usr/bin/getent passwd eanhl-cloud#/usr/bin/getent passwd $ME#" \
  -e "s#/usr/bin/getent group eanhl-cloud#/usr/bin/getent group $MYGRP#" \
  -e "s#/usr/bin/pgrep#$SB/stub/pgrep#" \
  -e "s#/usr/bin/systemctl#$SB/stub/systemctl#" \
  -e 's#/usr/bin/findmnt -n -o TARGET -T "$root"#printf "%s\\n" "$root"#' \
  -e "s#^for root in / /var /var/tmp /opt /etc /usr/local /tmp /home /run /dev/shm; do#for root in $OIS; do#" \
  -e "s#^readonly H=.*#readonly H=$OIS/var/lib/eanhl-cloud#" \
  -e "s#^readonly C=.*#readonly C=$OIS/var/cache/eanhl-cloud#" \
  "$OINV_SRC" >"$OIR"
t "owned-inventory test copy: scan confined to the sandbox" bash -c "grep -q -F 'for root in $OIS; do' '$OIR' && ! grep -q findmnt '$OIR'"
oi_code() { grep -x -E 'E3J9 owned_scan_code=[0-9]+' "$ST/out" | sed 's/.*=//'; }
check_oi_refuses() { # check_oi_refuses <script> <mode|""> <state-file> <value>
  reset_state
  echo "$4" >"$ST/$3"
  if [ -n "$2" ]; then bash "$1" "$2" >"$ST/out"; else bash "$1" >"$ST/out"; fi
  [ "$?" -ne 0 ] && [ "$(oi_code)" = 4 ]
}
for m in '' expect-none; do
  t "owned-inventory ${m:-default}: a service-identity process → code 4" check_oi_refuses "$OIR" "$m" pgrep_rc 0
  t "owned-inventory ${m:-default}: pgrep error → code 4" check_oi_refuses "$OIR" "$m" pgrep_rc 3
  t "owned-inventory ${m:-default}: active credential unit → code 4" check_oi_refuses "$OIR" "$m" units 'eanhl-cloud-cred-x.service loaded active running'
  t "owned-inventory ${m:-default}: unit query error → code 4" check_oi_refuses "$OIR" "$m" units_rc 1
done
mutation "owned-inventory without the process precondition" "$OIR" '/^\[ "\$?" -eq 1 \] || report 0 4$/d' check_oi_refuses '' pgrep_rc 0
reset_state
bash "$OIR" >"$ST/out"
t "owned-inventory default: preconditions met → scan runs (code 0)" test "$(oi_code)" = 0
reset_state
bash "$OIR" expect-none >"$ST/out"
t "owned-inventory expect-none: preconditions met → scan runs, owned objects are unexpected" bash -c "[ \"\$(sed -n 's/^E3J9 owned_scan_code=//p' '$ST/out')\" = 0 ] && grep -q -x 'E3J9 owned_expected_set_match=false' '$ST/out'"
bash "$OIR" bogus >"$ST/out"
t "owned-inventory: unknown argument → scan code 64" test "$(oi_code)" = 64

# ── 9. runbook setpriv commands enter / first (E3J9C §19.5) ─────────────────
README_SRC=$C/README.md
MEMO_SRC=$(cd "$C/../../.." && pwd)/docs/planning/proton-drive-hotel-echo-credential-design.md
SAFE_SETPRIV='( cd / && sudo /usr/bin/setpriv --reuid=eanhl-cloud --regid=eanhl-cloud --clear-groups --'
t "README: exactly 3 operator setpriv commands (M8 gpg.conf, A2, rollback find)" test "$(grep -c -F 'setpriv --reuid' "$README_SRC")" -eq 3
t "README: every setpriv command starts '( cd / && sudo /usr/bin/setpriv …'" bash -c "! grep -F 'setpriv --reuid' '$README_SRC' | grep -v -q -F -- '$SAFE_SETPRIV'"
t "design memo: any setpriv command uses the same safe form" bash -c "! grep -F 'setpriv --reuid' '$MEMO_SRC' | grep -v -q -F -- '$SAFE_SETPRIV'"
t "README A2: test -w runs inside the safe-cwd group" grep -q -F -- "$SAFE_SETPRIV /usr/bin/test -w <path> )" "$README_SRC"
t "README rollback: find -delete runs inside the safe-cwd group, paths unchanged" grep -q -F -- "$SAFE_SETPRIV /usr/bin/find <literal top> -xdev -depth -type <reviewed types> -delete )" "$README_SRC"
# M8: run the README's exact two-line command in a sandbox. `< gpg.conf` must be
# opened in the caller's (checkout) directory, outside the group, before cd /.
M8=$W/m8
mkdir -p "$M8/checkout" "$M8/gnupg"
chmod 700 "$M8/checkout"
printf 'batch\nno-tty\npinentry-mode error\n# m8-sandbox-marker\n' >"$M8/checkout/gpg.conf"
m8_cmd=$(awk '/^ *\( cd \/ && sudo \/usr\/bin\/setpriv/ && !done {grab=1} grab {print; if (/< gpg\.conf *$/) {grab=0; done=1}}' "$README_SRC" |
  sed -e 's#^ *##' -e "s#sudo /usr/bin/setpriv#$SB/stub/setpriv#" -e "s#/var/lib/eanhl-cloud/gnupg/gpg.conf#$M8/gnupg/gpg.conf#")
reset_state
touch "$ST/require_root_cwd"
(cd "$M8/checkout" && bash -c "$m8_cmd")
rc=$?
t "README M8 command: reads the checkout gpg.conf (not /gpg.conf), setpriv cwd /, file written" bash -c "[ $rc -eq 0 ] && cmp -s '$M8/checkout/gpg.conf' '$M8/gnupg/gpg.conf' && ! grep -v -x -F / '$ST/setpriv_cwd' | grep -q . && [ -s '$ST/setpriv_cwd' ]"
t "README M8 command: target mode 0600 (umask 077 kept)" test "$(stat -c %a "$M8/gnupg/gpg.conf" 2>/dev/null)" = 600
(cd "$M8/checkout" && bash -c "$m8_cmd") 2>/dev/null
t "README M8 command: set -C still refuses an existing gpg.conf" test "$?" -ne 0


# ── 10. provider-probe (E3J9D-R) — stubs only: never real systemd, journal, CLI or network ──
# 10a. The bound runner's new proofs on LOCAL runs. On Hotel-Echo these run in
# the same-session pre-ceremony proofs, before any provider contact.
check_single_invocation() { # the json id view alone rejects a second invocation id of the same fresh name
  probe_setup local
  pass_records local
  printf '%s\t%s\t%s\n' "$INV" eanhl-cloud-cred-probe-local- x "$OLD" eanhl-cloud-cred-probe-local- x >"$ST/idjson.tsv"
  run_probe "$1" local
  [ "$(res):$(rc_of)" = fail:1 ] && grep -q -x 'E3J9 bound_single_invocation=false' "$ST/out"
}
t "local run: a second invocation id under the same name → bound_single_invocation=false, fail" check_single_invocation "$L"
mutation "single-invocation proof disabled" "$L" 's/if \[ "\$J_FOREIGN" -ne 0 \]; then/if false; then/' check_single_invocation
check_boot_record() { # a record from another boot → bound_boot_id_match=false
  probe_setup local
  pass_records local
  echo ffffffffffffffffffffffffffffffff >"$ST/json_boot"
  run_probe "$1" local
  [ "$(res):$(rc_of)" = fail:1 ] && grep -q -x 'E3J9 bound_boot_id_match=false' "$ST/out"
}
t "local run: a record whose _BOOT_ID is not the current boot → fail" check_boot_record "$L"
mutation "_BOOT_ID check disabled" "$L" 's/if \[ "\$J_BOOT_BAD" -ne 0 \]; then/if false; then/' check_boot_record
check_history() { # journal history under the candidate name → never started
  probe_setup local
  printf '%s\t%s\t%s\n' "$OLD" eanhl-cloud-cred-probe-local- x >"$ST/history.tsv"
  run_probe "$1" local
  grep -q -x 'E3J9 bound_unit_history_count=1' "$ST/out" && grep -q -x 'E3J9 bound_unit_collision=true' "$ST/out" &&
    [ ! -e "$ST/run_calls" ] && [ "$(rc_of)" = 70 ]
}
t "local run: journal history under the candidate name → collision, never started" check_history "$L"
mutation "never-reused history check disabled" "$L" 's/^  if \[ "\$hist" != 0 \]; then$/  if false; then/' check_history
probe_setup local
echo 1 >"$ST/idjson_rc"
run_probe "$L" local
t "local run: history query fails → refused, never started" bash -c "grep -q -x 'E3J9 bound_unit_history_count=invalid' '$ST/out' && [ ! -e '$ST/run_calls' ] && [ \"\$(cat '$ST/rc')\" = 70 ]"
probe_setup local
pass_records local
touch "$ST/idjson_fail_started"
run_probe "$L" local
t "local run: the json proof fails after the start → fail, cleaned up" bash -c "grep -q -x 'E3J9 bound_single_invocation=false' '$ST/out' && grep -q -x 'E3J9 bound_cleanup_ok=true' '$ST/out' && [ \"\$(sed -n 's/^E3J9 probe_run_result=//p' '$ST/out')\" = fail ]"
probe_setup local
pass_records local
touch "$ST/json_noinv"
run_probe "$L" local
t "local run: a json record without an invocation id → fail" test "$(res):$(rc_of)" = fail:1
check_local_attest() { # a unit whose properties are not the launcher's → attest false, fail
  probe_setup local
  pass_records local
  echo root >"$ST/lprop.User"
  run_probe "$1" local
  [ "$(res):$(rc_of)" = fail:1 ] && grep -q -x 'E3J9 bound_attest_ok=false' "$ST/out"
}
t "local attestation: User not the service identity → fail" check_local_attest "$L"
probe_setup local
pass_records local
printf '%s\n' '{ path=/bin/sh ; argv[]=/bin/sh -c x ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }' >"$ST/lprop.ExecStart"
run_probe "$L" local
t "local attestation: a foreign ExecStart → fail" bash -c "grep -q -x 'E3J9 bound_attest_ok=false' '$ST/out' && [ \"\$(cat '$ST/rc')\" = 1 ]"
probe_setup local
pass_records local
echo yes >"$ST/lprop.PrivateNetwork"
run_probe "$L" local
t "local attestation: the unit it attests is its own (PrivateNetwork=yes, local argv) → pass" test "$(res):$(rc_of)" = pass:0
check_rand() { # a non-hex or short urandom read → rand_failed, nothing started
  probe_setup local
  printf ' AB CD EF 01 23 45 67 89\n' >"$ST/od_out"
  run_probe "$1" local
  grep -q -x 'E3J9 launcher_failed=rand_failed' "$ST/out" && [ ! -e "$ST/run_calls" ]
}
t "nonce: an uppercase urandom read → rand_failed, nothing started" check_rand "$L"
mutation "rand_hex validation removed" "$L" 's/^  \[\[ \$h =~ .*|| return 1$/  :/' check_rand
probe_setup local
printf ' 00 11 22\n' >"$ST/od_out"
run_probe "$L" local
t "nonce: a short urandom read → rand_failed" grep -q -x 'E3J9 launcher_failed=rand_failed' "$ST/out"
probe_setup local
mv "$SB/boot_id" "$SB/boot_id.off"
run_probe "$L" local
mv "$SB/boot_id.off" "$SB/boot_id"
t "local run: boot id unreadable → refused before any start" bash -c "grep -q -x 'E3J9 bound_boot_id_ok=false' '$ST/out' && [ ! -e '$ST/run_calls' ]"
# read_boot_id: one representation (32 lowercase hex), strict input.
check_bid_canonical() { printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"; [ "$(bash -c ". '$1'; read_boot_id")" = "$BOOT_HEX" ]; }
check_bid_rejects() { # every malformed boot_id content is refused
  local c rc=0
  for c in '0123ABCD-4567-89AB-CDEF-0123456789AB\n' '0123abcd456789abcdef0123456789ab\n' \
    '0123abcd-4567-89ab-cdef-0123456789ab \n' ' 0123abcd-4567-89ab-cdef-0123456789ab\n' \
    '0123abcd-4567-89ab-cdef-0123456789ab\n0123abcd-4567-89ab-cdef-0123456789ab\n' '' \
    '0123abcd-4567-89ab-cdef-0123456789ab' '0123abcd-4567-89ab-cdef-0123456789ab\n\n' \
    '0123abcd-4567-89ab-cdef-01234567\x0089ab\n' '0123abcd-4567-89ab-cdef-0123456789a\n'; do
    printf '%b' "$c" >"$SB/boot_id"
    if bash -c ". '$1'; read_boot_id" >/dev/null 2>&1; then rc=1; fi
  done
  rm -f "$SB/boot_id"
  if bash -c ". '$1'; read_boot_id" >/dev/null 2>&1; then rc=1; fi
  printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
  return "$rc"
}
t "boot id: the canonical UUID + LF normalises to 32 lowercase hex" check_bid_canonical "$LLIB"
t "boot id: uppercase, no hyphens, whitespace, two lines, empty, no LF, extra LF, NUL, short, unreadable → refused" check_bid_rejects "$LLIB"
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
mutation "boot id compared hyphenated (normalisation removed)" "$LLIB" 's/^  id=\${id\/\/-\/}$/  :/' check_bid_canonical
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
mutation "boot id regex validation removed" "$LLIB" 's/^  \[\[ \$content =~ \$BOOT_ID_RE \]\] || return 1$/  :/' check_bid_rejects
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
# probe-stop provenance: never stop a unit only because its name matches.
check_probe_stop_provenance() {
  reset_state
  echo loaded >"$ST/loadstate"
  stub_register_local eanhl-cloud-cred-probe-canary-00112233aabbccdd canary
  echo root >"$ST/lprop.User"
  "$1" probe-stop eanhl-cloud-cred-probe-canary-00112233aabbccdd >"$ST/out"
  [ "$?" -eq 1 ] && grep -q -x 'E3J9 probe_provenance=unproven' "$ST/out" && ! grep -q '^systemctl stop' "$ST/calls"
}
t "probe-stop: a unit whose User is not the service identity → refused, not stopped" check_probe_stop_provenance "$L"
mutation "probe-stop skips attestation" "$L" 's/ && attest_local_keep "\$unit" "\$m"; then/; then/' check_probe_stop_provenance
reset_state
echo loaded >"$ST/loadstate"
stub_register_local eanhl-cloud-cred-probe-canary-00112233aabbccdd local
"$L" probe-stop eanhl-cloud-cred-probe-canary-00112233aabbccdd >"$ST/out"
t "probe-stop: a canary-named unit running another argv → refused, not stopped" bash -c "[ $? -eq 1 ] && grep -q -x 'E3J9 probe_provenance=unproven' '$ST/out' && ! grep -q '^systemctl stop' '$ST/calls'"

# 10b. The record projection tables are tied to the probe's case arms.
fn_names() { # fn_names <probe function>: the names it emits (complete tokens)
  emit_call_tokens <(extract "$PROBE_SRC" "$1") | tr -d '"' | grep -x -E '[a-z_]+'
}
env_names() { # the env-inspect names the probe's check_environment reaches ("" boundary + helper_ descendant)
  emit_call_tokens <(extract "$INSPECT_SRC" print_boundary) | sed -E 's/^"\$\{p\}//; s/"$//'
  emit_call_tokens <(extract "$INSPECT_SRC" print_descendant) | sed -E 's/^"\$\{p\}/helper_/; s/"$//'
}
probe_arm_names() { # probe_arm_names <probe mode>: every name the provider arm can emit
  local arm fn
  arm=$(sed -n "/^  $1)\$/,/^    ;;\$/p" "$PROBE_SRC")
  [ -n "$arm" ] || return 1
  {
    echo probe_mode
    echo probe_tmp_ok
    fn_names check_pinentry_and_cmds
    fn_names finish | grep -v '^canary_'
    emit_call_tokens <(printf '%s\n' "$arm") | tr -d '"'
    for fn in check_environment check_identity check_metadata run_provider check_decoy_parent; do
      grep -q -E "^[[:space:]]*$fn( |\$)" <<<"$arm" || continue
      if [ "$fn" = check_environment ]; then env_names; else fn_names "$fn"; fi
    done
  } | sort -u
}
rules_names() { # rules_names <launcher file> <probe mode>: the names of its PROVIDER_MODE_NAMES groups
  local f=$1 groups g
  groups=$(sed -n '/^readonly PROVIDER_MODE_NAMES=(/,/^)/p' "$f" | grep -o -E "'$2\|[A-Z0-9 ]+'" | sed -E "s/^'$2\|//; s/'\$//")
  [ -n "$groups" ] || return 1
  for g in $groups; do
    awk -v s="readonly PP_RULES_$g=(" 'index($0, s) == 1 {f = 1} f {print} f && /\)$/ {exit}' "$f" |
      grep -o -E "'[a-z_]+ [a-z]+(=[^']*)?'" | sed -E "s/^'//; s/ .*//"
  done | sort -u
}
check_mode_names_tied() { # check_mode_names_tied <launcher file>: per mode, rules names == probe arm names
  local m
  for m in provider provider-freshcache neg-nokey neg-nostore e4-decoy; do
    [ "$(rules_names "$1" "$m")" = "$(probe_arm_names "$m")" ] || { echo "     mismatch: $m"; return 1; }
  done
}
t "PROVIDER_MODE_NAMES: every mode's rule names == the names its probe arm emits" check_mode_names_tied "$LAUNCHER_SRC"
mutation "a mode's required-name set loses one name" "$LAUNCHER_SRC" "s/ 'gpg_agent_count_at_start req=0'//" check_mode_names_tied
check_record_names_tied() { # PROVIDER_RECORD_NAMES == the union of the provider arms' names; every class exists
  local union table classes c m
  union=$(for m in provider provider-freshcache neg-nokey neg-nostore e4-decoy; do probe_arm_names "$m"; done | sort -u)
  table=$(sed -n '/^readonly PROVIDER_RECORD_NAMES=(/,/^)/p' "$LAUNCHER_SRC" | grep -o -E '[a-z_]+:[a-z_]+' | sed 's/:.*//' | sort -u)
  [ -n "$union" ] && [ "$union" = "$table" ] || return 1
  classes=$(sed -n '/^readonly PROVIDER_RECORD_NAMES=(/,/^)/p' "$LAUNCHER_SRC" | grep -o -E '[a-z_]+:[a-z_]+' | sed 's/.*://' | sort -u)
  for c in $classes; do grep -q -E "^  \[$c\]='" "$LAUNCHER_SRC" || return 1; done
}
t "PROVIDER_RECORD_NAMES == the union of the provider arms' names; every class exists" check_record_names_tied

# 10c. Provider fixtures: a post-login store and a clean pass record set per mode.
PSP=$SB/home/password-store
pp_setup() {
  reset_state
  chmod -R u+rwx "$PSP" 2>/dev/null
  rm -rf "$PSP/ch.proton.drive" "$PSP/.gpg-id" "$PSP/extra.gpg" "$PSP/stray" "$SB/home/auth-session.json"
  printf '%s\n' "$FPR" >"$PSP/.gpg-id"
  chmod 600 "$PSP/.gpg-id"
  mkdir -p "$PSP/ch.proton.drive/drive-sdk-cli"
  printf 'entry-bytes\n' >"$PSP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
  chmod 600 "$PSP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"
  rm -f "$SB/home/locks/credential.lock"
  : >"$SB/home/locks/credential.lock"
  printf 'cli-bytes\n' >"$SB/cli"
  printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
  rm -f "$UD"/eanhl-cloud-cred-pprobe-* "$UD"/.eanhl-cloud-cred-pprobe-* "$WD"/eanhl-cloud-cred-pprobe-*
  echo "$INV" >"$ST/invid"
}
pp_pass_lines() { # pp_pass_lines <probe mode>: a complete clean record set, in the probe arm's order
  local m=$1
  meta() { printf 'E3J9 %s\n' entry_present=true entry_mode=600 entry_size=12 entry_mtime=1790000000 fallback_file_count=0 log_count=0 cli_present=true cli_pin_match=true; }
  printf 'E3J9 probe_mode=%s\n' "$m"
  printf 'E3J9 %s\n' env_initial_exact=true env_unexpected_count=0 env_forbidden_absent=true env_nonce_absent=true env_systemd_absent=true \
    helper_env_descendant_within_permitted=true helper_env_pwd_is_workdir=true helper_env_unexpected_count=0 \
    helper_env_wrong_value_count=0 helper_env_forbidden_absent=true helper_env_nonce_absent=true helper_env_systemd_absent=true
  case "$m" in provider | provider-freshcache | e4-decoy)
    printf 'E3J9 %s\n' identity_is_svc=true groups_only_primary=true stdin_is_tty=false run_user_absent=true "human_sessions=${HS:-0}" gpg_agent_count_at_start=0 ;;
  esac
  [ "$m" != e4-decoy ] || printf 'E3J9 %s\n' decoy_parent_is_flock=true decoy_parent_env_readable=true decoy_parent_decoy_count=4 decoy_parent_values_exact=true decoy_marker_dirs_created=true
  case "$m" in provider | e4-decoy) meta ;; esac
  case "$m" in
    neg-nokey) printf 'E3J9 %s\n' provider_rc=1 provider_result=pass_load_failed ;;
    neg-nostore) printf 'E3J9 %s\n' provider_rc=1 provider_result=login_required ;;
    *) printf 'E3J9 %s\n' provider_rc=0 provider_result=ok ;;
  esac
  [ "$m" != provider-freshcache ] || printf 'E3J9 freshcache_entry_count=2\n'
  [ "$m" != e4-decoy ] || printf 'E3J9 %s\n' decoy_pdcache_entry_count=0 decoy_xdgcache_entry_count=0
  case "$m" in provider | neg-nokey | neg-nostore | e4-decoy) meta ;; esac
  printf 'E3J9 %s\n' pinentry_count=0 pass_cmd_not_found=false probe_failures=0 probe_result=pass
}
pp_records() { # pp_records <unit prefix> <probe mode> [sed script]: jrec a (modified) pass set
  local l
  while IFS= read -r l; do jrec "$INV" "$1" "$l"; done < <(pp_pass_lines "$2" | sed -e "${3:-}")
}
pp_run() { "$1" provider-probe run "$2" >"$ST/out" 2>"$ST/err"; echo $? >"$ST/rc"; }
pres() { sed -n 's/^E3J9 provider_run_result=//p' "$ST/out"; }
now_prefix() { printf 'eanhl-cloud-cred-pprobe-now-%s-' "$1"; }
pmode_of() { case "$1" in n3-busy) echo provider ;; *) echo "$1" ;; esac; }

# 10d. run: each mode.
check_run_argv() { # check_run_argv <mode> <probe argument>: exactly one provider start with the fixed properties
  local line
  [ "$(grep -c -- '--unit=eanhl-cloud-cred-pprobe-' "$ST/run_calls")" -eq 1 ] || return 1
  line=$(grep -- '--unit=eanhl-cloud-cred-pprobe-' "$ST/run_calls")
  [[ $line == *" --nonblock probe $2" ]] || return 1
  for p in After=network-online.target Wants=network-online.target PrivateNetwork=no Restart=no RemainAfterExit=yes \
    StandardInput=null StandardOutput=journal StandardError=journal "User=$ME" TimeoutStartSec=300; do
    [[ $line == *" --property=$p "* ]] || return 1
  done
  [[ $line != *PrivateNetwork=yes* ]] && [[ $line != *--collect* ]] || return 1
  if [ "$1" = e4-decoy ]; then [ "$(grep -o -- '--setenv=' <<<"$line" | wc -l)" -eq 4 ]; else [[ $line != *--setenv* ]]; fi
}
for m in provider provider-freshcache neg-nokey neg-nostore e4-decoy; do
  pp_setup
  pp_records "$(now_prefix "$m")" "$m"
  pp_run "$L" "$m"
  t "run $m: pass, exit 0" test "$(pres):$(rc_of)" = pass:0
  t "run $m: one provider start: table argument, network ordering, PrivateNetwork=no, Restart=no, no --collect, --setenv only for e4-decoy" check_run_argv "$m" "provider:$m"
  t "run $m: cleaned up, postconditions true, output vocabulary-only, stderr empty" bash -c "
    grep -q '^systemctl stop -- eanhl-cloud-cred-pprobe-now-$m-' '$ST/calls' && grep -q -x 'E3J9 bound_cleanup_ok=true' '$ST/out' &&
    grep -q -x 'E3J9 pp_post_entry_meta_ok=true' '$ST/out' && grep -q -x 'E3J9 pp_post_no_active_unit=true' '$ST/out' &&
    ! grep -v -q -E '^E3J9 [a-z_]+=[a-z0-9_.:-]+\$' '$ST/out' && [ ! -s '$ST/err' ]"
done
t "run e4-decoy: the parent unit carried exactly this run's decoys; zero journal hits for its marker" bash -c "
  grep -q -x 'E3J9 pp_decoy_env_attested=true' '$ST/out' && grep -q -x 'E3J9 pp_decoy_nonce_journal_hits=0' '$ST/out' &&
  ! grep -q -F \"\$(cat '$ST/nonce')\" '$ST/out' '$ST/err' && ! grep -q -E '127\\.0\\.0\\.1|e3j9-e4-' '$ST/out'"
check_e4_positive() { pp_setup; pp_records "$(now_prefix e4-decoy)" e4-decoy; pp_run "$1" e4-decoy; [ "$(pres):$(rc_of)" = pass:0 ]; }
mutation "e4-decoy without the --setenv decoys" "$L" 's/^    decoys=("\${E4_DECOYS\[@\]}")$/    decoys=()/' check_e4_positive
check_e4_env_exact() { # a pattern-valid decoy set whose marker is not this run's → fail
  pp_setup
  pp_records "$(now_prefix e4-decoy)" e4-decoy
  printf '%s\n' "PROTON_DRIVE_CACHE_DIR=/tmp/e3j9-e4-pdcache XDG_CACHE_HOME=/tmp/e3j9-e4-xdgcache PROTON_DRIVE_BASE_URL=http://127.0.0.1:9 E3J9_INJECTED=e3j9nonce00000000000000000000000000000000" >"$ST/prop.service.Environment"
  pp_run "$1" e4-decoy
  [ "$(pres):$(rc_of)" = fail:1 ] && grep -q -x 'E3J9 pp_decoy_env_attested=false' "$ST/out"
}
t "run e4-decoy: the unit's marker is not this run's → pp_decoy_env_attested=false, fail" check_e4_env_exact "$L"
mutation "drop the E4 Environment attestation" "$L" 's/^      e4_ok=0$/      :/' check_e4_env_exact
pp_setup
pp_records "$(now_prefix e4-decoy)" e4-decoy
printf '%s\n' 'PROTON_DRIVE_CACHE_DIR=/tmp/e3j9-e4-pdcache XDG_CACHE_HOME=/tmp/e3j9-e4-xdgcache PROTON_DRIVE_BASE_URL=http://127.0.0.1:9' >"$ST/prop.service.Environment"
pp_run "$L" e4-decoy
t "run e4-decoy: a decoy missing from the unit → attestation false, fail" test "$(pres):$(rc_of)" = fail:1
check_e4_nonce_hits() {
  pp_setup
  pp_records "$(now_prefix e4-decoy)" e4-decoy
  touch "$ST/leak_nonce"
  pp_run "$1" e4-decoy
  [ "$(pres):$(rc_of)" = fail:1 ] && grep -q -x 'E3J9 pp_decoy_nonce_journal_hits=1' "$ST/out"
}
t "run e4-decoy: the marker found in the journal → fail" check_e4_nonce_hits "$L"
mutation "drop the E4 nonce journal-hit check" "$L" 's/^    \[ "\$hits" = 0 \] || bad=1$/    :/' check_e4_nonce_hits
# n3-busy: during a lockhold-long hold (K4-style), the provider unit is refused by the lock.
LH_UNIT=eanhl-cloud-cred-probe-lockhold-long-0011223344556677
n3_setup() { # n3_setup [keep-lock-free]: the attested lockhold-long unit, and the lock held unless asked
  pp_setup
  stub_register_local "$LH_UNIT" lockhold-long
  echo "$LH_UNIT.service loaded activating start" >"$ST/units"
  if [ -z "${1-}" ]; then
    /usr/bin/flock --exclusive "$SB/home/locks/credential.lock" /usr/bin/sleep 30 &
    N3_HOLDER=$!
    BG_PIDS+=("$N3_HOLDER")
    for _ in $(seq 1 30); do /usr/bin/flock --nonblock "$SB/home/locks/credential.lock" /usr/bin/true || break; sleep 0.1; done
  fi
}
n3_done() { [ -z "${N3_HOLDER-}" ] || { kill "$N3_HOLDER" 2>/dev/null; wait "$N3_HOLDER" 2>/dev/null; }; N3_HOLDER=''; }
n3_setup
echo 75 >"$ST/status"
echo failed >"$ST/active"
pp_run "$L" n3-busy
n3_done
t "run n3-busy: lock held by the attested lockhold unit → busy, exit 0" bash -c "[ \"\$(sed -n 's/^E3J9 provider_run_result=//p' '$ST/out'):\$(cat '$ST/rc')\" = busy:0 ] && grep -q -x 'E3J9 pp_pre_lock_held=true' '$ST/out' && grep -q -x 'E3J9 pp_pre_lockhold_unit_ok=true' '$ST/out'"
check_n3_rejects_pass() { # n3-busy accepts only busy
  n3_setup
  pp_records "$(now_prefix n3-busy)" provider
  pp_run "$1" n3-busy
  n3_done
  [ "$(pres):$(rc_of)" = pass:1 ]
}
t "run n3-busy: a pass outcome is not accepted (exit 1)" check_n3_rejects_pass "$L"
mutation "n3-busy accepts pass" "$L" "s/^  'n3-busy|provider:provider|busy|run|ok'\$/  'n3-busy|provider:provider|pass,busy|run|ok'/" check_n3_rejects_pass
pp_setup
pp_run "$L" n3-busy
t "run n3-busy: no lockhold-long unit → refused 65, never started" bash -c "[ \"\$(cat '$ST/rc')\" = 65 ] && grep -q -x 'E3J9 pp_pre_lockhold_unit_ok=false' '$ST/out' && ! grep -q -- '--unit=eanhl-cloud-cred-pprobe-' '$ST/run_calls' 2>/dev/null"
n3_setup free
pp_run "$L" n3-busy
t "run n3-busy: the lock is not held → refused 65" bash -c "[ \"\$(cat '$ST/rc')\" = 65 ] && grep -q -x 'E3J9 pp_pre_lock_held=false' '$ST/out'"
check_provider_rejects_busy() {
  pp_setup
  echo 75 >"$ST/status"
  echo failed >"$ST/active"
  pp_run "$1" provider
  [ "$(pres):$(rc_of)" = busy:1 ]
}
t "run provider: busy is not an accepted outcome" check_provider_rejects_busy "$L"
mutation "provider accepts busy" "$L" "s/^  'provider|provider:provider|pass|run,schedule|ok'\$/  'provider|provider:provider|pass,busy|run,schedule|ok'/" check_provider_rejects_busy

# 10e. Arguments: closed tables, whole-argument matches, refused before any system call.
arg_case() { # arg_case <argument...>: refused as usage, exit 64, before any system call
  reset_state
  "$L" provider-probe "$@" >"$ST/out" 2>/dev/null
  local rc=$?
  t "provider-probe $(printf '%q ' "$@")→ usage, exit 64, no system call" bash -c "
    [ $rc -eq 64 ] && grep -q -x 'E3J9 launcher_refused=usage' '$ST/out' && [ ! -e '$ST/calls' ] && [ ! -e '$ST/run_calls' ]"
}
arg_case run
arg_case run ''
arg_case run PROVIDER
arg_case run 'provider '
arg_case run $'provider\n'
arg_case run 'provider;id'
arg_case run --unit=x
arg_case run -- provider
arg_case run canary
arg_case run local
arg_case run provider:provider
arg_case run e4
arg_case run e4-decoy=1
arg_case schedule 20min
arg_case schedule now
arg_case schedule provider
arg_case collect now
arg_case collect 't20m extra'
arg_case discard sshd
arg_case discard ''
arg_case start provider
arg_case ''
reset_state
"$L" provider-probe >"$ST/out"
t "provider-probe with no verb → usage" grep -q -x 'E3J9 launcher_refused=usage' "$ST/out"
"$L" provider-probe schedule t20m provider >"$ST/out"
t "provider-probe schedule t20m provider (extra argument) → usage" grep -q -x 'E3J9 launcher_refused=usage' "$ST/out"
for m in provider provider-freshcache neg-nokey neg-nostore n3-busy e4-decoy; do
  reset_state
  "$L" probe "$m" >"$ST/out"
  t "local probe op refuses provider mode $m" bash -c "grep -q -x 'E3J9 launcher_refused=usage' '$ST/out' && [ ! -e '$ST/run_calls' ]"
done

# 10f. Records: the name/value projection and the independent classifier.
pp_variant() { # pp_variant <launcher> <mode> <sed script>: run with a modified pass set
  pp_setup
  pp_records "$(now_prefix "$2")" "$(pmode_of "$2")" "$3"
  pp_run "$1" "$2"
}
pp_fails() { [ "$(pres):$(rc_of)" = fail:1 ]; }
pp_setup
pp_run "$L" provider
t "records: none → fail" pp_fails
for v in '/probe_mode=/d' '1a E3J9 probe_mode=provider' '1{h;d};$G' 's/^E3J9 probe_mode=provider$/E3J9 probe_mode=neg-nokey/' \
  '/probe_result=/d' '$a E3J9 probe_result=pass' '$a E3J9 probe_result=fail' '$a E3J9 provider_result=ok' \
  's/provider_result=ok/provider_result=login_required/' 's/entry_mode=600/entry_mode=644/' \
  's/gpg_agent_count_at_start=0/gpg_agent_count_at_start=1/' 's/pinentry_count=0/pinentry_count=invalid/' \
  's/^E3J9 env_nonce_absent=true/E3J9 env_nonce_absent=false/' 's/probe_failures=0/probe_failures=1/' '/provider_rc=/d'; do
  pp_variant "$L" provider "$v"
  t "records (provider, sed '$v') → fail" pp_fails
done
pp_variant "$L" neg-nostore 's/provider_rc=1/provider_rc=0/'
t "records: provider_rc=0 together with login_required → fail" pp_fails
pp_variant "$L" provider-freshcache '$a E3J9 entry_mode=600'
t "records: a name the mode's arm never emits (entry_mode in provider-freshcache) → disallowed, fail" bash -c "[ \"\$(sed -n 's/^E3J9 provider_run_result=//p' '$ST/out')\" = fail ] && grep -q -x 'E3J9 bound_disallowed_lines=1' '$ST/out'"
check_first_line() { pp_variant "$1" provider '1{h;d};$G'; pp_fails; }
mutation "classifier without the first-line rule" "$L" '/^classify_provider() {/,/^}/{/\[ "\${B_RECORDS\[0\]}" = "E3J9 probe_mode=\$pmode" \]/d}' check_first_line
check_exactly_once() { pp_variant "$1" provider '$a E3J9 probe_result=pass'; pp_fails; }
mutation "classifier without the exactly-once rule" "$L" 's/^      once) \[ "\$n" -eq 1 \]/      once) [ "$n" -ge 1 ]/' check_exactly_once
check_mode_label() { pp_variant "$1" neg-nokey 's/provider_rc=1/provider_rc=0/; s/provider_result=pass_load_failed/provider_result=ok/'; pp_fails; }
t "records: neg-nokey answering ok → fail (the mode's expected label)" check_mode_label "$L"
mutation "classifier without the mode label rule" "$L" 's/pp_rules_hold "\$pmode" "\$label"/pp_rules_hold "$pmode" ok/' check_mode_label
check_disallowed() { pp_variant "$1" provider-freshcache '$a E3J9 entry_mode=600'; pp_fails; }
mutation "record_allowed always true" "$L" 's/^record_allowed() {$/record_allowed() { return 0/' check_disallowed
# Leak marker: never on any launcher output surface; always counted, and the run fails.
check_leak() { # check_leak <launcher> <line> [marker]
  pp_setup
  pp_records "$(now_prefix provider)" provider
  jrec "$INV" "$(now_prefix provider)" "$2"
  pp_run "$1" provider
  pp_fails && ! grep -q -F "${3:-$LEAK}" "$ST/out" "$ST/err"
}
t "leak marker as a vocabulary-shaped record with an unknown name → never printed, fail" check_leak "$L" 'E3J9 zzleakmarker=1' zzleakmarker
for line in "free text $LEAK https://example.invalid/?t=$LEAK" "E3J9 $LEAK=1" "E3J9 provider_result=$LEAK" "E3J9 probe_mode=$LEAK" "E3J9 entry_size=$LEAK"; do
  t "leak marker as '${line%% *} …' → never printed, counted, fail" check_leak "$L" "$line"
done
check_leak_value() { check_leak "$1" "E3J9 provider_result=$LEAK"; }
mutation "value-class check removed" "$L" 's/^  \[\[ \$value =~ \${PP_CLASS_RE\[\$class\]} \]\]$/  true/' check_leak_value
pp_setup
pp_records "$(now_prefix provider)" provider
jrec "$INV" "$(now_prefix provider)" "free text $LEAK"
jrec "$INV" "$(now_prefix provider)" "E3J9 zzleakmarker=1"
pp_run "$L" provider
t "leak lines are counted: nonvocab 1, disallowed 1" bash -c "grep -q -x 'E3J9 bound_nonvocab_lines=1' '$ST/out' && grep -q -x 'E3J9 bound_disallowed_lines=1' '$ST/out'"

# 10g. Unit state, start, bind, wait, cleanup and postconditions.
for s in nrestarts:1 result:exit-code status:1; do
  pp_setup
  pp_records "$(now_prefix provider)" provider
  echo "${s#*:}" >"$ST/${s%%:*}"
  pp_run "$L" provider
  t "unit state ${s%%:*}=${s#*:} with clean records → fail" pp_fails
done
pp_setup
pp_records "$(now_prefix provider)" provider
echo 75 >"$ST/status"
echo failed >"$ST/active"
pp_run "$L" provider
t "exit 75 with records → fail (never busy)" pp_fails
pp_setup
pp_records "$(now_prefix provider)" provider 's/probe_result=pass/probe_result=fail/'
pp_run "$L" provider
t "exit 0 with probe_result=fail → fail" pp_fails
pp_setup
pp_records "$(now_prefix provider)" provider
echo root >"$ST/prop.service.User"
pp_run "$L" provider
t "provider attestation: User not the service identity → attest false, fail" bash -c "grep -q -x 'E3J9 bound_attest_ok=false' '$ST/out' && [ \"\$(sed -n 's/^E3J9 provider_run_result=//p' '$ST/out')\" = fail ]"
pp_setup
pp_records "$(now_prefix provider)" provider
echo yes >"$ST/prop.service.PrivateNetwork"
pp_run "$L" provider
t "provider attestation: PrivateNetwork=yes is not a provider unit → fail" pp_fails
check_start_fail_unattested() { # a failed start leaves an unattested unit untouched
  pp_setup
  echo 1 >"$ST/run_rc"
  echo root >"$ST/prop.service.User"
  pp_run "$1" provider
  [ "$(rc_of)" = 70 ] && grep -q -x 'E3J9 bound_start_ok=false' "$ST/out" && grep -q -x 'E3J9 pp_provenance=unproven' "$ST/out" &&
    ! grep -q '^systemctl stop' "$ST/calls"
}
t "start fails and the name's unit does not attest → untouched, unproven, exit 70" check_start_fail_unattested "$L"
mutation "start-failure cleanup without attestation" "$L" 's/if \[ "\$load" = loaded \] && attest_bound; then/if [ "$load" = loaded ]; then/' check_start_fail_unattested
pp_setup
echo 1 >"$ST/run_rc"
pp_run "$L" provider
t "start fails and the unit attests as ours → stopped and reset, exit 70" bash -c "[ \"\$(cat '$ST/rc')\" = 70 ] && grep -q '^systemctl stop' '$ST/calls' && grep -q -x 'E3J9 bound_cleanup_ok=true' '$ST/out'"
for inv in '' 0123456789ABCDEF0123456789ABCDEF 0123; do
  pp_setup
  echo "$inv" >"$ST/invid"
  pp_run "$L" provider
  t "invocation id '$inv' never bound → stopped, exit 70" bash -c "grep -q -x 'E3J9 bound_invocation=false' '$ST/out' && [ \"\$(cat '$ST/rc')\" = 70 ] && grep -q '^systemctl stop' '$ST/calls'"
done
pp_setup
pp_records "$(now_prefix provider)" provider
echo "$OLD" >"$ST/invid_after"
pp_run "$L" provider
t "invocation changed during the wait → fail" bash -c "grep -q -x 'E3J9 bound_invocation_changed=true' '$ST/out' && [ \"\$(sed -n 's/^E3J9 provider_run_result=//p' '$ST/out')\" = fail ]"
for st_sub in activating:start active:running deactivating:stop inactive:dead; do
  pp_setup
  pp_records "$(now_prefix provider)" provider
  echo "${st_sub%%:*}" >"$ST/active"
  echo "${st_sub#*:}" >"$ST/sub"
  pp_run "$L" provider
  t "unit state ${st_sub} → fail, cleaned up" bash -c "[ \"\$(sed -n 's/^E3J9 provider_run_result=//p' '$ST/out')\" = fail ] && grep -q '^systemctl stop' '$ST/calls'"
done
pp_setup
pp_records "$(now_prefix provider)" provider
echo 5 >"$ST/stop_rc"
pp_run "$L" provider
t "cleanup: stop fails after a clean pass → fail" bash -c "[ \"\$(sed -n 's/^E3J9 provider_run_result=//p' '$ST/out')\" = fail ] && grep -q -x 'E3J9 bound_cleanup_ok=false' '$ST/out'"
check_pp_cleanup() { # stopped (inactive) but the reset fails on a still-loaded unit: only the cleanup result can fail the run
  pp_setup
  pp_records "$(now_prefix provider)" provider
  touch "$ST/pprobe_no_gc"
  echo 1 >"$ST/reset_rc"
  pp_run "$1" provider
  pp_fails && grep -q -x 'E3J9 bound_cleanup_ok=false' "$ST/out" && grep -q -x 'E3J9 pp_post_no_active_unit=true' "$ST/out"
}
t "cleanup: reset fails on a still-loaded, stopped unit (postconditions otherwise true) → fail" check_pp_cleanup "$L"
mutation "provider run ignores the cleanup result" "$L" 's/^  pp_cleanup_bound || outcome=fail$/  pp_cleanup_bound || :/' check_pp_cleanup
check_post_entry() { # the entry changed mode during the run → postcondition fails
  pp_setup
  pp_records "$(now_prefix provider)" provider
  echo 644 >"$ST/post_entry_mode"
  pp_run "$1" provider
  pp_fails && grep -q -x 'E3J9 pp_post_entry_meta_ok=false' "$ST/out"
}
t "postcondition: the entry is no longer 0600 → fail" check_post_entry "$L"
mutation "provider run ignores the postcondition entry check" "$L" '/^    emit pp_post_entry_meta_ok false$/{n;s/^    bad=1$/    :/}' check_post_entry
for post in post_fallback post_extra pids_after; do
  pp_setup
  pp_records "$(now_prefix provider)" provider
  echo 4242 >"$ST/$post"
  pp_run "$L" provider
  t "postcondition: $post → fail" pp_fails
done

# 10h. Preconditions: each refuses before any provider start.
pp_pre_refused() { [ "$(rc_of)" = 65 ] && grep -q -x 'E3J9 launcher_refused=preconditions_failed' "$ST/out" && ! grep -q -- '--unit=eanhl-cloud-cred-pprobe-' "$ST/run_calls" 2>/dev/null; }
pre_case() { # pre_case <label> <setup commands>
  pp_setup
  eval "$2"
  pp_run "$L" provider
  t "precondition: $1 → refused 65, never started" pp_pre_refused
}
pre_case 'CLI pin mismatch' 'printf other >"$SB/cli"'
pre_case 'no secret key' ': >"$ST/keylist"'
pre_case '.gpg-id names another key' 'printf "%s\n" 9999888877776666555544443333222211110000 >"$PSP/.gpg-id"'
pre_case 'auth entry missing' 'rm -f "$PSP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"'
pre_case 'auth entry 0644' 'chmod 644 "$PSP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"'
pre_case 'auth entry a symlink' 'mv "$PSP/ch.proton.drive/drive-sdk-cli/auth-session.gpg" "$SB/entry.real"; ln -s "$SB/entry.real" "$PSP/ch.proton.drive/drive-sdk-cli/auth-session.gpg"'
pre_case 'an extra store entry' ': >"$PSP/extra.gpg"'
pre_case 'auth-session.json fallback' ': >"$SB/home/auth-session.json"'
pre_case 'an active credential unit' 'echo "eanhl-cloud-cred-x.service loaded active running" >"$ST/units"'
pre_case 'an eanhl-cloud process' 'echo 4242 >"$ST/pids"; echo 0 >"$ST/pgrep_rc"'
pre_case 'network-online inactive' 'echo inactive >"$ST/netonline"'
pre_case 'boot id unreadable' 'rm -f "$SB/boot_id"'
pre_case 'a leftover pprobe unit file' ': >"$UD/eanhl-cloud-cred-pprobe-boot-provider-0123456789abcdef0123456789abcdef.timer"'
check_pre_pprobe() {
  pp_setup
  echo 'eanhl-cloud-cred-pprobe-now-provider-0123456789abcdef0123456789abcdef.service loaded failed failed' >"$ST/units"
  pp_run "$1" provider
  pp_pre_refused
}
t "precondition: a leftover pprobe unit → refused 65" check_pre_pprobe "$L"
mutation "drop the no-pprobe-object precondition" "$L" 's/^  pp_check_objects "\$verb" "\$slot" || return 1$/  :/' check_pre_pprobe
pp_setup
/usr/bin/flock --exclusive "$SB/home/locks/credential.lock" /usr/bin/sleep 20 &
held=$!
BG_PIDS+=("$held")
for _ in $(seq 1 30); do /usr/bin/flock --nonblock "$SB/home/locks/credential.lock" /usr/bin/true || break; sleep 0.1; done
pp_run "$L" provider
kill "$held" 2>/dev/null
wait "$held" 2>/dev/null
t "precondition: the credential lock is held → refused 65" pp_pre_refused
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"

# 10i. Freshness: fresh 128-bit names, never reused, never retried.
pp_setup
echo loaded >"$ST/loadstate"
pp_run "$L" provider
t "fresh name: the candidate is loaded → collision, never started, exit 70" bash -c "grep -q -x 'E3J9 bound_unit_collision=true' '$ST/out' && [ \"\$(cat '$ST/rc')\" = 70 ] && ! grep -q -- '--unit=eanhl-cloud-cred-pprobe-' '$ST/run_calls' 2>/dev/null"
pp_setup
printf '%s\t%s\t%s\n' "$OLD" "$(now_prefix provider)" x >"$ST/history.tsv"
pp_run "$L" provider
t "fresh name: journal history under the candidate → collision, never started" bash -c "grep -q -x 'E3J9 bound_unit_history_count=1' '$ST/out' && ! grep -q -- '--unit=eanhl-cloud-cred-pprobe-' '$ST/run_calls' 2>/dev/null"
pp_setup
pp_records "$(now_prefix provider)" provider
printf ' 00 11 22 33 44 55 66 77\n 88 99 aa bb cc dd ee ff\n' >"$ST/od_out"
pp_run "$L" provider
first=$(sed -n 's/^E3J9 bound_unit=//p' "$ST/out")
rm -f "$ST/run_calls"
pp_run "$L" provider
t "fresh name: a forced identical nonce is refused the second time (journal history), never started" bash -c "
  [ '$first' = 'eanhl-cloud-cred-pprobe-now-provider-00112233445566778899aabbccddeeff' ] &&
  grep -q -x 'E3J9 bound_unit_collision=true' '$ST/out' && ! grep -q -- '--unit=eanhl-cloud-cred-pprobe-' '$ST/run_calls' 2>/dev/null"

# 10j. Cancellation: a signal during the wait cleans up and fails; no retry.
LC=$W/launcher-cancel
sed 's#^readonly PP_WAIT=2$#readonly PP_WAIT=30#' "$L" >"$LC"
chmod +x "$LC"
check_cancel() {
  pp_setup
  echo activating >"$ST/active"
  echo start >"$ST/sub"
  "$1" provider-probe run provider >"$ST/out" 2>"$ST/err" &
  local lp=$!
  for _ in $(seq 1 100); do grep -q -x 'E3J9 bound_invocation=true' "$ST/out" 2>/dev/null && break; sleep 0.05; done
  kill -TERM "$lp" 2>/dev/null
  wait "$lp"
  local rc=$?
  [ "$rc" -ne 0 ] && grep -q -x 'E3J9 pp_cancelled=true' "$ST/out" && grep -q '^systemctl stop' "$ST/calls" &&
    grep -q -x 'E3J9 provider_run_result=fail' "$ST/out" && [ "$(grep -c -- '--unit=eanhl-cloud-cred-pprobe-' "$ST/run_calls")" -eq 1 ]
}
t "cancel: TERM during the wait → pp_cancelled, stopped, fail, one start only" check_cancel "$LC"
mutation "trap removed" "$LC" '/trap pp_on_signal INT TERM HUP/d' check_cancel

# 10k. Scheduled probes: delayed slots (transient timers).
sched_stem() { sed -n 's/^E3J9 bound_unit=//p' "$ST/out"; }
pp_setup
"$L" provider-probe schedule t20m >"$ST/out" 2>"$ST/err"
echo $? >"$ST/rc"
T20=$(sched_stem)
t "schedule t20m: fixed --on-active=20min, attested before firing, scheduled, exit 0" bash -c "
  [ \"\$(cat '$ST/rc')\" = 0 ] && grep -q -x 'E3J9 pp_attest_ok=true' '$ST/out' && grep -q -x 'E3J9 pp_scheduled=true' '$ST/out' &&
  grep -- '--unit=$T20' '$ST/run_calls' | grep -q -- ' --on-active=20min --timer-property=RemainAfterElapse=yes ' &&
  [[ '$T20' =~ ^eanhl-cloud-cred-pprobe-t20m-provider-[0-9a-f]{32}\$ ]] && ! grep -q '^systemctl stop' '$ST/calls'"
"$L" provider-probe collect t20m >"$ST/out"
echo $? >"$ST/rc"
t "collect t20m before it fired → pending 65, nothing stopped, nothing read" bash -c "
  [ \"\$(cat '$ST/rc')\" = 65 ] && grep -q -x 'E3J9 provider_run_result=pending' '$ST/out' && ! grep -q '^systemctl stop' '$ST/calls' && ! grep -q -- '-o cat' '$ST/calls'"
"$L" provider-probe schedule t6h15m >"$ST/out"
T6=$(sched_stem)
t "schedule t6h15m while t20m is armed → scheduled (the other delayed slot is permitted)" bash -c "grep -q -x 'E3J9 pp_scheduled=true' '$ST/out' && grep -- '--unit=$T6' '$ST/run_calls' | grep -q -- ' --on-active=6h15min '"
"$L" provider-probe schedule t20m >"$ST/out"
t "schedule t20m again while one is armed → refused 65" grep -q -x 'E3J9 launcher_refused=preconditions_failed' "$ST/out"
touch "$ST/triggered"
pp_records "eanhl-cloud-cred-pprobe-t20m-provider-" provider
"$L" provider-probe collect t20m >"$ST/out"
echo $? >"$ST/rc"
t "collect t20m after it fired → pass, pair removed, the t6h15m pair left alone" bash -c "
  [ \"\$(cat '$ST/rc')\" = 0 ] && grep -q -x 'E3J9 provider_run_result=pass' '$ST/out' &&
  grep -q '^systemctl stop -- $T20.timer' '$ST/calls' && grep -q '^systemctl stop -- $T20.service' '$ST/calls' &&
  ! grep -q '^systemctl stop -- $T6' '$ST/calls' && grep -q -x 'E3J9 pp_post_no_active_unit=true' '$ST/out'"
rm -f "$ST/journal.tsv"
pp_records "eanhl-cloud-cred-pprobe-t6h15m-provider-" provider
"$L" provider-probe collect t6h15m >"$ST/out"
t "collect t6h15m → pass" grep -q -x 'E3J9 provider_run_result=pass' "$ST/out"
check_hs() { # a scheduled probe that ran with a human session → fail
  pp_setup
  "$1" provider-probe schedule t20m >/dev/null
  touch "$ST/triggered"
  HS=1 pp_records "eanhl-cloud-cred-pprobe-t20m-provider-" provider
  "$1" provider-probe collect t20m >"$ST/out"
  [ "$?" -eq 1 ] && grep -q -x 'E3J9 provider_run_result=fail' "$ST/out"
}
t "collect: human_sessions=1 → fail" check_hs "$L"
mutation "scheduled slots without the human_sessions=0 rule" "$L" 's/^  \[ "\$1" != now \] || return 0$/  return 0/' check_hs
pp_setup
"$L" provider-probe schedule t20m >/dev/null
touch "$ST/triggered"
pp_records "eanhl-cloud-cred-pprobe-t20m-provider-" provider
printf '%s\n' ffffffff-4567-89ab-cdef-0123456789ab >"$SB/boot_id"
"$L" provider-probe collect t20m >"$ST/out"
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
t "collect t20m after a reboot (boot id changed) → fail" grep -q -x 'E3J9 provider_run_result=fail' "$ST/out"
pp_setup
printf '%s\n' '{ OnActiveUSec=21min ; next_elapse=20min }' >"$ST/prop.timer.TimersMonotonic"
"$L" provider-probe schedule t20m >"$ST/out"
echo $? >"$ST/rc"
t "schedule: attestation fails before firing → in-process rollback of its own pair, exit 70" bash -c "
  [ \"\$(cat '$ST/rc')\" = 70 ] && grep -q -x 'E3J9 pp_attest_ok=false' '$ST/out' && grep -q -x 'E3J9 pp_rollback_complete=true' '$ST/out' &&
  grep -q '^systemctl stop -- eanhl-cloud-cred-pprobe-t20m-provider-.*\\.timer' '$ST/calls'"

# 10l. Boot slot: the persistent pair (the real unit-publish helper in the sandbox chain).
build_up() { # build_up <helper-src> <dst> <root> <hooks>: the sandbox chain, owner ids, test points
  sed -e "s#^my \$UNIT_DIR    = .*#my \$UNIT_DIR    = '$3/etc/systemd/system';#" \
    -e "s#^my \$WANTS_DIR   = .*#my \$WANTS_DIR   = '$3/etc/systemd/system/timers.target.wants';#" \
    -e "s#^my @TRUST_CHAIN = .*#my @TRUST_CHAIN = ('$3', '$3/etc', '$3/etc/systemd', '$3/etc/systemd/system');#" \
    -e "s#^my \$OWNER_UID   = .*#my \$OWNER_UID   = $MYUID;#" -e "s#^my \$OWNER_GID   = .*#my \$OWNER_GID   = $MYGID;#" \
    -e "s|^\( *\)# TEST-POINT \([a-z_]*\) \(.*\)\$|\1test_point('\2', \3);|" -e "s|^\( *\)# TEST-POINT \([a-z_]*\)\$|\1test_point('\2', '');|" \
    -e 's/\$dh->sync/hsync($dh, "dir")/g' -e 's/\$fh->sync/hsync($fh, "file")/g' "$1" >"$2"
  sed "s#__HOOKS__#$4#g" >>"$2" <<'PERL'
# ── test-only hooks (harness copy only; never in the template) ──
our $HOOKS;
BEGIN { $HOOKS = '__HOOKS__'; } # compile time: the main program exits before the end of the file
sub hook_read {
    my ($n) = @_;
    open(my $f, '<', "$HOOKS/$n") or return;
    my $l = <$f>;
    close $f;
    return unless defined $l;
    my ($v) = $l =~ /\A([A-Za-z0-9._\/-]+)\n?\z/;
    return $v;
}
sub hook_log { my ($t) = @_; if (open(my $f, '>>', "$HOOKS/calls")) { print $f "$t\n"; close $f; } return; }
sub hsync {
    my ($h, $tag) = @_;
    hook_log("sync-$tag");
    if (-e "$HOOKS/fail-sync-$tag") { unlink("$HOOKS/fail-sync-$tag"); return 0; }
    return $h->sync;
}
sub test_point {
    my ($tag, $arg) = @_;
    hook_log("tp-$tag");
    if ($tag eq 'before_link') {
        my $want = hook_read('race');
        my ($p) = defined $arg ? $arg =~ /\A(.*)\z/s : ();
        if (defined $want && defined $p && $p =~ m{/\Q$want\E\z}) {
            if (sysopen(my $f, $p, O_WRONLY | O_CREAT | O_EXCL, 0644)) { print $f "racer\n"; close $f; }
        }
    } elsif ($tag eq 'rollback') {
        my $nb = hook_read('foreign-newinode');
        if (defined $nb) {
            my $p = "$UNIT_DIR/$nb";
            # The replacement is created BEFORE the original goes away, so its inode
            # number cannot be the original's (an immediately recycled inode number
            # would defeat any dev/ino identity check; only the byte check remains then).
            if (open(my $f, '<', $p)) {
                local $/;
                my $c = <$f>;
                close $f;
                if (open(my $g, '>', "$p.new")) { print $g $c; close $g; chmod 0644, "$p.new"; rename("$p.new", $p); }
            }
        }
        my $ip = hook_read('foreign-inplace');
        if (defined $ip) { my $p = "$UNIT_DIR/$ip"; if (open(my $g, '+<', $p)) { print $g 'X'; close $g; } }
    } elsif ($tag eq 'after_lstat') {
        my $want = hook_read('swap');
        my ($p) = defined $arg ? $arg =~ /\A(.*)\z/s : ();
        if (defined $want && defined $p && $p =~ m{/\Q$want\E\z}) {
            unlink("$HOOKS/swap");
            rename($p, "$p.moved");
            symlink("$p.moved", $p);
        }
    }
    return;
}
PERL
}
UPHOOKS=$W/uphooks-launcher
mkdir -p "$UPHOOKS"
build_up "$HELPER_SRC" "$UPL" "$ER" "$UPHOOKS"
t "unit-publish launcher copy: perl -T -c" bash -c "perl -T -c '$UPL' >/dev/null 2>&1"
render_boot() { # render_boot <service|timer> <stem> <armed>: the launcher's canonical bytes
  bash -c ". '$LLIB'; pp_render_$1 '$2' '$3'"
}
pp_setup
"$L" provider-probe schedule boot >"$ST/out" 2>"$ST/err"
echo $? >"$ST/rc"
BOOT_STEM=$(sched_stem)
t "schedule boot: published, attested, enabled, synced, exit 0" bash -c "
  [ \"\$(cat '$ST/rc')\" = 0 ] && grep -q -x 'E3J9 pp_scheduled=true' '$ST/out' && grep -q -x 'E3J9 pp_enable_attested=true' '$ST/out' &&
  [[ '$BOOT_STEM' =~ ^eanhl-cloud-cred-pprobe-boot-provider-[0-9a-f]{32}\$ ]]"
t "schedule boot: both files are the canonical bytes, 0644, no temporary files" bash -c "
  cmp -s '$UD/$BOOT_STEM.service' <(bash -c \". '$LLIB'; pp_render_service '$BOOT_STEM' '$BOOT_HEX'\") &&
  cmp -s '$UD/$BOOT_STEM.timer' <(bash -c \". '$LLIB'; pp_render_timer '$BOOT_STEM' '$BOOT_HEX'\") &&
  [ \"\$(stat -c %a '$UD/$BOOT_STEM.service') \$(stat -c %a '$UD/$BOOT_STEM.timer')\" = '644 644' ] &&
  ! ls -A '$UD' | grep -q '\\.tmp\$' && [ -L '$WD/$BOOT_STEM.timer' ]"
t "schedule boot: order daemon-reload → enable, never start" bash -c "
  grep -n -E '^systemctl (daemon-reload|enable)' '$ST/calls' | head -2 | cut -d: -f2 | tr '\n' ' ' | grep -q -x 'systemctl daemon-reload systemctl enable -- $BOOT_STEM.timer ' &&
  ! grep -q -E '^systemctl start|enable --now' '$ST/calls'"
t "schedule boot: the helper synced the unit directory and the wants directory" bash -c "[ \"\$(grep -c -x 'sync-dir' '$UPHOOKS/calls')\" -ge 2 ]"
"$L" provider-probe schedule boot >"$ST/out"
t "schedule boot while a pair exists → refused 65" grep -q -x 'E3J9 launcher_refused=preconditions_failed' "$ST/out"
# the reboot: a new boot id; the timer fired once in the new boot
printf '%s\n' 99990000-1111-2222-3333-444455556666 >"$SB/boot_id"
touch "$ST/triggered"
echo active >"$ST/boot_timer_state"
pp_records "eanhl-cloud-cred-pprobe-boot-provider-" provider
"$L" provider-probe collect boot >"$ST/out"
echo $? >"$ST/rc"
t "collect boot after the reboot → pass, boot id changed, pair unpublished, link removed" bash -c "
  [ \"\$(cat '$ST/rc')\" = 0 ] && grep -q -x 'E3J9 provider_run_result=pass' '$ST/out' && grep -q -x 'E3J9 pp_boot_id_changed=true' '$ST/out' &&
  [ ! -e '$UD/$BOOT_STEM.service' ] && [ ! -e '$UD/$BOOT_STEM.timer' ] && [ ! -e '$WD/$BOOT_STEM.timer' ] &&
  grep -q '^systemctl disable -- $BOOT_STEM.timer' '$ST/calls'"
printf '%s\n' "$BOOT_UUID" >"$SB/boot_id"
check_boot_unchanged() { # the boot probe ran in the boot it was armed in → fail
  pp_setup
  "$1" provider-probe schedule boot >/dev/null
  touch "$ST/triggered"
  pp_records "eanhl-cloud-cred-pprobe-boot-provider-" provider
  "$1" provider-probe collect boot >"$ST/out"
  [ "$?" -eq 1 ] && grep -q -x 'E3J9 pp_boot_id_changed=false' "$ST/out"
}
t "collect boot without a reboot → fail" check_boot_unchanged "$L"
mutation "drop the boot-changed rule" "$L" 's/^    \[ -n "\$cur" \] && \[ "\$cur" != "\$PP_ARMED" \] || outcome=fail$/    :/' check_boot_unchanged
pp_setup
echo 1 >"$ST/enable_rc"
"$L" provider-probe schedule boot >"$ST/out"
echo $? >"$ST/rc"
t "schedule boot: enable fails → disable, link absent, pair unpublished by bytes, rollback complete, exit 70" bash -c "
  [ \"\$(cat '$ST/rc')\" = 70 ] && grep -q -x 'E3J9 pp_rollback_complete=true' '$ST/out' &&
  [ -z \"\$(ls -A '$UD' | grep eanhl-cloud-cred-pprobe)\" ] && [ -z \"\$(ls -A '$WD')\" ]"
pp_setup
echo 1 >"$ST/reload_rc"
"$L" provider-probe schedule boot >"$ST/out"
t "schedule boot: daemon-reload fails → own pair unpublished, rollback honestly incomplete (the reload still fails), exit 70" bash -c "
  grep -q -x 'E3J9 pp_rollback_complete=false' '$ST/out' && grep -q -x 'E3J9 pp_scheduled=false' '$ST/out' && [ -z \"\$(ls -A '$UD' | grep eanhl-cloud-cred-pprobe)\" ]"
pp_setup
ln -s "$SB/nowhere" "$UD/eanhl-cloud-cred-pprobe-boot-provider-ffffffffffffffffffffffffffffffff.service"
"$L" provider-probe schedule boot >"$ST/out"
t "schedule boot: a pprobe symlink in the unit directory → refused, symlink untouched" bash -c "grep -q -x 'E3J9 launcher_refused=preconditions_failed' '$ST/out' && [ -L '$UD/eanhl-cloud-cred-pprobe-boot-provider-ffffffffffffffffffffffffffffffff.service' ]"
rm -f "$UD/eanhl-cloud-cred-pprobe-boot-provider-ffffffffffffffffffffffffffffffff.service"
# rendered pair: allowed keys only; systemd-analyze verify (production paths)
VR=$W/verify
mkdir -p "$VR"
VSTEM=eanhl-cloud-cred-pprobe-boot-provider-0123456789abcdef0123456789abcdef
render_boot service "$VSTEM" "$BOOT_HEX" | sed -e "s#$SB/wrapper#/usr/local/lib/eanhl-cloud/credential-exec#" -e "s#=$ME\$#=eanhl-cloud#" >"$VR/$VSTEM.service"
render_boot timer "$VSTEM" "$BOOT_HEX" >"$VR/$VSTEM.timer"
t "rendered timer: exactly OnBootSec=10min, RemainAfterElapse, Persistent=no, Unit=, WantedBy; no other trigger" test \
  "$(grep -o -E '^[A-Za-z]+=' "$VR/$VSTEM.timer" | tr '\n' ' ')" = 'Description= OnBootSec= RemainAfterElapse= Persistent= Unit= WantedBy= '
t "rendered service: After/Wants in [Unit], no [Install], no Environment, WorkingDirectory, the wrapper ExecStart" bash -c "
  sed -n '/^\\[Unit\\]/,/^\\[Service\\]/p' '$VR/$VSTEM.service' | grep -q -x 'After=network-online.target' &&
  ! grep -q -E '^\\[Install\\]|^Environment|StateDirectory|CacheDirectory' '$VR/$VSTEM.service' &&
  grep -q -x 'WorkingDirectory=/var/lib/eanhl-cloud' '$VR/$VSTEM.service' &&
  grep -q -x 'ExecStart=/usr/local/lib/eanhl-cloud/credential-exec --nonblock probe provider:provider' '$VR/$VSTEM.service'"
if command -v systemd-analyze >/dev/null 2>&1; then
  vout=$(systemd-analyze verify --man=no "$VR/$VSTEM.service" "$VR/$VSTEM.timer" 2>&1)
  t "systemd-analyze verify: only the not-installed executable is reported" bash -c "
    [ -n \"\$1\" ] && ! grep -v -q -F 'Command /usr/local/lib/eanhl-cloud/credential-exec is not executable: No such file or directory' <<<\"\$1\"" _ "$vout"
else
  printf 'NOTE systemd-analyze not installed: the rendered pair was NOT verified (not counted as passed)\n'
fi

# 10m. Provenance: collect and discard never touch an object they cannot prove.
mut_calls() { if [ -f "$ST/calls" ]; then grep -c -E '^systemctl (stop|reset-failed|disable)' "$ST/calls"; else echo 0; fi; }
prov_case() { # prov_case <launcher> <verb> <slot> <reason>: refused 65 with <reason>, nothing mutated
  local before
  before=$(mut_calls)
  "$1" provider-probe "$2" "$3" >"$ST/out"
  local rc=$?
  [ "$rc" -eq 65 ] && grep -q -x "E3J9 pp_provenance=$4" "$ST/out" && [ "$(mut_calls)" = "$before" ]
}
sched_t20m() { pp_setup; "$1" provider-probe schedule t20m >/dev/null; T20=$(grep -o -E 'eanhl-cloud-cred-pprobe-t20m-provider-[0-9a-f]{32}' "$ST/run_calls" | head -1); }
for kv in 'User=root' 'ExecStart={ path=x ; argv[]=x --nonblock probe local:local ; ignore_errors=no }' 'FragmentPath=/etc/systemd/system/x.service' 'PrivateNetwork=yes'; do
  for verb in collect discard; do
    sched_t20m "$L"
    printf '%s\n' "${kv#*=}" >"$ST/prop.service.${kv%%=*}"
    t "$verb t20m: service ${kv%%=*} mismatch → mismatch, nothing touched" prov_case "$L" "$verb" t20m mismatch
  done
done
for kv in 'Unit=other.service' 'TimersMonotonic={ OnActiveUSec=21min ; next_elapse=1s }' 'TimersCalendar={ OnCalendar=daily ; next_elapse=1d }'; do
  sched_t20m "$L"
  printf '%s\n' "${kv#*=}" >"$ST/prop.timer.${kv%%=*}"
  t "discard t20m: timer ${kv%%=*} mismatch → mismatch, nothing touched" prov_case "$L" discard t20m mismatch
done
check_discard_attest() { sched_t20m "$1"; echo root >"$ST/prop.service.User"; prov_case "$1" discard t20m mismatch; }
check_discard_ok() { sched_t20m "$1"; "$1" provider-probe discard t20m >"$ST/out"; [ "$?" -eq 0 ] && grep -q -x 'E3J9 pp_discarded=true' "$ST/out"; }
t "discard t20m: a proven pair → removed, exit 0" check_discard_ok "$L"
mutation "discard skips attestation" "$L" '/pp_discarded false; exit 65; fi$/s/ && pp_attest_found "\$slot"//' check_discard_ok
check_collect_ok() { sched_t20m "$1"; touch "$ST/triggered"; pp_records "eanhl-cloud-cred-pprobe-t20m-provider-" provider; "$1" provider-probe collect t20m >"$ST/out"; [ "$?" -eq 0 ]; }
mutation "collect skips attestation" "$L" '/emit provider_run_result fail; exit 65; fi$/s/ && pp_attest_found "\$slot"//' check_collect_ok
check_ambiguous() { # two stems under one slot → ambiguous
  sched_t20m "$1"
  echo 'eanhl-cloud-cred-pprobe-t20m-provider-ffffffffffffffffffffffffffffffff.service loaded inactive dead' >"$ST/units"
  prov_case "$1" discard t20m ambiguous
}
t "discard t20m: two stems → ambiguous, nothing touched" check_ambiguous "$L"
mutation "discovery accepts two stems" "$L" 's/^  if \[ "\${#stems\[@\]}" -ne 1 \]; then$/  if [ "${#stems[@]}" -lt 1 ]; then/' check_ambiguous
pp_setup
echo 'eanhl-cloud-cred-pprobe-boot-provider-XYZ.service loaded active running' >"$ST/units"
t "collect boot: a foreign name under the prefix → foreign, nothing touched" prov_case "$L" collect boot foreign
pp_setup
echo 'eanhl-cloud-cred-pprobe-t20m-neg-nokey-0123456789abcdef0123456789abcdef.service loaded inactive dead' >"$ST/units"
t "discard t20m: a non-provider mode under a scheduled slot → foreign" prov_case "$L" discard t20m foreign
pp_setup
t "discard t20m: nothing there → missing, exit 65" prov_case "$L" discard t20m missing
sched_t20m "$L"
rm -f "$ST/u/$T20.timer"
t "discard t20m: the timer is missing → missing, nothing touched" prov_case "$L" discard t20m missing
# boot pair provenance: bytes, ids and the wants link
sched_boot() { pp_setup; "$1" provider-probe schedule boot >/dev/null; BOOT_STEM=$(ls "$UD" | grep -o -E '^eanhl-cloud-cred-pprobe-boot-provider-[0-9a-f]{32}' | head -1); }
check_boot_bytes() { # an extra ExecStartPost= line (not an attested property) → mismatch, nothing touched
  sched_boot "$1"
  printf 'ExecStartPost=/usr/bin/true\n' >>"$UD/$BOOT_STEM.service"
  prov_case "$1" discard boot mismatch && grep -q -x 'ExecStartPost=/usr/bin/true' "$UD/$BOOT_STEM.service"
}
t "discard boot: an extra unit-file line → mismatch, bytes intact, nothing touched" check_boot_bytes "$L"
mutation "skip the boot byte-compare" "$L" 's/^    \[ "\$have" = "\$want" \] || return 1$/    :/' check_boot_bytes
for tamper in 'printf "\n" >>"$UD/$BOOT_STEM.timer"' 'sed -i "s/^Persistent=no\$/Persistent=no\r/" "$UD/$BOOT_STEM.timer"' \
  'sed -i "s/armed-boot $BOOT_HEX/armed-boot ffffffffffffffffffffffffffffffff/" "$UD/$BOOT_STEM.timer"' \
  'sed -i "s/armed-boot $BOOT_HEX/armed-boot $BOOT_UUID/" "$UD/$BOOT_STEM.service" "$UD/$BOOT_STEM.timer"' \
  'sed -i "s/armed-boot $BOOT_HEX/armed-boot ${BOOT_HEX^^}/" "$UD/$BOOT_STEM.service" "$UD/$BOOT_STEM.timer"' \
  'rm -f "$WD/$BOOT_STEM.timer"; ln -s /elsewhere "$WD/$BOOT_STEM.timer"' \
  'echo root >"$ST/prop.service.User"'; do
  sched_boot "$L"
  eval "$tamper"
  t "discard boot after: $tamper → mismatch, nothing touched" prov_case "$L" discard boot mismatch
done
sched_boot "$L"
: >"$WD/eanhl-cloud-cred-pprobe-boot-provider-ffffffffffffffffffffffffffffffff.timer"
t "discard boot: an extra wants entry (a second stem) → ambiguous, nothing touched" prov_case "$L" discard boot ambiguous
rm -f "$WD/eanhl-cloud-cred-pprobe-boot-provider-ffffffffffffffffffffffffffffffff.timer"
sched_boot "$L"
rm -f "$WD/$BOOT_STEM.timer"
t "discard boot: the wants link removed → missing, nothing touched" prov_case "$L" discard boot missing
sched_boot "$L"
"$L" provider-probe discard boot >"$ST/out"
t "discard boot: a proven pair → disabled, unpublished, exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 pp_discarded=true' '$ST/out' && [ -z \"\$(ls -A '$UD' | grep eanhl-cloud-cred-pprobe)\" ] && [ -z \"\$(ls -A '$WD')\" ]"
# the SIGKILL orphan: a `now` unit left loaded (its cleanup failed) is removed by `discard now` with provenance
pp_setup
pp_records "$(now_prefix e4-decoy)" e4-decoy
echo 5 >"$ST/stop_rc"
pp_run "$L" e4-decoy
rm -f "$ST/stop_rc"
"$L" provider-probe discard now >"$ST/out"
t "discard now: an orphaned e4-decoy run unit (persisted provenance with the E4 pattern) → removed, exit 0" bash -c "[ $? -eq 0 ] && grep -q -x 'E3J9 pp_discarded=true' '$ST/out'"
pp_setup
pp_records "$(now_prefix provider)" provider
echo 5 >"$ST/stop_rc"
pp_run "$L" provider
rm -f "$ST/stop_rc"
echo root >"$ST/prop.service.User"
t "discard now: an orphan that does not attest → mismatch, never stopped" prov_case "$L" discard now mismatch

# 10n. One execution identity per probe across P1 x2, P3, P4, P5.
pp_setup
names=()
for _ in 1 2; do
  rm -f "$ST/journal.tsv"
  pp_records "$(now_prefix provider)" provider
  pp_run "$L" provider
  names+=("$(sed -n 's/^E3J9 bound_unit=//p' "$ST/out")")
done
for slot in t20m t6h15m; do
  "$L" provider-probe schedule "$slot" >"$ST/out"
  names+=("$(sched_stem)")
done
touch "$ST/triggered"
pp_records "eanhl-cloud-cred-pprobe-t20m-provider-" provider
pp_records "eanhl-cloud-cred-pprobe-t6h15m-provider-" provider
"$L" provider-probe collect t20m >/dev/null
"$L" provider-probe collect t6h15m >/dev/null
rm -f "$ST/triggered"
"$L" provider-probe schedule boot >"$ST/out"
names+=("$(sched_stem)")
t "P1 x2, P3, P4, P5: five distinct fresh names, each grammar-valid" bash -c "
  [ \"\$(printf '%s\n' \"\$@\" | sort -u | wc -l)\" -eq 5 ] &&
  for n in \"\$@\"; do [[ \$n =~ ^eanhl-cloud-cred-pprobe-(now|t20m|t6h15m|boot)-provider-[0-9a-f]{32}\$ ]] || exit 1; done" _ "${names[@]}"
"$L" provider-probe discard boot >/dev/null

# ── 11. unit-publish helper (E3J9D-R): real files in a sandbox chain, test-user owned ──
UPS=$W/ups
UR=$UPS/root
UUD=$UR/etc/systemd/system
UWD=$UUD/timers.target.wants
UH=$UPS/hooks
mkdir -p "$UWD" "$UH"
chmod 755 "$UR" "$UR/etc" "$UR/etc/systemd" "$UUD" "$UWD"
UPT=$W/unit-publish-test
build_up "$HELPER_SRC" "$UPT" "$UR" "$UH"
USTEM=eanhl-cloud-cred-pprobe-boot-provider-00112233445566778899aabbccddeeff
printf '[Unit]\nDescription=svc %s\n' "$LEAK" >"$UPS/svc.in"
printf '[Unit]\nDescription=timer\n' >"$UPS/tmr.in"
up_reset() { chmod -R u+rwx "$UR" 2>/dev/null; rm -rf "$UUD"/* "$UUD"/.[!.]* "$UH"/*; mkdir -p "$UWD"; chmod 755 "$UUD" "$UWD"; }
up() { # up <helper copy> <op> [stem]: fds 3/4 from the fixed inputs; stdout in $UPS/out, rc in $UPS/rc
  local h=$1
  shift
  perl -T -- "$h" "$@" 3<"$UPS/svc.in" 4<"$UPS/tmr.in" >"$UPS/out" 2>"$UPS/err"
  echo $? >"$UPS/rc"
}
urc() { cat "$UPS/rc"; }
ureason() { sed -n 's/^E3J9 unit_publish_reason=//p' "$UPS/out"; }
no_tmp() { ! ls -A "$UUD" | grep -q '\.tmp$'; }
up_reset
up "$UPT" publish-pair "$USTEM"
t "helper publish: ok, both files 0644 with the exact bytes, no temporary file, directory synced" bash -c "
  [ \"\$(cat '$UPS/rc')\" = 0 ] && cmp -s '$UPS/svc.in' '$UUD/$USTEM.service' && cmp -s '$UPS/tmr.in' '$UUD/$USTEM.timer' &&
  [ \"\$(stat -c '%a %h' '$UUD/$USTEM.service') \$(stat -c '%a %h' '$UUD/$USTEM.timer')\" = '644 1 644 1' ] &&
  ! ls -A '$UUD' | grep -q '\\.tmp\$' && grep -q -x sync-dir '$UH/calls' && grep -q -x sync-file '$UH/calls'"
t "helper: output vocabulary-only; the payload's marker never printed" bash -c "! grep -v -q -E '^E3J9 [a-z_]+=[a-z0-9_.:-]+\$' '$UPS/out' && ! grep -q '$LEAK' '$UPS/out' '$UPS/err'"
up "$UPT" publish-pair "$USTEM"
t "helper publish over an existing pair → refused dest_exists, bytes unchanged" bash -c "[ \"\$(cat '$UPS/rc')\" = 65 ] && grep -q -x 'E3J9 unit_publish_reason=dest_exists' '$UPS/out' && cmp -s '$UPS/svc.in' '$UUD/$USTEM.service'"
up "$UPT" unpublish-pair "$USTEM"
t "helper unpublish: both proven and removed, exit 0" bash -c "[ \"\$(cat '$UPS/rc')\" = 0 ] && [ ! -e '$UUD/$USTEM.service' ] && [ ! -e '$UUD/$USTEM.timer' ]"
up_reset
ln -s "$UPS/nowhere" "$UUD/$USTEM.service"
up "$UPT" publish-pair "$USTEM"
t "helper publish: destination is a dangling symlink → refused, symlink untouched, nothing written" bash -c "
  [ \"\$(cat '$UPS/rc')\" = 65 ] && [ \"\$(readlink '$UUD/$USTEM.service')\" = '$UPS/nowhere' ] && [ ! -e '$UPS/nowhere' ] && [ ! -e '$UUD/$USTEM.timer' ]"
up_reset
printf 'victim\n' >"$UPS/victim"
ln -s "$UPS/victim" "$UUD/$USTEM.timer"
up "$UPT" publish-pair "$USTEM"
t "helper publish: destination symlinks to a file → refused, target unchanged, no service written" bash -c "
  [ \"\$(cat '$UPS/rc')\" = 65 ] && [ \"\$(cat '$UPS/victim')\" = victim ] && [ ! -e '$UUD/$USTEM.service' ]"
up_reset
printf 'existing timer\n' >"$UUD/$USTEM.timer"
up "$UPT" publish-pair "$USTEM"
t "helper publish: partial pair (timer exists) → nothing published, the timer untouched" bash -c "
  [ \"\$(cat '$UPS/rc')\" = 65 ] && [ ! -e '$UUD/$USTEM.service' ] && [ \"\$(cat '$UUD/$USTEM.timer')\" = 'existing timer' ]"
check_up_race() { # a racing file appears at the timer name between the check and link(2)
  up_reset
  echo "$USTEM.timer" >"$UH/race"
  up "$1" publish-pair "$USTEM"
  [ "$(urc)" = 70 ] && [ "$(ureason)" = dest_exists ] && grep -q -x 'E3J9 unit_publish_rollback_complete=true' "$UPS/out" &&
    [ "$(cat "$UUD/$USTEM.timer")" = racer ] && [ ! -e "$UUD/$USTEM.service" ] && no_tmp
}
t "helper publish: destination race → link refuses, own service rolled back, racing file untouched" check_up_race "$UPT"
mutation "helper publishes with rename instead of link" "$UPT" 's/unless (link(\$rec->{path}, \$final)) {/unless (rename($rec->{path}, $final)) {/' check_up_race
check_up_trust() { # a group-writable unit directory → refused, nothing written
  up_reset
  chmod 775 "$UUD"
  up "$1" publish-pair "$USTEM"
  local rc
  rc=$(urc)
  chmod 755 "$UUD"
  [ "$rc" = 65 ] && [ "$(ureason)" = untrusted_directory ] && [ ! -e "$UUD/$USTEM.service" ]
}
t "helper: a group-writable unit directory → untrusted, refused" check_up_trust "$UPT"
mutation "helper trust check ignores the group/other write bit" "$UPT" 's/^    return 0 if S_IMODE(\$st\[2\]) & 022;$/    1;/' check_up_trust
up_reset
chmod 757 "$UR/etc"
up "$UPT" publish-pair "$USTEM"
chmod 755 "$UR/etc"
t "helper: an other-writable chain directory → refused" bash -c "[ \"\$(cat '$UPS/rc')\" = 65 ] && [ ! -e '$UUD/$USTEM.service' ]"
UPTO=$W/unit-publish-owner
sed "s/^my \$OWNER_UID   = .*/my \$OWNER_UID   = $((MYUID + 1));/" "$UPT" >"$UPTO"
up_reset
up "$UPTO" publish-pair "$USTEM"
t "helper: a chain directory not owned by the expected owner → refused" bash -c "[ \"\$(cat '$UPS/rc')\" = 65 ] && grep -q -x 'E3J9 unit_publish_reason=untrusted_directory' '$UPS/out'"
UR2=$UPS/root2
mkdir -p "$UR2/etc/systemd"
chmod 755 "$UR2" "$UR2/etc" "$UR2/etc/systemd"
ln -s "$UUD" "$UR2/etc/systemd/system"
UPTL=$W/unit-publish-symlinkdir
build_up "$HELPER_SRC" "$UPTL" "$UR2" "$UH"
up_reset
up "$UPTL" publish-pair "$USTEM"
t "helper: the unit directory is a symlink → refused, nothing written through it" bash -c "[ \"\$(cat '$UPS/rc')\" = 65 ] && [ ! -e '$UUD/$USTEM.service' ]"
# Deterministic temporary names (fixed urandom bytes) for the O_EXCL / O_NOFOLLOW cases.
printf '\x00\x01\x02\x03\x04\x05\x06\x07' >"$UPS/urandom"
UPTR=$W/unit-publish-fixed
sed "s#^my \$URANDOM     = .*#my \$URANDOM     = '$UPS/urandom';#" "$UPT" >"$UPTR"
TMPNAME=".$USTEM.service.0001020304050607.tmp"
check_up_excl() { # a pre-existing hard link at the temporary name is never written through
  up_reset
  printf 'victim\n' >"$UPS/victim"
  ln "$UPS/victim" "$UUD/$TMPNAME"
  up "$1" publish-pair "$USTEM"
  [ "$(urc)" = 70 ] && [ "$(cat "$UPS/victim")" = victim ] && [ ! -e "$UUD/$USTEM.service" ]
}
t "helper: the temporary name exists (hard link to a victim) → O_EXCL refuses, victim unchanged" check_up_excl "$UPTR"
mutation "helper without O_EXCL" "$UPTR" 's/O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600/O_WRONLY | O_CREAT | O_NOFOLLOW, 0600/' check_up_excl
up_reset
ln -s "$UPS/victim2" "$UUD/$TMPNAME"
up "$UPTR" publish-pair "$USTEM"
t "helper: the temporary name is a symlink → refused, nothing written through it" bash -c "[ \"\$(cat '$UPS/rc')\" = 70 ] && [ ! -e '$UPS/victim2' ] && [ ! -e '$UUD/$USTEM.service' ]"
check_up_sync() { # the directory fsync fails → full rollback, exit 70
  up_reset
  : >"$UH/fail-sync-dir"
  up "$1" publish-pair "$USTEM"
  [ "$(urc)" = 70 ] && [ "$(ureason)" = dir_sync_failed ] && grep -q -x 'E3J9 unit_publish_rollback_complete=true' "$UPS/out" &&
    [ ! -e "$UUD/$USTEM.service" ] && [ ! -e "$UUD/$USTEM.timer" ] && no_tmp
}
t "helper: directory fsync fails → both files rolled back, exit 70" check_up_sync "$UPT"
mutation "helper skips the directory fsync" "$UPT" "s/^    hsync(\$dh, \"dir\") or failed_rollback('dir_sync_failed');\$/    1;/" check_up_sync
check_up_foreign_newinode() { # our service replaced by a NEW inode with the same bytes → never removed
  up_reset
  echo "$USTEM.timer" >"$UH/race"
  echo "$USTEM.service" >"$UH/foreign-newinode"
  up "$1" publish-pair "$USTEM"
  [ "$(urc)" = 71 ] && grep -q -x 'E3J9 unit_publish_rollback_complete=false' "$UPS/out" && cmp -s "$UPS/svc.in" "$UUD/$USTEM.service"
}
t "helper rollback: a same-bytes file with another identity is left in place, exit 71" check_up_foreign_newinode "$UPT"
mutation "helper rollback without the identity check" "$UPT" 's/ && \$l\[0\] == \$rec->{dev} && \$l\[1\] == \$rec->{ino};$/;/' check_up_foreign_newinode
check_up_foreign_inplace() { # our service's bytes changed in place (same inode) → never removed
  up_reset
  echo "$USTEM.timer" >"$UH/race"
  echo "$USTEM.service" >"$UH/foreign-inplace"
  up "$1" publish-pair "$USTEM"
  [ "$(urc)" = 71 ] && [ -e "$UUD/$USTEM.service" ] && ! cmp -s "$UPS/svc.in" "$UUD/$USTEM.service"
}
t "helper rollback: bytes changed in place are left in place, exit 71" check_up_foreign_inplace "$UPT"
mutation "helper rollback without the byte check" "$UPT" 's/^    return 0 unless defined \$have && \$have eq \$rec->{bytes};$/    return 0 unless defined $have;/' check_up_foreign_inplace
up_pair() { up_reset; up "$UPT" publish-pair "$USTEM"; }
check_up_unpublish_changed() { # one byte changed in the TIMER → neither file removed
  up_pair
  printf 'X' >>"$UUD/$USTEM.timer"
  up "$1" unpublish-pair "$USTEM"
  [ "$(urc)" = 65 ] && [ -e "$UUD/$USTEM.service" ] && [ -e "$UUD/$USTEM.timer" ]
}
t "helper unpublish: the timer changed → refused, neither removed" check_up_unpublish_changed "$UPT"
mutation "unpublish checks only the first file before unlinking" "$UPT" 's/^    for my \$suffix (qw(service timer)) { # prove both before removing either$/    for my $suffix (qw(service)) {/' check_up_unpublish_changed
up_pair
printf 'X' >>"$UUD/$USTEM.service"
up "$UPT" unpublish-pair "$USTEM"
t "helper unpublish: the service changed → refused, neither removed" bash -c "[ \"\$(cat '$UPS/rc')\" = 65 ] && [ -e '$UUD/$USTEM.service' ] && [ -e '$UUD/$USTEM.timer' ]"
check_up_swap() { # between lstat and open the service becomes a symlink to the moved original → refused
  up_pair
  echo "$USTEM.service" >"$UH/swap"
  up "$1" unpublish-pair "$USTEM"
  [ "$(urc)" = 65 ] && [ -e "$UUD/$USTEM.timer" ] && [ -e "$UUD/$USTEM.service.moved" ]
}
t "helper unpublish: a symlink swapped in after lstat → O_NOFOLLOW refuses, nothing removed" check_up_swap "$UPT"
mutation "helper without O_NOFOLLOW on the re-read" "$UPT" 's/sysopen(my \$fh, \$path, O_RDONLY | O_NOFOLLOW)/sysopen(my $fh, $path, O_RDONLY)/' check_up_swap
up_reset
up "$UPT" publish-pair not-a-stem
t "helper: a stem outside the grammar → usage 64" bash -c "[ \"\$(cat '$UPS/rc')\" = 64 ]"
up "$UPT" publish-pair "$USTEM" extra
t "helper: an extra argument → usage 64" bash -c "[ \"\$(cat '$UPS/rc')\" = 64 ]"
perl -T -- "$UPT" publish-pair "$USTEM" >"$UPS/out" 2>/dev/null 3<&- 4<&-
rc=$?
t "helper: missing input descriptors → refused input_invalid" bash -c "[ $rc -eq 65 ] && grep -q -x 'E3J9 unit_publish_reason=input_invalid' '$UPS/out'"
printf 'a\0b\n' >"$UPS/nul.in"
perl -T -- "$UPT" publish-pair "$USTEM" 3<"$UPS/nul.in" 4<"$UPS/tmr.in" >"$UPS/out" 2>/dev/null
rc=$?
t "helper: a NUL in the payload → refused input_invalid" bash -c "[ $rc -eq 65 ] && [ ! -e '$UUD/$USTEM.service' ]"
up_reset
up "$UPT" fsync-wants
t "helper fsync-wants: trusted wants directory → synced, exit 0" bash -c "[ \"\$(cat '$UPS/rc')\" = 0 ]"
chmod 777 "$UWD"
up "$UPT" fsync-wants
chmod 755 "$UWD"
t "helper fsync-wants: a world-writable wants directory → refused" bash -c "[ \"\$(cat '$UPS/rc')\" = 65 ]"
up_reset

printf '\n%d passed, %d failed (mutations: %d killed, %d survived)\n' "$pass" "$fail" "$killed" "$survived"
[ "$MODE" = static ] && printf 'NOTE: --static-only — the accepted-delta regeneration did NOT run.\n'
[ "$fail" -eq 0 ]
