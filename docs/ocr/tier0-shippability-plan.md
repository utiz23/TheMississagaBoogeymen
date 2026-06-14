# Tier 0 — Make OCR Extraction Shippable (Provable Correctness)

## Context

Two independent reviews (`docs/ocr/extraction-system-independent-review-2026-06-13.md`) established that the OCR
extraction system produces real data across 4 matches (250, 463, 968, 2582) but is **not shippable as canonical**
because nothing enforces or proves correctness:

- **No active decoder run passes its quality gate.** `overall_pass` is the conjunction of L2/L2.5/L3 layer passes,
  each requiring `>= 0.99` (`apps/worker/src/lib/quality-layers.ts:22-24,178`). That bar is unrealistic for OCR, so
  every run is red. Worse, `activate` (`apps/worker/src/decoder-runs-cli.ts:147-227`) checks neither the quality
  layers nor the structural validator, so "activated" and "passing" are fully decoupled.
- **No CI exists at all.** No `.github/workflows`, no test pipeline in `turbo.json`. The proving bench and reprocess
  E2E only run when a human sets `RUN_CLASSIFIER_E2E=1` / `RUN_REPROCESS_INTEGRATION=1`.
- **The match-250 loadout parity test is red — but it's fixture drift, not a regression.** The extractor correctly
  emits 9 subjects (the 9 in the segment); the committed golden is stale (25 subjects, `loadout-evidence-v2`, missing
  the `is_cpu` records added in `a417ef5`; current extractor stamps `v3`).

**Goal:** turn "operational, all gates red" into "operational and verified" — an enforced, green, *honest* quality
gate so Tier 1/2 work can be measured against a real baseline.

**Decisions (user):** (1) enforcement = local verify script + git hook (no cloud CI); (2) pass bar = wire the gate
into `activate` AND recalibrate `overall_pass`.

### Two findings from review that reshape the design (verified against code)

1. **`validateCandidateRun` is NOT the quality gate.** It only checks promotion floors + fatal extractor errors
   (`validate-candidate-run.ts:208-223`); it never computes L2/L2.5/L3 or reads `ocr_run_quality_reports`. So the real
   quality gate is `overall_pass` from `computeLayers`, and *that* is what must block activation — `validate` is a
   cheap structural pre-check, not the gate.
2. **`overall_pass` is a post-activation measurement by construction.** `computeLayers` reads the *canonical* tables
   (`match_events`, `player_loadout_snapshots`), which are only populated for a run after `activate` rebuilds them
   (`rebuildCanonicalsFromActiveRun`). You cannot score a candidate before activating it. Therefore the gate must be
   **activate → rebuild → compute overall_pass → commit if pass / roll back if fail**, all inside one transaction —
   not a pre-activation check.

---

## Workstream 0.3 — Fix the loadout parity test (do FIRST; cheapest, gets the suite green)

Stale golden, not broken code. Sequence first so suites are green before the verify script is wired.

1. **Confirm the extractor output is genuinely correct before regenerating.** Run the extractor against the fixture
   frames and check the 9 emitted subjects against the match-250 V2 benchmark
   (`research/OCR-SS/Manual OCR benchmark for verification V2.md`) — gamertags, jersey numbers, positions. Do not
   regenerate a golden from unverified output.
2. **Regenerate the golden** via the recipe in
   `tools/game_ocr/calibration/extras/loadout/fixtures/fixture_match250_full_lobby/PROVENANCE.md:154-178` (new file
   carries `loadout-evidence-v3` + `is_cpu` records).
3. **Fix PROVENANCE.md counts** (currently claims "602 records across 9 subjects" while the stale JSON had 25).
4. **Resolve the second red test.** A full-suite run reported
   `test_loadout_closed_vocab.py::test_predict_log_probs_raises_not_implemented` failing (stub now implemented), while
   `test_closed_vocab_lr_head.py::...when_no_weights` reads as still-valid — **different files**. Run both, confirm
   which is red, delete/update the stale stub assertion; do not touch the valid `when_no_weights` test.

Files: `tools/game_ocr/tests/test_loadout_evidence_fixture_parity.py`,
`.../fixture_match250_full_lobby/{expected_loadout_evidence.json,PROVENANCE.md}`,
`tools/game_ocr/tests/test_loadout_closed_vocab.py`.

