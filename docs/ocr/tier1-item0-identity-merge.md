# Tier 1 Item 0 — Player-identity merge + quarantine reconciliation (2026-06-14)

Audit record for a **live-DB data repair** (no code artifact for the data part — this
documents what was run and why). Plan: `~/.claude/plans/proceed-to-plan-the-crispy-lemon.md`.

## What was wrong

Tier 0 quarantined 7 worker reds as "live-data drift." Forensics showed the real cause was
**test-fixture contamination of the live database**: `apps/worker/src/__tests__/fixtures/seed-fixture-db.ts`
seeds sentinel `players` rows with hardcoded ids and **real-colliding gamertags**
(`{id: 99021, gamertag: 'HenryTheBobJr'}`, `onConflictDoNothing`). At least one test run executed
against the live `eanhl` DB, leaving the sentinel behind. Because its gamertag matches a real club
member, live ingestion then bound real data to the sentinel:

| players.id | gamertag      | player_match_stats     | loadout refs       | verdict                          |
| ---------- | ------------- | ---------------------- | ------------------ | -------------------------------- |
| 1          | HenryTheBobJr | 77                     | 2                  | real player (canonical)          |
| 99021      | HenryTheBobJr | 23 (matches 2397–2662) | 13 (incl. 250/463) | sentinel that accreted real data |
| 99101      | SlotA_Player  | 0                      | 0                  | pure pollution                   |
| 99102      | SlotB_Player  | 0                      | 0                  | pure pollution                   |

The split identity bound match 250/463 lineups to `99021` while their events bound to real `1`,
firing the class-G off-roster penalty → match 250 L2 dropped from 0.9792 to 0.854.

## What was done (live DB)

- **Backup:** `pg_dump` → `/home/michal/eanhl-db-backups/eanhl-pre-merge-20260614-101108.sql` (113 MB).
- **Merge `99021 → 1`** in one transaction (FKs are `NO ACTION`, so a missed ref would have aborted it):
  repointed `player_match_stats` (23) + `player_loadout_snapshots` (13) + `ea_member_season_stats` (1);
  dropped `99021`'s stale `player_game_title_stats` (2) + empty `player_profiles` (1); deleted
  `players` 99021. id 1 and 99021 shared no match, so the per-match repoint was conflict-free.
- **Clean-deleted** sentinels `99101`, `99102` (0 refs).
- **Recomputed** aggregates: `recomputeAggregates(1)` → id 1 now 100 GP (77+23). (The live worker also
  auto-recomputes each cycle.)
- **Re-consolidated + backfilled** match 463 (`consolidate-loadouts --match 463`,
  `backfill-event-actor-resolution --match 463`): L2 0.70 → 0.82. Match 250 needed no re-run — the
  merge alone restored its L2 to 0.9792 and cleared class G.
- **Re-anchored** `L2_THRESHOLD` 0.85 → 0.90 (`apps/worker/src/lib/quality-layers.ts`) on the restored
  250, and re-emitted `run-quality` rows: match 250 `overall_pass = true`; 463/968/2582 `false`.

Result: 1 of the 7 reds (`match 250 — layer scores at or above floor`) went green. Worker suite:
394 pass, 6 quarantined reds.

## Residual reds (quarantined — genuine extractor limits, NOT data contamination)

See `docs/ocr/tier0-quarantined-worker-tests.txt`. The remaining 6 are OCR extraction-quality issues
that re-OCR cannot fix (same frame-segmentation defect class as match 2582,
`docs/ocr/box-score-ocr-accuracy-followup.md`):

- **match 250 lobby** (3 reds): `pre_game_lobby_state_2` frames are scrambled (wrong
  gamertag↔position↔number). The loadout_view-derived reviewed lineup is correct vs V2; only the
  lobby-source fields are bad. → gamertag 7/10, player_number 2/10, height 5'9" vs 6'6".
- **match 250 getMatchLineups**: BGM/LW `is_captain` misread `true` (V2 false) — captain-icon
  extractor misread; `consolidate` sets `is_captain` by a pure OR with no confidence signal.
- **match 463 floor** (2 reds): L2/L2.5/L3 below floor after backfill — residual duplicate-event /
  missing-lineup-field gaps.

**Tier-1-extractor ticket:** lobby frame-segmentation + captain-icon confidence are the next OCR
extractor work. Do NOT lower the V2 / regression-floor expectations to make these pass.

## Recurrence prevention (code)

`seed-fixture-db.ts` now has a **clone guard** (`assertCloneDb`): the seeder refuses to run unless
`DATABASE_URL` points at an `eanhl_test_*` clone (provisioned by `apps/worker/scripts/with-test-db.mjs`).
Since clones are dropped after each run, a sentinel can never reach the live DB again. (A deferred
follow-up could also rename the colliding sentinel gamertags, but that needs coordinated
fixture-evidence changes; the guard is the definitive fix.)
