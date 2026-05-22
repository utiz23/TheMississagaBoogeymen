-- Phase 2B-8 Cutover SQL
-- See docs/calibration/phase-2b-cutover-2026-05-22.md for context + rollback.

BEGIN;

-- 1. Backup legacy rows (drop-then-create so script is idempotent)
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

-- 2. Delete legacy rows (child tables first; FK order)
DELETE FROM player_loadout_x_factors WHERE loadout_snapshot_id IN
  (SELECT id FROM player_loadout_snapshots WHERE match_id IN (250, 463));
DELETE FROM player_loadout_attributes WHERE loadout_snapshot_id IN
  (SELECT id FROM player_loadout_snapshots WHERE match_id IN (250, 463));
DELETE FROM player_loadout_snapshots WHERE match_id IN (250, 463);

COMMIT;