Verify: `(cd tools/game_ocr && PYTHONPATH=.:../video_ingest ../../.venv-1/bin/python -m pytest tests/test_loadout_evidence_fixture_parity.py tests/test_loadout_closed_vocab.py tests/test_closed_vocab_lr_head.py -v)` → all green.

---

## Workstream 0.1 — Make the quality gate real (overall_pass blocks activate + recalibrate)

### Part A — Gate `activate` on `overall_pass` (the real gate), with `validate` as a cheap pre-check

Because `overall_pass` can only be computed *after* the canonical rebuild, restructure `activate`
(`apps/worker/src/decoder-runs-cli.ts:147-227`) so the whole thing is one atomic, fail-closed transaction:

1. **Cheap structural pre-check (outside the tx):** call `validateCandidateRun(runId)` (reuse
   `validate-candidate-run.ts:134`). If `!ok` → print `failureReasons`, `exit(2)`. Catches empty/error runs before
   touching canonicals.
2. **Inside the existing activation transaction** (the one that flips `is_active` + `rebuildCanonicalsFromActiveRun`,
   ~lines 197-211): after the flip + rebuild, compute the quality layers for the match using the **same** code path
   that emits the report — reuse `run-quality-cli.ts` `buildReportBody` / the `quality-inputs.ts` builders
   (`buildDownstreamCounts`, `buildQualityFlags`) + `computeLayers` — so the gate and the emitted report can never
   drift. This needs `buildReportBody` / `computeLayers` / the builders to accept the transaction handle `tx`
   (currently they use the module-level `db` import; add an optional `db` param exactly like `validateCandidateRun`
   already does). **Pass the post-flip run state (`isActive: true`) into `buildReportBody`** — otherwise it takes the
   `!run.isActive` branch and returns a not-computed NULL row (`run-quality-cli.ts:500-502`), which would make the
   gate roll back *every* activation.
3. **Fail CLOSED — require an affirmative pass, not merely `!== false`.** `buildReportBody` is fail-soft: `safeCall`
   swallows substep exceptions into `errors[]`, and a match-not-found / `computeLayers` failure degrades to
   `computed: false` with `overall_pass: null` (NOT `false`) (`run-quality-cli.ts:440-450,504-566`). A naive
   `overall.pass === false` check would let a *scoring failure* activate. The gate must therefore throw (→ roll back
   activation + rebuild, leaving the prior active run intact) and `exit(2)` unless **all** of:
   `serializedLayers.computed === true` **AND** `body.errors.length === 0` **AND** `overall_pass === true`. Anything
   else (any error, not-computed, or null/false pass) is a gate failure. Only a positive, error-free pass commits +
   emits the report row.
4. **`--force --reason "<text>"` escape hatch:** bypasses *both* checks, commits, and **persists the override** (see
   Open-Q1 answer below) plus a loud stderr warning. This keeps deliberate decoupling possible (backfills) but never
   silent.
5. Confirm no current caller depends on activating a failing run; route any such backfill path through `--force`.
   `reprocess.py` already calls `validate` then `activate`, so its `activate` now additionally enforces quality —
   defense in depth, no contract break (still `exit 2` on failure, which `reprocess.py:406-421` already handles).

### Part B — Recalibrate thresholds from measured data (method, not pinned guesses)

