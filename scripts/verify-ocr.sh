#!/usr/bin/env bash
#
# verify-ocr.sh — Tier 0 WS0.2 local verification harness for the OCR pipeline.
#
# Runs the proving suites that guard OCR correctness, in fail-fast order:
#   1. @eanhl/db unit tests
#   2. @eanhl/worker integration tests (cloned local DB) — QUARANTINE-AWARE:
#      passes iff the set of failing tests is a subset of the documented
#      pre-existing live-data-drift reds in
#      docs/ocr/tier0-quarantined-worker-tests.txt. Any other failure blocks.
#   3. tools/game_ocr Python suite
#   4. tools/video_ingest Python suite (includes the match-250 loadout parity gate)
#   5. Screen-classifier proving bench (RUN_CLASSIFIER_E2E=1; needs the v2 weights)
#   With --full: additionally the heavy reprocess E2E (RUN_REPROCESS_E2E=1, 3-5 min, DB writes).
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

banner() { printf '\n\033[1;36m========== %s ==========\033[0m\n' "$1"; }
fail()   { printf '\n\033[1;31mverify-ocr FAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# ── prerequisites (no silent skips) ──────────────────────────────────────────
banner "prerequisites"
[ -x "$VENV_PY" ] || fail ".venv-1 interpreter not found/executable at $VENV_PY (see HANDOFF.md). Python suites cannot run."
"$VENV_PY" -c 'import pytest' 2>/dev/null || fail ".venv-1 is missing pytest. Install the Python toolchain into .venv-1."
[ -f "$V2_WEIGHTS" ] || fail "v2 screen-classifier weights missing at $V2_WEIGHTS. Train via: $VENV_PY tools/game_ocr/scripts/train_screen_classifier.py --engine viterbi_v2 (the proving bench cannot run without them)."
[ -f "$QUARANTINE_FILE" ] || fail "quarantine list missing at $QUARANTINE_FILE."
if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is unset. Load it first:  set -a && source .env && set +a"
fi
echo "ok: .venv-1, v2 weights, quarantine list, DATABASE_URL all present."

# ── 1. db unit tests ─────────────────────────────────────────────────────────
banner "1/5 @eanhl/db tests"
pnpm --filter @eanhl/db test || fail "@eanhl/db tests failed."

# ── 2. worker integration tests (quarantine-aware) ───────────────────────────
banner "2/5 @eanhl/worker integration tests (cloned DB; quarantine-aware)"
WORKER_OUT="$(mktemp)"
trap 'rm -f "$WORKER_OUT"' EXIT
pnpm --filter @eanhl/worker test >"$WORKER_OUT" 2>&1
WORKER_EXIT=$?
# Echo the suite tail for visibility regardless of outcome.
tail -n 12 "$WORKER_OUT"
if [ "$WORKER_EXIT" -eq 0 ]; then
  echo "Worker suite fully green."
else
  # Extract failing SUBTEST names (drop the file-level aggregate 'not ok … *.js' lines).
  mapfile -t FAILED < <(grep -E '^not ok [0-9]+ - ' "$WORKER_OUT" | sed -E 's/^not ok [0-9]+ - //' | grep -vE '\.js$' || true)
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

# ── 3. game_ocr Python suite ─────────────────────────────────────────────────
banner "3/5 tools/game_ocr pytest"
( cd tools/game_ocr && PYTHONPATH=.:../video_ingest "$VENV_PY" -m pytest tests/ -q ) \
  || fail "tools/game_ocr pytest failed."

# ── 4. video_ingest Python suite (incl. match-250 loadout parity) ────────────
banner "4/5 tools/video_ingest pytest (RUN_REPROCESS_INTEGRATION read-only smoke)"
( cd tools/video_ingest && RUN_REPROCESS_INTEGRATION=1 PYTHONPATH=.:../game_ocr "$VENV_PY" -m pytest tests/ -q ) \
  || fail "tools/video_ingest pytest failed."

# ── 5. screen-classifier proving bench ───────────────────────────────────────
banner "5/5 screen-classifier proving bench (RUN_CLASSIFIER_E2E=1)"
( cd tools/video_ingest && RUN_CLASSIFIER_E2E=1 PYTHONPATH=.:../game_ocr "$VENV_PY" -m pytest tests/test_screen_classifier_proving_bench.py -q ) \
  || fail "proving bench failed (≥90%/clip not met, or v2 weights/PYTHONPATH problem)."

# ── optional: heavy reprocess E2E ────────────────────────────────────────────
if [ "$FULL" -eq 1 ]; then
  banner "FULL: reprocess E2E (RUN_REPROCESS_E2E=1; 3-5 min, DB writes)"
  ( cd tools/video_ingest && RUN_REPROCESS_E2E=1 RUN_REPROCESS_INTEGRATION=1 PYTHONPATH=.:../game_ocr "$VENV_PY" -m pytest tests/test_reprocess_cli.py -q ) \
    || fail "reprocess E2E failed."
fi

printf '\n\033[1;32m✓ verify-ocr PASSED%s\033[0m\n' "$([ "$FULL" -eq 1 ] && echo ' (full)')"
