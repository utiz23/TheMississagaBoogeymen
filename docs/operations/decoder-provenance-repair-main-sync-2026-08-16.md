# Decoder-provenance repair and `main`→`origin/main` sync (2026-08-16)

## Summary

Two sessions on 2026-08-16, in order:

1. **Repair session** — performed the production database write. Fixed 38
   `ocr_decoder_runs` rows whose `decoder_version` had gone stale after the
   Stage-B rescue attached `rescue-b2-anchor-v1` segments to them without
   refreshing the parent run's provenance. This session executed a real,
   authorized `UPDATE` against the live database inside one explicit
   transaction and issued `COMMIT`.
2. **Push session** — used the repaired state to clear the pre-push
   `verify-ocr` hook and fast-forward `origin/main` to the local `main` tip.
   This session performed **no manually invoked write against the
   production `eanhl` database**. Its explicit production smoke queries
   (checks against `ocr_decoder_runs`) were read-only. The `verify-ocr`
   hook's worker integration tests provisioned disposable `eanhl_test_*`
   clones (via `with-test-db.mjs`) and performed their normal expected
   test-fixture writes there before each clone was dropped — those are
   real database writes, but against throwaway clones, never against
   production. The push session did not invoke migration, repair,
   rollback, rescue, promotion, ingestion, or reprocessing against
   production. Normal, independently scheduled worker polling activity, if
   any occurred concurrently with this session, is not being claimed as
   absent — it was not checked for and is out of scope here.

Terminology note: the repair session's `COMMIT` refers to a **PostgreSQL
transaction commit**, not a Git commit. No Git commit was created by the
repair itself; the 81 commits that were pushed already existed on `main`
before the repair ran, going back to the 2026-08-09 `540777a` period-family
work and earlier. The repair only unblocked the pre-existing pre-push test
gate.

## Initial push attempt — blocked

```
git push origin main:main
```

- Pushed **zero commits**. `origin/main` remained unchanged.
- Pre-push hook (`verify-ocr`) ran and stopped at stage 2/5:
  - `@eanhl/db`: 39/39 passed
  - `worker`: 616 passed, 4 skipped, **1 failed**
  - Failing test: `backfill decoder provenance: single-decoder matches keep
    value; multi-decoder gets legacy-mixed`
- No force push, no `--no-verify` was used to get around this. The gate did
  its job.

## Root cause

- The Stage-B rescue (see the 2026-08-15 "RECONCILED" `HANDOFF.md` entry)
  attached 76 `rescue-b2-anchor-v1` segments to 38 pre-existing synthetic
  `ocr_decoder_runs`.
- Each of those 38 parent runs still recorded a single-decoder
  `decoder_version = 'legacy-passthrough-v0-video'`, even though each one
  now genuinely owned segments from **two** decoders:
  `legacy-passthrough-v0-video` (the original synthetic backfill) and
  `rescue-b2-anchor-v1` (the rescue attachment).
- No source path refreshed the parent run's `decoder_version` (or its
  `notes` decoder disclosure) after a rescue attachment. This is a real gap,
  not a test-authoring error — see Follow-up below.
- The failing worker test was correct: it asserts that a run with segments
  from more than one decoder must read `legacy-mixed`, and 38 runs did not.
- **`ocr_segments.decoder_version` was never wrong and was not touched by
  the repair.** All 76 rescue segment rows already correctly carried
  `decoder_version='rescue-b2-anchor-v1'`; the defect was confined to the
  38 parent `ocr_decoder_runs` rows.

## Authorized repair

Exactly 38 `ocr_decoder_runs` rows were updated, in one explicit transaction,
with an issued `COMMIT` (no rollback needed):

- `decoder_version`: `legacy-passthrough-v0-video` → `legacy-mixed`
- `notes`: only the decoder disclosure segment was expanded, to
  `decoders=[legacy-passthrough-v0-video,rescue-b2-anchor-v1]`. All other
  note text was preserved verbatim.
- No other column on these 38 rows changed.
- No row in any other table changed — not `ocr_segments`, not
  `ocr_capture_batches`, not `ocr_extractions`, not promotion tables, not
  `ocr_run_quality_reports`, not `matches`, not the migration ledger, and no
  other `ocr_decoder_runs` row outside the 38.