The 0.99 bars are why everything is red. **Do not pin numbers that contradict the data** (the prior draft proposed
L2 ≥ 0.90 while 250's L2 is 0.85 — that fails 250 by construction). Instead:

1. **Measure first:** `pnpm --filter worker run-quality --run-id N --json` for the 4 active runs; tabulate
   l2 / l2_lineup / l3.
2. **Pick the reference run(s)** that are *independently trustworthy* — match 250 is verified against the V2
   benchmark, so it is the canonical "must pass." Set each layer threshold **at or just below the reference run's
   actual score**, and confirm known-bad runs (esp. 2582, 13 unresolved) still fail at least one layer.
3. **Add a distinct `L2_LINEUP_THRESHOLD` constant** — `l2_lineup.pass` currently reuses `L2_THRESHOLD`
   (`quality-layers.ts:134`); the two dimensions need independent bars.
4. **Illustrative, internally-consistent set** (final numbers come from step 1; none may exceed 250's actuals):
   `L2_THRESHOLD ≈ 0.85`, `L2_LINEUP_THRESHOLD ≈ 0.90`, `L3_THRESHOLD ≈ 0.95`. Against the cited scores this makes
   **250 pass** (0.85/0.95/1.00) and **463/968/2582 fail** on at least one layer — i.e. one honest green baseline,
   not everything painted green. Document the chosen numbers + rationale inline next to the constants.
5. Leave `L1_THRESHOLD` as-is; L1 is permanently null until labeled fixtures exist and `overall.pass` already treats
   null L1 as `true` (`quality-layers.ts:71-75,178`).
6. **Re-emit** reports: `pnpm --filter worker run-quality --run-id N --emit-row` for all active runs so
   `ocr_run_quality_reports.overall_pass` reflects the new bar.

Files: `apps/worker/src/lib/quality-layers.ts` (thresholds, new L2_lineup constant, `tx` param),
`apps/worker/src/lib/quality-inputs.ts` (accept `tx`), `apps/worker/src/run-quality-cli.ts` (reuse `buildReportBody`
from activate; accept `tx`), `apps/worker/src/decoder-runs-cli.ts` (activate gate + `--force --reason`),
`apps/worker/src/lib/validate-candidate-run.ts` (reuse only).

Verify:
- `pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && pnpm --filter @eanhl/worker test`
- `decoder-runs activate --run-id <known-failing>` → rolls back, exits 2; with `--force --reason x` → activates,
  warns, persists override.
- After recalibration + re-emit: match 250 `overall_pass = true`, 2582 still `false`.

---

## Workstream 0.2 — Local verify script + git hook (enforce the gates)

Be precise about what "enforced" means: the **authoritative, fail-closed gate is the `activate` quality check from
0.1** — bad runs cannot become canonical regardless of anyone's local git config. The verify script + pre-push hook
are a **best-effort developer pre-flight** (git hooks are bypassable with `--no-verify` and are local-only); the
**nightly is the catch-all** that exercises the heavy end-to-end path. The milestone's "now enforced" claim rests on
the activate gate, not the hook.

1. **Prerequisite — the v2 classifier weights.** The proving bench needs
   `tools/game_ocr/game_ocr/weights/nhl26-screen-classifier-v2.json`, which is **not committed** (bench skips without
   it). Decide and record in the script header: **commit the trained weights** (preferred — clips/labels are already
   committed) *or* document `tools/game_ocr/scripts/train_screen_classifier.py --engine viterbi_v2` as a verify
   prerequisite. (Open item flagged for the user, see below.)
2. **`scripts/verify-ocr.sh`** (new), fail-fast, clear stage banners, **using the interpreter the repo documents as
   runnable — `.venv-1` for all Python suites** per `HANDOFF.md:183` (only `.venv-1` is known to have pytest + the
   GPU/PyAV/onnxruntime stack; the per-tool `.venv` dirs are not reliable):
   1. `pnpm --filter @eanhl/db test`
   2. `pnpm --filter @eanhl/worker test` (clones local DB via `apps/worker/scripts/with-test-db.mjs`)
   3. `(cd tools/game_ocr && PYTHONPATH=.:../video_ingest ../../.venv-1/bin/python -m pytest tests/)`
   4. `(cd tools/video_ingest && PYTHONPATH=.:../game_ocr ../../.venv-1/bin/python -m pytest tests/)`
   5. proving bench: `RUN_CLASSIFIER_E2E=1 ... ../../.venv-1/bin/python -m pytest tests/test_screen_classifier_proving_bench.py`
      (the bench imports both modules + loads v2 weights from the shared repo path,
      `test_screen_classifier_proving_bench.py:110` — PYTHONPATH must include both, weights must exist).
   - `--full` flag additionally runs `RUN_REPROCESS_E2E=1` (3–5 min, DB writes). Default run includes
     `RUN_REPROCESS_INTEGRATION=1` (read-only smoke). Script self-checks `.venv-1` + weights exist and fails with a
     clear message if not (no silent skip — a skipped bench is not a pass).
3. **Root `package.json`:** add `verify:ocr` → `bash scripts/verify-ocr.sh` (discoverable alongside `test:db-importers`).
4. **Hook bootstrap that installs itself (Open-Q / Finding 4 fix).** `core.hooksPath` is local config and cannot be
   committed, so add a committed `.githooks/pre-push` (runs `scripts/verify-ocr.sh`, bypassable via `--no-verify`)
   **plus a `prepare` script in root `package.json`** (`git config core.hooksPath .githooks`) that runs
   automatically on `pnpm install`. That makes the hook self-installing for anyone who sets the repo up the normal
   way, rather than relying on each teammate to opt in manually. Document in README/HANDOFF that the hook is advisory
   and the activate gate is the real enforcement.
5. **Nightly as an in-repo, reproducible artifact (Open-Q2 fix).** Commit the unit files under `ops/`
   (`ops/eanhl-verify.service` + `ops/eanhl-verify.timer`, running `scripts/verify-ocr.sh --full`) with a one-line
   documented install (`systemctl --user enable --now ...`) and a cron fallback snippet. The deliverable lives in the
   repo; only the `systemctl enable` is machine-local.

Files: `scripts/verify-ocr.sh` (new), `package.json` (root: `verify:ocr` + `prepare`), `.githooks/pre-push` (new),
`ops/eanhl-verify.{service,timer}` (new), `HANDOFF.md`/`README` (document hooksPath + venv + weights + nightly install).

Verify: `bash scripts/verify-ocr.sh` exits 0 on a clean tree (after 0.3 + 0.1); a deliberately broken test blocks
`git push` (and `--no-verify` bypasses); `bash scripts/verify-ocr.sh --full` runs the reprocess E2E and exits 0.

---

## Resolved review open questions

- **`--force` override persistence:** no schema migration in Tier 0. Require `--force --reason "<text>"`; persist
  `{ overridden: true, reason, at }` into the **existing `ocr_run_quality_reports.report` jsonb** (NOT NULL jsonb,
  `ocr-run-quality-reports.ts`) for that run, and emit a loud stderr warning. Audit trail without new DDL. (If a
  first-class column is wanted later, that's a Tier 1 schema-change item.)
- **Nightly installation artifact:** committed under `ops/` (see 0.2 step 5) — a reproducible project deliverable,
  not ad-hoc machine-local ops. Installation is one documented `systemctl --user enable --now eanhl-verify.timer`.

## Open item needing a user call during execution

- **Commit the trained v2 weights vs document the train step** (0.2 step 1). Committing makes the bench
  runnable on a fresh checkout (fixtures already are); documenting keeps the repo lighter but makes the gate
  conditional on a local train. Will confirm before doing it.

---

## Execution order & milestone

1. **0.3** — regenerate golden + fix stale stub → suites green.
2. **0.1** — overall_pass blocks activate (atomic activate→rebuild→score→rollback) + recalibrate from measured data
   + re-emit → "passing" becomes meaningful and honest.
3. **0.2** — weights + `verify-ocr.sh` + self-installing pre-push hook + in-repo nightly → enforced.

Ship Tier 0 as **one milestone** ("Trustworthy"). After it: bad runs cannot become canonical (activate gate), match
250 passes an honest bar, the suite is green and runnable via one command, and Action Tracker data can be treated as
canonical. Only then start Tier 1, each change validated against the now-green bench.

## End-to-end verification of the milestone

1. `bash scripts/verify-ocr.sh` → green (db, worker integration, both Python suites, proving bench ≥90%/clip).
2. `decoder-runs activate` on a failing run **rolls back** and exits 2; `--force --reason x` activates, warns, and
   persists the override into the report jsonb. Also assert fail-closed on the soft path: a run whose layer compute
   errors (`computed: false` / non-empty `errors[]` / `overall_pass: null`) is **rolled back too**, not activated.
3. `ocr_run_quality_reports`: match 250 `overall_pass = true`, 2582 still `false` — an honest gate.
4. `git push` blocked by the self-installed pre-push hook when verify fails.
5. Loadout parity + closed-vocab tests green; golden + PROVENANCE counts match regenerated reality.
