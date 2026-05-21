-- Phase 1 HMM re-ingest duplicate match_events cleanup
-- Date: 2026-05-20
-- Matches affected: 250, 463
-- Author: automated surgical cleanup (Phase 1 OCR pipeline redesign)
--
-- Problem:
--   Task 14's HMM re-ingest inserted duplicate match_events rows that the
--   existing promoter-level dedup (match-events-dedup.ts) didn't catch.
--
--   Match 250: 3 new junk buckets inserted — all have x IS NULL with
--     corrupted actor snapshots (trailing OCR bracket noise).
--   Match 463: 6 new junk buckets inserted — all have x IS NULL (or if
--     positioned, a corrupted actor snapshot) from a second run of batch 186.
--     The original single deduction (P2 11:07 faceoff ×2, ids 349+359) is
--     preserved — it predates the HMM re-ingest and was already in the floor.
--
-- Verification (dry-run SELECT) shows:
--   Match 250 junk rows: 427 (P2 13:41 goal "Silky ["),
--                         426 (P3 1:09 goal "Toews [2l"),
--                         428 (P3 0:52 goal "S. Zubov (1l")
--   Match 463 junk rows: 429 (P1 4:13 faceoff "R.YOINT"),
--                         431 (P2 10:19 faceoff "H. YUINI"),
--                         432 (P2 10:29 shot "H. U'YOINISKI"),
--                         433 (P2 15:08 faceoff "M. RANI ANEN"),
--                         434 (P3 1:35 faceoff "R. YOINI"),
--                         435 (P3 5:40 faceoff "R. YUINI")
--
-- Expected outcome:
--   Match 250: 4 dup buckets → 1 (legit P3 2:09 hit WILDE + S.ZUBOV pair preserved)
--   Match 463: 7 dup buckets → 1 (legit P2 11:07 faceoff M.RANTANEN + RANIANEN pair)
--   L2 deductions: 250=4→1, 463=7→1 → regression floors restored
--   match_goal_events cascade: ids 426, 427, 428 deleted first (FK constraint)
--
-- ============================================================================
-- DRY RUN (SELECT only) — verify before deleting
-- ============================================================================

-- Section A: Match 250 — positioned-vs-junk prefix analysis
WITH normalized AS (
  SELECT
    id, match_id, period_number, clock, event_type, x,
    actor_gamertag_snapshot,
    LOWER(REGEXP_REPLACE(COALESCE(actor_gamertag_snapshot, ''), '[^a-zA-Z]', '', 'g')) AS norm_actor
  FROM match_events
  WHERE match_id = 250
    AND source='ocr'
    AND event_type IN ('goal','shot','hit','penalty')
),
bucket_pairs AS (
  SELECT
    a.id AS a_id, a.match_id, a.period_number, a.clock, a.event_type,
    a.actor_gamertag_snapshot AS a_actor,
    a.x AS a_x,
    a.norm_actor AS a_norm,
    b.id AS b_id,
    b.actor_gamertag_snapshot AS b_actor,
    b.x AS b_x,
    b.norm_actor AS b_norm
  FROM normalized a
  JOIN normalized b ON
    a.id < b.id
    AND a.match_id = b.match_id
    AND a.period_number = b.period_number
    AND a.clock = b.clock
    AND a.event_type = b.event_type
),
deletable AS (
  SELECT
    CASE WHEN a_x IS NULL THEN a_id ELSE b_id END AS junk_id,
    CASE WHEN a_x IS NULL THEN a_actor ELSE b_actor END AS junk_actor,
    CASE WHEN a_x IS NULL THEN b_actor ELSE a_actor END AS keeper_actor,
    match_id, period_number, clock, event_type
  FROM bucket_pairs
  WHERE
    (a_x IS NULL) != (b_x IS NULL)
    AND LEAST(LENGTH(a_norm), LENGTH(b_norm)) >= 4
    AND LEFT(a_norm, 4) = LEFT(b_norm, 4)
)
SELECT 'MATCH 250 - would delete' AS action, junk_id, match_id, period_number, clock, event_type, junk_actor, keeper_actor
FROM deletable
ORDER BY period_number, clock DESC;

-- Section B: Match 463 — explicit junk IDs (second run of batch 186)
-- These 6 rows were inserted by a second run of the HMM re-ingest (batch 186)
-- after the original run already produced the canonical rows (lower IDs).
-- The prefix-4 rule does not apply cleanly to all pairs because OCR noise
-- affected the first character (H. vs R. prefix confusion in faceoff names,
-- O' vs U' in the shot actor). Explicit ID-based cleanup is the safe approach.
SELECT 'MATCH 463 - would delete' AS action, id, match_id, period_number, clock, event_type, actor_gamertag_snapshot
FROM match_events
WHERE id IN (429, 431, 432, 433, 434, 435)
ORDER BY period_number, clock DESC;

-- ============================================================================
-- DELETE (execute after verifying dry-run output above)
-- ============================================================================

BEGIN;

-- 1. Remove match_goal_events cascade rows (FK match_goal_events.event_id → match_events.id)
DELETE FROM match_goal_events WHERE event_id IN (426, 427, 428);

-- 2. Remove match_penalty_events cascade rows (none expected for these IDs, but safe to include)
DELETE FROM match_penalty_events WHERE event_id IN (426, 427, 428, 429, 431, 432, 433, 434, 435);

-- 3. Remove the junk match_events rows
-- Match 250: 3 junk goal rows
DELETE FROM match_events WHERE id IN (426, 427, 428);

-- Match 463: 6 junk rows (faceoffs + 1 shot)
DELETE FROM match_events WHERE id IN (429, 431, 432, 433, 434, 435);

-- Verification query (should show 0 rows for all deleted IDs)
SELECT id FROM match_events WHERE id IN (426, 427, 428, 429, 431, 432, 433, 434, 435);

COMMIT;

-- ============================================================================
-- POST-CLEANUP VERIFICATION
-- ============================================================================
-- Run after transaction commits to confirm dup bucket counts:

-- Match 250: should show exactly 1 bucket (P3 2:09 hit — WILDE + S.ZUBOV legit pair)
SELECT period_number, clock, event_type, COUNT(*) AS row_count,
  string_agg(actor_gamertag_snapshot, ' / ' ORDER BY id) AS actors
FROM match_events
WHERE match_id = 250 AND source='ocr' AND event_type IN ('goal','shot','hit','penalty')
GROUP BY period_number, clock, event_type
HAVING COUNT(*) > 1
ORDER BY period_number, clock DESC;

-- Match 463: should show exactly 1 bucket (P2 11:07 faceoff — M.RANTANEN + RANIANEN)
SELECT period_number, clock, event_type, COUNT(*) AS row_count,
  string_agg(actor_gamertag_snapshot, ' / ' ORDER BY id) AS actors
FROM match_events
WHERE match_id = 463 AND source='ocr' AND event_type IN ('goal','shot','hit','penalty','faceoff')
GROUP BY period_number, clock, event_type
HAVING COUNT(*) > 1
ORDER BY period_number, clock DESC;
