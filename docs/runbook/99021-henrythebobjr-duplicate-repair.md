# Duplicate `HenryTheBobJr` (player_id 99021 → 1) Repair — PROPOSAL ONLY

> **Status: PROPOSAL. NOT EXECUTED. No live data was changed.**
> This document describes a re-point/cleanup of mis-bound real player data.
> It is live-data surgery and must be reviewed and run manually by an operator.

## Problem

There are two `players` rows with gamertag `HenryTheBobJr`:

| id      | role                              | notes                                  |
| ------- | --------------------------------- | -------------------------------------- |
| `1`     | canonical / real club member      | 77 `player_match_stats` rows           |
| `99021` | duplicate (test-seeded, leaked)   | accumulated real refs via gamertag bind |

`99021` originated as a test sentinel in
`apps/worker/src/__tests__/match-463-loadout-slots-fixture.test.ts`
(`seedMatch463Roster` inserts `{ id: 99021, gamertag: 'HenryTheBobJr' }` with
`onConflictDoNothing`). It leaked past a failing teardown, and subsequent
gamertag-based ingestion bound **real** match data to `99021` instead of the
canonical `1`. HenryTheBobJr's real history is therefore split across two ids.

The test teardown has since been hardened (it no longer tries to delete a
referenced player), so this row is stable — but the split data remains.

## Exact affected tables & row counts (`player_id = 99021`)

Captured from the live DB (`eanhl-team-website-db-1`) at proposal time:

| Table                         | Rows | Class      | Re-point to id 1?                              |
| ----------------------------- | ---- | ---------- | ---------------------------------------------- |
| `player_match_stats`          | 23   | raw fact   | **Yes** — 0 match overlap with id 1            |
| `player_loadout_snapshots`    | 2    | raw fact   | **Yes** — 0 match overlap with id 1            |
| `player_profiles`             | 1    | derived    | **No** — PK is `player_id`; id 1 already has one |
| `player_game_title_stats`     | 2    | aggregate  | **No** — unique `(player_id, game_title_id, coalesce(game_mode,''))`; 1 game_title collides with id 1 |
| `ea_member_season_stats`      | 1    | derived    | **No** — delete + recompute (treat as derived) |

All other FK-referencing tables (`match_events`, `match_goal_events`,
`match_penalty_events`, `player_gamertag_history`, `user_player_claims`,
`user_player_notes`, `account_invites`, `player_display_aliases`,
`player_persona_aliases`, `historical_*`) had **0** rows referencing `99021`.

### Relevant unique constraints

- `player_match_stats_player_match_uniq (player_id, match_id)`
- `player_game_title_stats_uniq (player_id, game_title_id, coalesce(game_mode,''))`
- `player_profiles_pkey (player_id)`
- `ea_member_season_stats_uniq (game_title_id, gamertag)` — note: excludes `player_id`

## Rewrite plan (canonical `player_id = 1`)

Principle: **re-point raw facts, delete + recompute derived/aggregates.**
Raw rows are collision-free (verified 0 overlap), so they move cleanly. Derived
rows collide on unique indexes and would double-count, so they are dropped for
`99021` and recomputed for `1` from the now-unified raw facts.

Run inside a single transaction:

```sql
BEGIN;

-- 0. Snapshot affected rows for rollback (backup tables in a scratch schema).
CREATE SCHEMA IF NOT EXISTS repair_99021_backup;
CREATE TABLE repair_99021_backup.player_match_stats       AS SELECT * FROM player_match_stats       WHERE player_id = 99021;
CREATE TABLE repair_99021_backup.player_loadout_snapshots AS SELECT * FROM player_loadout_snapshots WHERE player_id = 99021;
CREATE TABLE repair_99021_backup.player_profiles          AS SELECT * FROM player_profiles          WHERE player_id = 99021;
CREATE TABLE repair_99021_backup.player_game_title_stats  AS SELECT * FROM player_game_title_stats  WHERE player_id = 99021;
CREATE TABLE repair_99021_backup.ea_member_season_stats   AS SELECT * FROM ea_member_season_stats   WHERE player_id = 99021;

-- 1. Re-point raw fact rows (collision-free).
UPDATE player_match_stats       SET player_id = 1 WHERE player_id = 99021;
UPDATE player_loadout_snapshots SET player_id = 1 WHERE player_id = 99021;

-- 2. Drop duplicate derived/aggregate rows (will be recomputed for id 1).
DELETE FROM player_profiles         WHERE player_id = 99021;
DELETE FROM player_game_title_stats WHERE player_id = 99021;
DELETE FROM ea_member_season_stats  WHERE player_id = 99021;

-- 3. Remove the now-orphaned duplicate player row.
DELETE FROM players WHERE id = 99021;

-- Verify (see queries below) BEFORE commit; ROLLBACK if anything is off.
COMMIT;
```

