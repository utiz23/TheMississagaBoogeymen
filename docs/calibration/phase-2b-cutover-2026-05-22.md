# Phase 2B-8 Cutover — 2026-05-22

## Pre-cutover state

- Sampling rate bumped to 3 fps for `player_loadout_view` segments (commit pending)
- Pass-1+Pass-2 re-ingested for matches 250 + 463 at the new rate
- typed_v1 promoter green via dry-run

Targets (confirmed by post-resample dry-run; values written below at execution time):

| Match | Expected promoted snapshots                          |
| ----- | ---------------------------------------------------- |
| 250   | 10 (5 BGM + 5 opp, full lineup incl JoeyFlopfish RD) |
| 463   | 10 (5 BGM + 5 opp, full lineup incl ThickOoze RD)    |

## Cutover procedure

### 1. Create backup tables (idempotent — drops first if they exist)

```sql
DROP TABLE IF EXISTS _phase2_backup_player_loadout_snapshots;
DROP TABLE IF EXISTS _phase2_backup_player_loadout_x_factors;
DROP TABLE IF EXISTS _phase2_backup_player_loadout_attributes;

CREATE TABLE _phase2_backup_player_loadout_snapshots AS
  SELECT * FROM player_loadout_snapshots WHERE match_id IN (250, 463);

CREATE TABLE _phase2_backup_player_loadout_x_factors AS
  SELECT xf.* FROM player_loadout_x_factors xf
  JOIN player_loadout_snapshots s ON s.id = xf.loadout_snapshot_id
  WHERE s.match_id IN (250, 463);

CREATE TABLE _phase2_backup_player_loadout_attributes AS
  SELECT a.* FROM player_loadout_attributes a
  JOIN player_loadout_snapshots s ON s.id = a.loadout_snapshot_id
  WHERE s.match_id IN (250, 463);
```

### 2. Delete legacy rows

```sql
-- Child tables first (foreign keys)
DELETE FROM player_loadout_x_factors WHERE loadout_snapshot_id IN
  (SELECT id FROM player_loadout_snapshots WHERE match_id IN (250, 463));
DELETE FROM player_loadout_attributes WHERE loadout_snapshot_id IN
  (SELECT id FROM player_loadout_snapshots WHERE match_id IN (250, 463));
DELETE FROM player_loadout_snapshots WHERE match_id IN (250, 463);
```

### 3. Run promoter for typed_v1 evidence

```bash
pnpm --filter worker repromote-loadout -- --match 250
pnpm --filter worker repromote-loadout -- --match 463
```

### 4. Verify

```sql
SELECT
  match_id, team_side, position, gamertag_snapshot, player_number, build_class
FROM player_loadout_snapshots
WHERE match_id IN (250, 463)
ORDER BY match_id, team_side, position;
```

Expected: 20 rows total (10 per match).

## Rollback procedure

```sql
-- Restore legacy snapshots + children from backup
INSERT INTO player_loadout_snapshots
  SELECT * FROM _phase2_backup_player_loadout_snapshots;
INSERT INTO player_loadout_x_factors
  SELECT * FROM _phase2_backup_player_loadout_x_factors;
INSERT INTO player_loadout_attributes
  SELECT * FROM _phase2_backup_player_loadout_attributes;

-- And flip the YAML back:
-- pass2.loadout_engine: legacy
```

Backup tables are intentionally not dropped after cutover — they remain available
as long as needed. Drop them once we have a successful production run that
confirms the cutover.
