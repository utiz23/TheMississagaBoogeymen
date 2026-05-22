# Phase 3b-8 Cutover — Typed Lobby Promoter (2026-05-22)

## Pre-cutover state

- Tasks 3B-1 through 3B-7 landed on `feat/ocr-pipeline-phase-3a`:
  - `lobby_extractors/` Python package (row_grouping + slot_identity)
  - `lobby_evidence.py` typed extractor entry
  - `pass2_extract.py::_run_typed_v1_lobby` dispatch + `lobby_engine` YAML flag (default `typed_v1`)
  - `dispatch.py` + `ocr-cli-runner.ts` + `ingest-ocr.ts` worker wiring for `--lobby-engine` + `--lobby-evidence-json`
  - `lobby-v2.ts` typed promoter + `index.ts` engine guard
  - `match-250-benchmark.test.ts` Phase 3b accuracy gates (currently fail on
    the legacy parser — 7/10 gamertag accuracy — and serve as the regression
    floor the cutover must clear)

Targets (confirmed once cutover finishes):

| Match | Expected lobby snapshots (typed_v1) | Hard-field accuracy bar | Soft-field accuracy bar |
|---|---|---|---|
| 250 | 10 (5 BGM + 5 opp; goalies CPU) | gamertag, position ≥ 90% | player_number, persona, captain ≥ 75% |
| 463 | 10 | same | same |

## Cutover procedure

### 1. Build all packages

```bash
pnpm install
pnpm --filter @eanhl/db build
pnpm --filter @eanhl/ea-client build
pnpm --filter worker build
```

### 2. Create backup table (idempotent — drops first if it exists)

```sql
DROP TABLE IF EXISTS _phase3b_backup_player_loadout_snapshots;

CREATE TABLE _phase3b_backup_player_loadout_snapshots AS
SELECT pls.*
FROM player_loadout_snapshots pls
JOIN ocr_extractions oe ON oe.id = pls.ocr_extraction_id
WHERE pls.match_id IN (250, 463)
  AND oe.screen_type LIKE 'pre_game_lobby%';
```

### 3. Delete legacy lobby-sourced snapshots

The typed promoter is self-idempotent (`lobby-v2.ts` deletes prior
lobby-sourced snapshots for the match before insert), but doing it once at
cutover time gives a clean before/after audit.

```sql
DELETE FROM player_loadout_snapshots
WHERE id IN (SELECT id FROM _phase3b_backup_player_loadout_snapshots);
```

### 4. Re-ingest both matches with `lobby_engine: typed_v1`

Use the same Pass-1 + Pass-2 + worker dispatch path Phase 2B used. The
production source videos:

- Match 250: `/mnt/k/NHL/NHL26/match 250/2026-05-08_18-25-42.mkv`
- Match 463: `/mnt/k/NHL/NHL26/match 463/silkyjoker85_NHL26XboxSeriesXS_20260512_00-45-27.mp4`

```bash
# Per match — run from the worktree root.
# Pass-1 cached output is at /tmp/typed-v1-match250/<sha>/segments.json (and
# parallel for 463). Pass-2 + worker dispatch:
set -a && source /home/michal/projects/eanhl-team-website/.env && set +a

python -m video_ingest ingest \
  --video "/mnt/k/NHL/NHL26/match 250/2026-05-08_18-25-42.mkv" \
  --output-root /tmp/phase3b-cutover-250 \
  --dispatch \
  --game-title-id 1 \
  --match-id 250 \
  --version nhl26

python -m video_ingest ingest \
  --video "/mnt/k/NHL/NHL26/match 463/silkyjoker85_NHL26XboxSeriesXS_20260512_00-45-27.mp4" \
  --output-root /tmp/phase3b-cutover-463 \
  --dispatch \
  --game-title-id 1 \
  --match-id 463 \
  --version nhl26
```

### 5. Run the consolidator

```bash
pnpm --filter worker exec node dist/consolidate-loadouts-cli.js --match 250
pnpm --filter worker exec node dist/consolidate-loadouts-cli.js --match 463
```

### 6. Verify

