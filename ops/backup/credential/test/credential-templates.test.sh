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
UNIT_SRC=$V/eanhl-cloud-credential-provider-probe@.service
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

# Units: local transient props vs the provider template.
base_props=$(sed -n '/^readonly BASE_PROPS=(/,/^)/p' "$LAUNCHER_SRC")
local_props=$(sed -n '/^readonly LOCAL_PROPS=(/,/^)/p' "$LAUNCHER_SRC")
t "LOCAL_PROPS has PrivateNetwork=yes" grep -q -F -- '--property=PrivateNetwork=yes' <<<"$local_props"
t "BASE/LOCAL props have no network-online" bash -c "! grep -q network-online <<<\"\$1\"" _ "$base_props$local_props"
t "NETWORK_PROPS used exactly twice (auth-login, auth-logout)" test "$(grep -c -F '"${NETWORK_PROPS[@]}"' "$LAUNCHER_SRC")" -eq 2
t "NETWORK_PROPS only inside cmd_auth_login/cmd_auth_logout" bash -c "
  awk '/^cmd_auth_login\\(\\) \\{/,/^}/' '$LAUNCHER_SRC' | grep -q -F '\"\${NETWORK_PROPS[@]}\"' &&
  awk '/^cmd_auth_logout\\(\\) \\{/,/^}/' '$LAUNCHER_SRC' | grep -q -F '\"\${NETWORK_PROPS[@]}\"'"
t "no StateDirectory/CacheDirectory in launcher code or unit" bash -c "! grep -h -v '^ *#' '$LAUNCHER_SRC' '$UNIT_SRC' | grep -q -E 'StateDirectory|CacheDirectory'"
t "provider unit: ExecStart passes provider:%i" grep -q -x 'ExecStart=/usr/local/lib/eanhl-cloud/credential-exec --nonblock probe provider:%i' "$UNIT_SRC"
t "provider unit: After= and Wants=network-online.target" bash -c "grep -q -x 'After=network-online.target' '$UNIT_SRC' && grep -q -x 'Wants=network-online.target' '$UNIT_SRC'"
t "provider unit: WorkingDirectory, no Environment=, no [Install]" bash -c "
  grep -q -x 'WorkingDirectory=/var/lib/eanhl-cloud' '$UNIT_SRC' &&
  ! grep -q -E '^(Environment|EnvironmentFile)=' '$UNIT_SRC' && ! grep -q -x -F '[Install]' '$UNIT_SRC'"
t "no local probe unit template remains" test ! -e "$V/eanhl-cloud-credential-probe@.service"
probe_modes=$(sed -n '/^readonly PROBE_MODES=(/,/^)/p' "$LAUNCHER_SRC")
t "launcher PROBE_MODES has no provider mode or canary-nested" bash -c "! grep -q -E 'provider|neg-nokey|neg-nostore|canary-nested' <<<\"\$1\"" _ "$probe_modes"
t "launcher bound runner always passes local:<mode>" grep -q -F 'bound_start "probe-$mode" none --nonblock probe "local:$mode"' "$LAUNCHER_SRC"
t "RESIDENT_AGENT_RULES is empty in the template (fail closed until M8/L2)" grep -q -x 'readonly RESIDENT_AGENT_RULES=()' "$LAUNCHER_SRC"
t "preflight and agent rule never name cmdline/environ" bash -c "! awk '/^(preflight_auth_login|agent_rule_holds)\\(\\) \\{/,/^}/' '$LAUNCHER_SRC' | grep -q -E 'cmdline|environ'"
t "provider unit carries no raw journalctl recipe" bash -c "! grep -q -E 'journalctl|-o cat' '$UNIT_SRC'"
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
# Per-unit state: $st/u/<unit> exists once systemd-run started it;
# $st/u/<unit>.stopped after a successful stop. Overrides: loadstate (any
# unit), stop_rc, reset_rc, gc_on_stop (unit unloaded once stopped).
st=$STUB_STATE
echo "systemctl $*" >>"$st/calls"
mkdir -p "$st/u"
case "$1" in
  show)
    unit=$6
    case "$3" in
      LoadState)
        if [ -e "$st/loadstate" ]; then cat "$st/loadstate"
        elif [ -e "$st/u/$unit.stopped" ] && [ -e "$st/gc_on_stop" ]; then echo not-found
        elif [ -e "$st/u/$unit" ]; then echo loaded
        else echo not-found; fi ;;
      InvocationID)
        if [ -e "$st/waited" ] && [ -e "$st/invid_after" ]; then cat "$st/invid_after"; else cat "$st/invid" 2>/dev/null; fi ;;
      ActiveState)
        touch "$st/waited"
        if [ -e "$st/u/$unit.stopped" ]; then echo inactive; else cat "$st/active" 2>/dev/null || echo active; fi ;;
      SubState) cat "$st/sub" 2>/dev/null || echo exited ;;
      ExecMainStatus) cat "$st/status" 2>/dev/null || echo 0 ;;
    esac ;;
  list-units)
    cat "$st/units" 2>/dev/null
    exit "$(cat "$st/units_rc" 2>/dev/null || echo 0)" ;;
  stop)
    rc=$(cat "$st/stop_rc" 2>/dev/null || echo 0)
    [ "$rc" = 0 ] && touch "$st/u/$3.stopped"
    exit "$rc" ;;
  reset-failed)
    exit "$(cat "$st/reset_rc" 2>/dev/null || echo 0)" ;;
esac
exit 0
EOF
cat >"$SB/stub/systemd-run" <<'EOF'
#!/usr/bin/bash
# Records the unit; simulates the key/store effects of the few commands the
# launcher runs, driven by files in $STUB_STATE; $STUB_STORE is the sandbox store.
st=$STUB_STATE
echo "systemd-run $*" >>"$st/run_calls"
mkdir -p "$st/u"
for a in "$@"; do
  case "$a" in
    --unit=*) touch "$st/u/${a#--unit=}.service" ;;
    --setenv=E3J9_PTY_NONCE=* | --setenv=E3J9_INJECTED=*) printf '%s\n' "${a#--setenv=*=}" >"$st/nonce" ;;
  esac
done
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
chmod +x "$SB/stub/"*
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
export STUB_STORE=$SB/home/password-store
libify() { sed '/^case "\${1-}" in$/,$d' "$1" >"$2"; }
LLIB=$W/launcher-lib
libify "$L" "$LLIB"
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

printf '\n%d passed, %d failed (mutations: %d killed, %d survived)\n' "$pass" "$fail" "$killed" "$survived"
[ "$MODE" = static ] && printf 'NOTE: --static-only — the accepted-delta regeneration did NOT run.\n'
[ "$fail" -eq 0 ]