Then recompute aggregates for the canonical player so id 1 reflects the merged
raw facts (do **not** hand-edit aggregates):

```bash
set -a && source .env && set +a
pnpm --filter @eanhl/worker build
# Recompute precomputed per-game-title aggregates from raw rows.
# (Aggregates are precomputed, never computed on read — CLAUDE.md.)
pnpm --filter worker reprocess --all   # or the targeted aggregate-recompute path
```

> Confirm the exact aggregate-recompute entrypoint before running — `reprocess`
> rebuilds transforms/aggregates from raw payloads. If a narrower
> recompute-aggregates-for-player command exists, prefer it.

## Recommended form: **one-off SQL runbook, run manually in a transaction**

Not a Drizzle migration: this is environment-specific *data* pollution on the
live DB, not a schema change. Migrations run everywhere and must be structural;
this repair is a one-time, reviewed, operator-run correction. A one-off script
or this SQL runbook (wrapped in `BEGIN/COMMIT` with verification gates) is the
right tool. A worker CLI one-off is acceptable if you want it parameterized and
idempotent, but the SQL runbook is the minimum viable, fully reviewable form.

## Rollback strategy

- The whole repair runs in **one transaction** — any failed verification →
  `ROLLBACK`, no partial state.
- Pre-change rows are copied into `repair_99021_backup.*` (step 0). If a problem
  surfaces **after** commit, restore from those tables (re-insert, flip
  `player_id` back to 99021 for the raw rows, re-create the players row), then
  re-run aggregate recompute.
- Optionally take a `pg_dump` of the affected tables before starting for an
  out-of-band restore point.

## Verification queries

**Before** (must match the counts in this doc):

```sql
SELECT 'pms' t, count(*) FROM player_match_stats WHERE player_id=99021
UNION ALL SELECT 'snap', count(*) FROM player_loadout_snapshots WHERE player_id=99021
UNION ALL SELECT 'profile', count(*) FROM player_profiles WHERE player_id=99021
UNION ALL SELECT 'gts', count(*) FROM player_game_title_stats WHERE player_id=99021
UNION ALL SELECT 'ea_season', count(*) FROM ea_member_season_stats WHERE player_id=99021;
-- Collision guard (must all be 0 before re-point):
SELECT count(*) FROM (SELECT match_id FROM player_match_stats WHERE player_id=1
  INTERSECT SELECT match_id FROM player_match_stats WHERE player_id=99021) x;
```

**After** (all zero; id 1 absorbed the facts):

```sql
SELECT count(*) AS any_99021_refs_remaining FROM player_match_stats WHERE player_id=99021;  -- 0
SELECT count(*) FROM players WHERE id=99021;                                                 -- 0
SELECT count(*) AS id1_pms FROM player_match_stats WHERE player_id=1;                        -- 77 + 23 = 100
SELECT count(*) FROM player_profiles WHERE player_id=1;                                      -- 1 (canonical)
```

## Explicit safety note

This was **intentionally not auto-run.** It mutates live player history
(re-points 23 real match-stat rows + 2 snapshots, deletes derived rows, deletes
a `players` row). It requires operator review, a backup, transaction-wrapped
execution, and an aggregate recompute afterward. Nothing in this task changed
live `99021` data.