```sql
-- Gate A: lobby-typed_v1 snapshot counts per match
SELECT pls.match_id, COUNT(*) AS lobby_snapshots
FROM player_loadout_snapshots pls
JOIN ocr_extractions oe ON oe.id = pls.ocr_extraction_id
WHERE pls.match_id IN (250, 463)
  AND oe.screen_type = 'pre_game_lobby_state_2'
GROUP BY pls.match_id;
-- Expected: both ≥ 10

-- Gate B: loadout-detail snapshots unchanged (no Phase 2B regression)
SELECT pls.match_id, COUNT(*) AS loadout_snapshots
FROM player_loadout_snapshots pls
JOIN ocr_extractions oe ON oe.id = pls.ocr_extraction_id
WHERE pls.match_id IN (250, 463)
  AND oe.screen_type = 'player_loadout_view'
GROUP BY pls.match_id;
-- Expected: both ≥ 10 (Phase 2B floor)

-- Gate C: distinct (team_side, position) slot count per match
SELECT match_id, COUNT(DISTINCT (team_side, position))
FROM player_loadout_snapshots
WHERE match_id IN (250, 463)
GROUP BY match_id;
-- Expected: 10 per match

-- Gate D: per-field non-null counts on lobby-sourced rows
SELECT
  pls.match_id,
  COUNT(*) FILTER (WHERE pls.gamertag_snapshot IS NOT NULL) AS gamertag_n,
  COUNT(*) FILTER (WHERE pls.position IS NOT NULL) AS position_n,
  COUNT(*) FILTER (WHERE pls.build_class IS NOT NULL) AS build_n,
  COUNT(*) FILTER (WHERE pls.player_number IS NOT NULL) AS pnum_n,
  COUNT(*) FILTER (WHERE pls.is_captain IS NOT NULL) AS cap_n,
  COUNT(*) FILTER (WHERE pls.height_text IS NOT NULL) AS height_n,
  COUNT(*) FILTER (WHERE pls.weight_lbs IS NOT NULL) AS weight_n,
  COUNT(*) FILTER (WHERE pls.handedness IS NOT NULL) AS hand_n
FROM player_loadout_snapshots pls
JOIN ocr_extractions oe ON oe.id = pls.ocr_extraction_id
WHERE pls.match_id IN (250, 463)
  AND oe.screen_type = 'pre_game_lobby_state_2'
GROUP BY pls.match_id;
-- Expected: hard fields ≥ 9/10; soft fields ≥ 7/10.
-- build_class may be 0 (state_1 frames don't appear in operator recordings —
-- Phase 3a closure doc).

-- Gate E: promotion outcomes audit
SELECT promotion_status, COUNT(*)
FROM ocr_promotions
WHERE match_id IN (250, 463)
  AND target_table = 'player_loadout_snapshots'
  AND target_semantic_key->>'slot_key' LIKE 'lobby\_%' ESCAPE '\\'
GROUP BY promotion_status;
-- Expected: 'promoted' dominates; any 'blocked_*' rows triaged with
-- reasons in the addendum below.
```

### 7. Run benchmark tests

```bash
pnpm --filter @eanhl/worker build
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js
```

Phase 3b new tests must now pass:
- `match 250: lobby typed_v1 hard-field accuracy ≥ 90%`
- `match 250: lobby typed_v1 soft-field accuracy ≥ 75%`

Existing match 250 tests (lineups, goals, action tracker, faceoff, etc.)
must stay green.

## Rollback procedure

```sql
-- Restore legacy lobby snapshots from backup
INSERT INTO player_loadout_snapshots
SELECT * FROM _phase3b_backup_player_loadout_snapshots;
```

Then flip the YAML:

```yaml
# tools/video_ingest/video_ingest/configs/nhl26.yaml
pass2:
  lobby_engine: legacy   # was: typed_v1
```

Backup tables are intentionally NOT dropped after cutover — they remain
available until a successful production run confirms the cutover. Drop
manually after operator sign-off.

## Risks + bail-out triggers

Refer to `/home/michal/.claude/plans/plan-the-phase-3a-virtual-swan.md`
sections "Risks + bail-out triggers". Key bail-outs:

- **Phase 2B loadout-snapshot count regresses below 10** on either match
  → revert YAML, restore backups, escalate.
- **Lobby promoter produces ZERO snapshots for either match** despite
  evidence rows being written → check ocr_promotions for `blocked_*`
  reasons, lower the gate `consensusThreshold` to 0.45 if closed-vocab
  fuzzy matches (confidence 0.5) are being dropped.
- **`TestEndToEndOnLabeledClip` (Python) drops below 45/60** after the
  cutover → unrelated regression; investigate before retry.
- **Worker `pnpm --filter worker test` shows new failures** after the
  cutover → typed promoter path has a defect; bail and investigate.

## Cutover log (filled in at execution time)

| Step | Before | After | Notes |
|---|---|---|---|
| Match 250 lobby snapshots (Gate A) | _to fill in_ | _to fill in_ | |
| Match 250 loadout snapshots (Gate B) | _to fill in_ | _to fill in_ | should stay ≥ 10 |
| Match 250 distinct slots (Gate C) | _to fill in_ | _to fill in_ | should be 10 |
| Match 250 hard-field gamertag (Gate D) | 7/10 (pre-cutover) | _to fill in_ | bar: ≥ 9/10 |
| Match 250 hard-field position (Gate D) | _to fill in_ | _to fill in_ | bar: ≥ 9/10 |
| Match 250 soft-field player_number (Gate D) | 7/10 (pre-cutover) | _to fill in_ | bar: ≥ 7/10 |
| Match 463 (all gates) | | | |
| Promotion outcomes (Gate E) | | | |
| Benchmark test pass | _2 new tests fail_ | _to fill in_ | |

## Open items for follow-up

- `is_ready` evidence is written to `ocr_field_evidence` but never
  materialized to `player_loadout_snapshots` (no DB column). Defer to a
  later migration if downstream needs this.
- `handedness` evidence emission depends on the `SHOOTS LEFT/RIGHT`
  substring appearing in row OCR — rarely visible in lobby state_2.
  Expect mostly-null handedness on lobby-sourced rows; the consolidator
  picks the loadout-view source when both are present.
- Phase 3b deliberately does NOT touch `consolidate-loadouts-cli`. If
  conflicts surface during Gate D, a consolidator priority tweak is a
  follow-up phase, not a Phase 3b fix.