- `ocr_run_quality_reports` has **zero** rows for any of the 38 repaired
  runs, so no stored quality-report JSON retained the stale
  `legacy-passthrough-v0-video` label for these runs.

### Repaired run IDs (38 total)

```
2063, 2066, 2069, 2070, 2071, 2076, 2078, 2084, 2086, 2088,
2089, 2091, 2093, 2095, 2098, 2099, 2101, 2103, 2104, 2107,
2108, 2110, 2114, 2116, 2117, 2118, 2119, 2122, 2125, 2127,
2128, 2131, 2132, 2133, 2137, 2138, 2139, 2140
```

### Database counts before/after

| decoder_version | before | after |
| --- | --: | --: |
| `legacy-mixed` | 2 | 40 |
| `legacy-passthrough-v0-video` | 97 | 59 |

Remaining rescue-related mismatches after the repair: **0**.

### Canonical repair artifacts

| artifact | path | SHA-256 |
| --- | --- | --- |
| backup (pre-repair snapshot) | `/tmp/ocr_decoder_runs_provenance_backup_20260816T181915Z.csv` | `05c60eee7023730d977245ee7fe7f106c1912e026ac3f0f35ef7802f6b2881fb` |
| repair (executed) | `/tmp/ocr_decoder_runs_provenance_repair_20260816T181915Z.sql` | `d66e460aae04d34ce39c0b16edba94d1eb6f11708d7b97bd2960b1d4a6349e16` |
| rollback (prepared, **not executed**) | `/tmp/ocr_decoder_runs_provenance_rollback_20260816T181915Z.sql` | `3b3f139154d327012ca15c03800e5cf5394562fc0d2f6f8645c4d65205cc221d` |

All three hashes were independently reconfirmed against the files on disk
during this documentation session (`sha256sum`).

**Stale concurrent artifact disclosure:** a separate, stale concurrent
session created a different set of artifacts stamped `181818Z` (one minute
off from the canonical `181915Z` set above). Those `181818Z` files were
never executed and are **not authoritative** — they were not visible on
disk at the time of this documentation session's `/tmp` check, and the
canonical `181915Z` artifact set above is the one whose hashes match the
live database state.

## Successful retry — push succeeded

```
git push origin main:main
```

Full pre-push hook passed, all five stages:

1. `@eanhl/db`: 39/39 passed
2. `worker`: 617 passed, 4 skipped, **0 failed**
3. `game_ocr`: 517 passed, 2 skipped
4. `video_ingest`: 1489 passed, 5 skipped
5. proving bench: 1 passed with 3 subtests

Overall `verify-ocr` result: **PASSED**.

`origin/main` advanced by **fast-forward** (no force, no rewrite):

```
c19691711fcb1fa52d3b9c4dc1a7ca1a70841e75
→
a97ce87c655e9ce7145653837f18df5c7b1eba9c
```

81 commits were pushed in this fast-forward.

## Final state (independently reconfirmed this documentation session)

- local `HEAD`: `a97ce87c655e9ce7145653837f18df5c7b1eba9c`
- `origin/main`: `a97ce87c655e9ce7145653837f18df5c7b1eba9c` (identical)
- ahead/behind vs `origin/main`: **0/0**
- git staging area: empty
- 32 pre-existing dirty/untracked paths remain in the working tree, all
  unrelated to this repair and untouched by it
- Database counts re-verified by fresh `SELECT`: `legacy-mixed` = 40,
  `legacy-passthrough-v0-video` = 59, all 38 repaired run IDs read
  `legacy-mixed`, 0 `ocr_run_quality_reports` rows for those 38 IDs

## Unresolved source-level follow-up

Future operations that attach segments with a new decoder version to an
existing synthetic `ocr_decoder_runs` row can recreate this exact drift:
**no source path currently refreshes the parent run's `decoder_version` and
`notes` when new-decoder segments are attached to it.** The 2026-08-16
repair fixed the 38 already-drifted rows; it did not add a mechanism to
prevent recurrence.

Before another rescue-like execution is authorized, add an atomic
provenance-refresh step (or an equivalent enforced postcondition, e.g. a
test or check that fails closed on any run whose child segments span more
than one decoder while its own `decoder_version` says otherwise) to
whichever code path performs the attachment.

**This document does not authorize rescue execution.**
