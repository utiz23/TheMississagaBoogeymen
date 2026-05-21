# Phase 2B-0a — Expected-Roster Authority Readiness Checkpoint

Date: 2026-05-21
Status: DECIDED

## Findings

Script output from `getExpectedSlotsForMatch(matchId)` for matches 1, 2, 250, 463:

```
1: 6 pairs
  for / LD
  for / C
  for / LW
  against / C
  against / LD
  against / LW
2: 6 pairs
  for / LD
  for / C
  for / LW
  against / C
  against / LD
  against / LW
250: 10 pairs
  for / LD
  for / RW
  for / LW
  for / C
  for / RD
  against / C
  against / LW
  against / LD
  against / RD
  against / RW
463: 10 pairs
  for / LD
  for / RW
  for / C
  for / RD
  for / LW
  against / C
  against / LD
  against / RD
  against / LW
  against / RW
```

| Match | Returned pairs | Game mode | Notes |
|-------|---------------|-----------|-------|
| 1     | 6             | 3v3       | 3 for (LD, C, LW) + 3 against (C, LD, LW); no RW/RD — 3s skaters only |
| 2     | 6             | 3v3       | Same as match 1 (symmetric EA payload) |
| 250   | 10            | 6v6       | 5 for (LD, RW, LW, C, RD) + 5 against — full 5-skater lineup per side |
| 463   | 10            | 6v6       | Same as match 250 pattern |

All four matches return >0 pairs. No match hits Path C (0 rows). No `match_lineups`
table exists; `player_match_stats` + `opponent_player_match_stats` are the single
authority source.

## Decision

- **Path A (≥9 for all 4):** Not applicable — matches 1 and 2 return only 6 pairs
  (3v3 games; the 3-skater format has a structural ceiling of 6 slots).
- **Path B (≥9 for some, not all):** Selected. Matches 250 and 463 return 10 pairs
  each (≥9). Matches 1 and 2 return 6 pairs each (<9) because the game mode is
  3v3, not because data is missing.
- **Path C1 (backfill):** Not applicable; authority exists and is correctly populated.
- **Path C2 (re-scope T2B):** Not applicable; authority works for all test matches and
  adequately represents the two game-mode variants that exist in the dataset.

**Chosen: Path B**

## Rationale

Matches 1 and 2 fall below the ≥9 threshold purely because they are 3v3 games —
the maximum number of skater slots for a 3v3 game is 3 per side × 2 sides = 6. This
is not a data gap; it is a structural property of the game mode. The authority is
complete and correct for both matches.

Matches 250 and 463 are 6v6 games with 5 skaters per side (EA excludes the goalie
position from per-player stats), giving 10 slots each, which comfortably clears the
≥9 threshold.

The asymmetry is therefore a consequence of game-mode diversity in the test corpus,
not a deficiency in the authority chain. Path B is the correct classification: the
observability assertion in T2B (Task 2B-10) runs with full authority for the 6v6
test cases and with a proportionally smaller but still valid authority for the 3v3
test cases.

## Implications for downstream tasks

- **T2B (Task 2B-10):** The observability assertion (`≥1 promoted snapshot`) applies
  to all four matches. The stronger `≥9 slots covered` assertion applies only to
  matches 250 and 463. For matches 1 and 2 the assertion is scoped to ≤6 slots
  (all slots for a 3v3 game). This asymmetry must be documented inline in the T2B
  test.

- **Match 1 + Match 2 observability:** 6 expected slots for each match. All 6 are
  present in the authority. The loadout promoter will write blocked_observability
  rows for any of the 6 slots that have no OCR evidence, rather than the 10-slot
  pattern used for 6v6 games. This is correct behavior.

- **Backfill (Task 2B-7):** Not required. The authority tables are fully populated
  for all four target matches. No migration is needed before proceeding to Task 2B-1.

## Reversibility

This decision is documented and reversible. If a future iteration adds a
`match_lineups` table or another authoritative per-match roster source, update
`packages/db/src/queries/expected-roster.ts` to prefer that source and re-run
this checkpoint. The script to reproduce the findings is embedded in the task
description at `docs/calibration/phase-2b-authority-readiness-2026-05-21.md`.
