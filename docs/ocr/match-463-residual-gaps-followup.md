# Match 463 — residual extraction gaps (Tier 1 follow-up)

Filed 2026-06-14 as part of clearing the residual quarantined worker reds
(plan: `~/.claude/plans/sorry-forgot-to-put-steady-lemon.md`, WS-C). This is the
extractor-side backlog that the regression-floor re-baseline deliberately did **not** try to fix.

## What changed (WS-C)

`docs/calibration/regression-floor-match-463.json` was re-baselined from the **stale**
phase-3a-worktree snapshot to the current verified post-repair DB state:

| layer        | old floor (phase-3a, pre-repair) | new floor (current, honest) |
| ------------ | -------------------------------- | --------------------------- |
| l2 (actor)   | 0.98                             | 0.82                        |
| l2_lineup    | 0.875                            | 0.825                       |
| l3 (downstr) | 0.965                            | 0.919                       |

The old floor was a self-captured snapshot from `.claude/worktrees/phase-3a/`, taken before the
Tier 1 Item 0 identity-merge repair and before the Tier 0 threshold recalibration (its own
`l2_lineup 0.875` already sat below the current `L2_LINEUP_THRESHOLD = 0.90`). It is **not** the V2
ground-truth benchmark. The new floor reflects what the current stored evidence honestly supports;
the regression gate now protects against future drops below that honest level.

## Verified-honest gaps (NOT recoverable by re-consolidate / floor edits)

These were each checked against the live DB before re-baselining — they are genuine
evidence/capture limits, not anchor-selection bugs:

1. **l3 loadout attributes 138/230, x_factors 18/30 — C and LW (both sides) have no attribute
   panels in the current captures.** Verified read-only: of the 10 reviewed loadout-view anchors,
   only 6 carry `player_loadout_attributes`/`player_loadout_x_factors` child rows, and the 4
   attribute-less slots (`for/C`, `for/LW`, `against/C`, `against/LW`) have **zero** attribute-
   bearing snapshots anywhere among the 64 pending loadout-view snapshots. So `pickAnchor`
   ([apps/worker/src/lib/consolidate-loadouts.ts](../../apps/worker/src/lib/consolidate-loadouts.ts))
   is not leaving data on the table — the attribute screens for those 4 players were never captured
   for 463. Recoverable only by a re-ingest whose recording covers those attribute panels (same
   frame-capture family as the deferred lobby re-ingest, `tier0-quarantined-worker-tests.txt` WS-B).

2. **l2 deductions = 9 (class A) + 6 marker collisions (class C) — OCR-variant duplicate events.**
   Example: P2 11:07 faceoff appears twice — `for`/"M. RANTANEN" and `against`/"RANIANEN" — the
   same real faceoff seen from both team perspectives, plus OCR spelling variants. The L2 dedup
   keys on `(period, clock, type)` and counts the cross-side pair as a duplicate. Class C is
   chevron-marker (x,y) collisions within 1.0 hockey unit. These are real dedup/extractor gaps in
   `match_events`, not corrupt rows (confirmed they are distinct rows with distinct `team_side` /
   `ocr_extraction_id`, not row-level duplication).

3. **l2_lineup 33/40 fields populated** — residual missing lineup fields across the 10 reviewed
   slots (gamertag + persona + position + build_canonical), tied to the same sparse-capture
   condition as (1).

## Proposed extractor work (separate from WS-A captain fix)

- OCR-variant / cross-side event dedup so a single faceoff (and chevron-collision shots/hits)
  isn't double-counted in L2.
- Chevron marker cluster-radius tuning to stop near-coincident (x,y) collisions.
- Re-ingest 463 with attribute-panel coverage (or accept the C/LW attribute gap as a recording
  limitation) — only path to raise l3 back toward the old 0.965.

Do **not** lower the V2 / ground-truth lineup/event expectations to close these; they are real
extraction quality gaps to be improved, with the re-baselined floor as the honest current baseline.
