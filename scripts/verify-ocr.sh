#!/usr/bin/env bash
#
# verify-ocr.sh — Tier 0 WS0.2 local verification harness for the OCR pipeline.
#
# Runs the proving suites that guard OCR correctness, in fail-fast order:
#   0. Verification-database isolation safety suite (no DB, no Docker)
#   1. @eanhl/db unit + integration tests            [disposable clone]
#   2. @eanhl/worker integration tests               [disposable clone] —
#      QUARANTINE-AWARE: passes iff the set of failing tests is a subset of the
#      documented pre-existing live-data-drift reds in
#      docs/ocr/tier0-quarantined-worker-tests.txt. Any other failure blocks.
#   3. tools/game_ocr Python suite                   (no DB)
#   4. tools/video_ingest Python suite               [disposable clone]
#      (includes the match-250 loadout parity gate)
#   5. Screen-classifier proving bench               (no DB; needs the v2 weights)
#   With --full: additionally the heavy reprocess E2E [disposable clone].
#
# DATABASE ISOLATION (read this before changing anything below)
# -------------------------------------------------------------
# Steps 1, 2, 4 and the --full step WRITE to a database. This script therefore
# runs each of them inside apps/worker/scripts/with-test-db.mjs, which attests a
# dedicated nonproduction cluster and then hands the child a DATABASE_URL
# pointing at a freshly created, disposable clone.
#
#   * This script UNSETS DATABASE_URL for its whole run. A production DSN in the
#     caller's environment must never reach a suite, a pytest, or a worker CLI.
#   * The source DSN is TEST_DATABASE_URL and nothing else. There is no `.env`
#     fallback anywhere in this path.
#   * TEST_DB_CONTAINER / TEST_DB_COMPOSE_PROJECT / TEST_DB_COMPOSE_SERVICE are
#     mandatory and have no defaults.
#   * See apps/worker/scripts/lib/test-db-guard.mjs for the threat model, and
#     ops/README.md for the operator setup (docker-compose.test.yml +
#     ~/.config/eanhl/verify.env).
#
# This script is the developer pre-flight + nightly body. The AUTHORITATIVE,
# fail-closed enforcement is the `decoder-runs activate` quality gate (WS0.1A):
# bad runs cannot become canonical regardless of anyone's local git config. The
# pre-push hook that calls this is advisory (bypassable with --no-verify).
#
# Interpreter: the repo's `.venv-1` is the only venv known to carry pytest + the
# GPU/PyAV/onnxruntime stack (HANDOFF.md). The per-tool `.venv` dirs are not
# reliable, so all Python suites run through `.venv-1`.
#
# Usage:
#   bash scripts/verify-ocr.sh           # default (no heavy reprocess E2E)
#   bash scripts/verify-ocr.sh --full    # + reprocess E2E
#   pnpm verify:ocr                      # same as default

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    *) echo "verify-ocr: unknown arg '$arg' (expected --full)" >&2; exit 64 ;;
  esac
done

VENV_PY="$REPO_ROOT/.venv-1/bin/python"
V2_WEIGHTS="$REPO_ROOT/tools/game_ocr/game_ocr/weights/nhl26-screen-classifier-v2.json"
QUARANTINE_FILE="$REPO_ROOT/docs/ocr/tier0-quarantined-worker-tests.txt"
WITH_TEST_DB="$REPO_ROOT/apps/worker/scripts/with-test-db.mjs"

banner() { printf '\n\033[1;36m========== %s ==========\033[0m\n' "$1"; }
fail()   { printf '\n\033[1;31mverify-ocr FAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# Run a shell snippet against a freshly provisioned, attested disposable clone.
# The snippet receives DATABASE_URL pointing at that clone and nothing else.
isolated() { node "$WITH_TEST_DB" -- bash -c "$1"; }

# ── DATABASE_URL containment ─────────────────────────────────────────────────
# Drop it before anything else runs. Every DB-backed step below gets its own
# clone DSN injected by with-test-db.mjs; nothing here may inherit a production
# DSN from the caller, the pre-push hook, or a systemd EnvironmentFile.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "verify-ocr: DATABASE_URL was set in the environment; unsetting it for this run." >&2
  echo "verify-ocr: verification never writes to the application database." >&2
fi
unset DATABASE_URL

# ── prerequisites (no silent skips) ──────────────────────────────────────────
banner "prerequisites"
[ -x "$VENV_PY" ] || fail ".venv-1 interpreter not found/executable at $VENV_PY (see HANDOFF.md). Python suites cannot run."
"$VENV_PY" -c 'import pytest' 2>/dev/null || fail ".venv-1 is missing pytest. Install the Python toolchain into .venv-1."
[ -f "$V2_WEIGHTS" ] || fail "v2 screen-classifier weights missing at $V2_WEIGHTS. Train via: $VENV_PY tools/game_ocr/scripts/train_screen_classifier.py --engine viterbi_v2 (the proving bench cannot run without them)."
[ -f "$QUARANTINE_FILE" ] || fail "quarantine list missing at $QUARANTINE_FILE."
[ -f "$WITH_TEST_DB" ] || fail "isolation harness missing at $WITH_TEST_DB."

MISSING=()
for var in TEST_DATABASE_URL TEST_DB_CONTAINER TEST_DB_COMPOSE_PROJECT TEST_DB_COMPOSE_SERVICE; do
  [ -n "${!var:-}" ] || MISSING+=("$var")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  printf '  missing: %s\n' "${MISSING[@]}" >&2
  fail "verification database configuration is incomplete. These have NO defaults and are NOT read from .env — a default would point at production. Create the verification cluster and env file as described in ops/README.md, then:  set -a && . ~/.config/eanhl/verify.env && set +a"
fi
echo "ok: .venv-1, v2 weights, quarantine list, isolation harness, TEST_* configuration all present."

# ── 0. verification-database isolation safety suite ──────────────────────────
# Deterministic, hermetic (no Docker, no PostgreSQL, no secrets). It runs FIRST
# because it is what proves the isolation used by every step after it.
banner "0/5 verification-database isolation safety suite"
node --test \
  "$REPO_ROOT/apps/worker/scripts/lib/test-db-guard.test.mjs" \
  "$REPO_ROOT/apps/worker/scripts/lib/test-db-session.test.mjs" \
  "$REPO_ROOT/apps/worker/scripts/lib/verify-ocr-orchestration.test.mjs" \
  || fail "verification-database isolation safety suite failed — refusing to run any DB-backed step."

# ── 1. db unit + integration tests (isolated clone) ──────────────────────────
banner "1/5 @eanhl/db tests (disposable clone)"
isolated 'pnpm --filter @eanhl/db test' || fail "@eanhl/db tests failed."

# ── 2. worker integration tests (quarantine-aware; clones internally) ────────
banner "2/5 @eanhl/worker integration tests (disposable clone; quarantine-aware)"
WORKER_OUT="$(mktemp)"
trap 'rm -f "$WORKER_OUT"' EXIT
pnpm --filter @eanhl/worker test >"$WORKER_OUT" 2>&1
WORKER_EXIT=$?
# Echo the suite tail for visibility regardless of outcome.
tail -n 12 "$WORKER_OUT"
if [ "$WORKER_EXIT" -eq 0 ]; then
  echo "Worker suite fully green."
else
  # A refusal by the isolation guard is NOT a quarantinable test failure.
  if grep -q '\[with-test-db\] REFUSED' "$WORKER_OUT"; then
    grep '\[with-test-db\] REFUSED' "$WORKER_OUT" >&2
    fail "@eanhl/worker suite never ran: the verification-database guard refused the configured target."
  fi
  # Extract failing SUBTEST names (drop the file-level aggregate 'not ok … *.js' lines).
  mapfile -t FAILED < <(grep -E '^not ok [0-9]+ - ' "$WORKER_OUT" | sed -E 's/^not ok [0-9]+ - //' | grep -vE '\.js$' || true)
  if [ "${#FAILED[@]}" -eq 0 ]; then
    fail "@eanhl/worker exited $WORKER_EXIT without reporting any failing test — treat as a harness failure, not a quarantined red."
  fi
  # Quarantine list with comments/blank lines stripped.
  QUARANTINE="$(grep -vE '^[[:space:]]*(#|$)' "$QUARANTINE_FILE")"
  UNEXPECTED=()
  for name in "${FAILED[@]}"; do
    if ! grep -Fxq "$name" <<<"$QUARANTINE"; then
      UNEXPECTED+=("$name")
    fi
  done
  if [ "${#UNEXPECTED[@]}" -gt 0 ]; then
    printf '  unexpected (non-quarantined) failure: %s\n' "${UNEXPECTED[@]}" >&2
    fail "@eanhl/worker has ${#UNEXPECTED[@]} NON-quarantined test failure(s) — a real regression."
  fi
  echo "Worker suite: ${#FAILED[@]} failing test(s), ALL quarantined (Tier 1 backlog, see $QUARANTINE_FILE). OK."
fi

# ── 3. game_ocr Python suite (no DB) ─────────────────────────────────────────
banner "3/5 tools/game_ocr pytest"
( cd tools/game_ocr && PYTHONPATH=.:../video_ingest "$VENV_PY" -m pytest tests/ -q ) \
  || fail "tools/game_ocr pytest failed."

# ── 4. video_ingest Python suite (isolated clone) ────────────────────────────
banner "4/5 tools/video_ingest pytest (RUN_REPROCESS_INTEGRATION; disposable clone)"
isolated "cd tools/video_ingest && RUN_REPROCESS_INTEGRATION=1 PYTHONPATH=.:../game_ocr '$VENV_PY' -m pytest tests/ -q" \
  || fail "tools/video_ingest pytest failed."

# ── 5. screen-classifier proving bench (no DB) ───────────────────────────────
banner "5/5 screen-classifier proving bench (RUN_CLASSIFIER_E2E=1)"
( cd tools/video_ingest && RUN_CLASSIFIER_E2E=1 PYTHONPATH=.:../game_ocr "$VENV_PY" -m pytest tests/test_screen_classifier_proving_bench.py -q ) \
  || fail "proving bench failed (≥90%/clip not met, or v2 weights/PYTHONPATH problem)."

# ── optional: heavy reprocess E2E (isolated clone) ───────────────────────────
if [ "$FULL" -eq 1 ]; then
  banner "FULL: reprocess E2E (RUN_REPROCESS_E2E=1; ~1h decode-bound, DB writes to a disposable clone)"
  # -s (no capture): the reprocess command runs IN-PROCESS under CliRunner, so
  # its per-step JSON payloads reach the terminal only when pytest is not
  # capturing. Without this a passing run prints nothing but the ingest stream.
  isolated "cd tools/video_ingest && RUN_REPROCESS_E2E=1 RUN_REPROCESS_INTEGRATION=1 PYTHONPATH=.:../game_ocr '$VENV_PY' -m pytest tests/test_reprocess_cli.py -q -s" \
    || fail "reprocess E2E failed."
fi

printf '\n\033[1;32m✓ verify-ocr PASSED%s\033[0m\n' "$([ "$FULL" -eq 1 ] && echo ' (full)')"
