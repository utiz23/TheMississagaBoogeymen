-- Migration: Phase-A — ocr_decoder_runs + run_id propagation + backfill
-- Plan: docs/superpowers/specs/screen-classifier-v2.md (a.k.a. /home/michal/.claude/plans/multi-session-strategic-fix-for-misty-hamster.md)
--
-- Adds:
--   * new ocr_decoder_runs table (one row per pass1+pass2 invocation per match)
--   * run_id column on 5 tables (ocr_capture_batches, ocr_segments,
--     ocr_field_evidence, ocr_extractions, ocr_promotions)
--   * uniqueness changes (incl. NULLS NOT DISTINCT) so v1+v2 rows coexist
-- Then backfills:
--   * one synthetic "legacy" run per match with at least one match-linked batch
--   * cascades run_id onto all match-linked existing rows
--   * unmatched batches (match_id IS NULL) keep run_id IS NULL
--
-- Idempotent: uses IF NOT EXISTS / IF EXISTS guards where possible. The full
-- migration runs in a single transaction; on error nothing is applied.

BEGIN;

-- ─── 1. ocr_decoder_runs table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ocr_decoder_runs" (
  "id"               bigserial PRIMARY KEY,
  "match_id"         bigint NOT NULL REFERENCES "matches"("id"),
  "video_sha256"     text,
  "decoder_version"  text NOT NULL,
  "weights_hash"     text NOT NULL,
  "config_hash"      text NOT NULL,
  "started_at"       timestamptz NOT NULL DEFAULT now(),
  "completed_at"     timestamptz,
  "is_active"        boolean NOT NULL DEFAULT false,
  "notes"            text
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ocr_decoder_runs_provenance_uniq"
  ON "ocr_decoder_runs"
  ("match_id", "video_sha256", "decoder_version", "weights_hash")
  NULLS NOT DISTINCT;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ocr_decoder_runs_one_active_per_match"
  ON "ocr_decoder_runs" ("match_id")
  WHERE "is_active" = true;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ocr_decoder_runs_match_idx"
  ON "ocr_decoder_runs" ("match_id");
--> statement-breakpoint

-- ─── 2. run_id columns on the 5 data tables ───────────────────────────────────
ALTER TABLE "ocr_capture_batches"
  ADD COLUMN IF NOT EXISTS "run_id" bigint REFERENCES "ocr_decoder_runs"("id");
--> statement-breakpoint
ALTER TABLE "ocr_segments"
  ADD COLUMN IF NOT EXISTS "run_id" bigint REFERENCES "ocr_decoder_runs"("id");
--> statement-breakpoint
ALTER TABLE "ocr_field_evidence"
  ADD COLUMN IF NOT EXISTS "run_id" bigint REFERENCES "ocr_decoder_runs"("id");
--> statement-breakpoint
ALTER TABLE "ocr_extractions"
  ADD COLUMN IF NOT EXISTS "run_id" bigint REFERENCES "ocr_decoder_runs"("id");
--> statement-breakpoint
ALTER TABLE "ocr_promotions"
  ADD COLUMN IF NOT EXISTS "run_id" bigint REFERENCES "ocr_decoder_runs"("id");
--> statement-breakpoint

-- Lookup indexes for the run_id columns
CREATE INDEX IF NOT EXISTS "ocr_capture_batches_run_idx" ON "ocr_capture_batches" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ocr_segments_run_idx"        ON "ocr_segments"        ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ocr_field_evidence_run_idx"  ON "ocr_field_evidence"  ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ocr_extractions_run_idx"     ON "ocr_extractions"     ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ocr_promotions_run_idx"      ON "ocr_promotions"      ("run_id");
--> statement-breakpoint

-- ─── 3. Uniqueness changes (replace existing uniques with run-aware versions) ─

-- ocr_capture_batches: was (video_sha256, source_directory) WHERE video_sha256 IS NOT NULL
-- Now: (video_sha256, source_directory, run_id) WHERE video_sha256 IS NOT NULL, NULLS NOT DISTINCT
-- The NULLS NOT DISTINCT preserves legacy idempotency for non-reprocess ingests
-- where run_id IS NULL (two such inserts still collide, matching the existing
-- ingestOcrBatch onConflictDoUpdate path on (video_sha256, source_directory)).
DROP INDEX IF EXISTS "ocr_capture_batches_video_sha_dir_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ocr_capture_batches_video_sha_dir_run_uniq"
  ON "ocr_capture_batches" ("video_sha256", "source_directory", "run_id")
  NULLS NOT DISTINCT
  WHERE "video_sha256" IS NOT NULL;
--> statement-breakpoint

-- ocr_segments: was (match_id, segment_key); now (match_id, segment_key, run_id), NULLS NOT DISTINCT
DROP INDEX IF EXISTS "ocr_segments_match_segment_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ocr_segments_match_segment_run_uniq"
  ON "ocr_segments" ("match_id", "segment_key", "run_id")
  NULLS NOT DISTINCT;
--> statement-breakpoint

-- ocr_promotions: was (target_table, target_semantic_key::text, field_key)
-- Now: (target_table, target_semantic_key::text, field_key, run_id), NULLS NOT DISTINCT
-- Critical: without run_id in the unique key, the second run for the same
-- (target_table, slot, field) collides and either upserts (destroying the v1
-- promotion) or fails. NULLS NOT DISTINCT keeps legacy single-NULL identity.
DROP INDEX IF EXISTS "ocr_promotions_target_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ocr_promotions_target_run_uniq"
  ON "ocr_promotions" ("target_table", (target_semantic_key::text), "field_key", "run_id")
  NULLS NOT DISTINCT;
--> statement-breakpoint

-- ─── 4. Pre-backfill row-count snapshot (for "no data destroyed" assertion) ──
-- TEMP table lives only for the duration of this transaction. Captures the
-- row counts of the five affected tables BEFORE any backfill runs. The DO
-- block at the end of the migration compares these to post-backfill counts
-- and ROLLBACKs if any table's count diverges (UPDATE shouldn't change counts;
-- this catches accidental DELETE or constraint-violation insert paths).
CREATE TEMP TABLE _migration_0048_pre_counts (
  table_name text PRIMARY KEY,
  row_count  bigint NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint

INSERT INTO _migration_0048_pre_counts (table_name, row_count) VALUES
  ('ocr_capture_batches', (SELECT COUNT(*) FROM ocr_capture_batches)),
  ('ocr_segments',        (SELECT COUNT(*) FROM ocr_segments)),
  ('ocr_field_evidence',  (SELECT COUNT(*) FROM ocr_field_evidence)),
  ('ocr_extractions',     (SELECT COUNT(*) FROM ocr_extractions)),
  ('ocr_promotions',      (SELECT COUNT(*) FROM ocr_promotions));
--> statement-breakpoint

-- ─── 5. Backfill: one synthetic legacy run per match with match-linked data ──
--
-- Honest provenance rules (see plan §"Provenance semantics for video_sha256"):
--   single video sha across match's batches → use it
--   multiple video shas, OR mixed video+manual → video_sha256 = NULL with notes
--   manual-only                              → video_sha256 = NULL with notes
--
-- decoder_version follows the same honesty rule (plan Codex round 5):
--   single distinct decoder_version across match's ocr_segments → use it
--   multiple                                                    → 'legacy-mixed' with notes
--
-- Weights/config hashes capture the CURRENT decoder state, with a notes caveat —
-- the legacy ingest didn't record per-run weights so this is best-effort.
WITH match_provenance AS (
  SELECT
    b.match_id,
    array_agg(DISTINCT b.video_sha256) AS video_shas,
    bool_or(b.video_sha256 IS NULL) AS has_manual,
    MIN(b.imported_at) AS earliest_imported,
    MAX(b.imported_at) AS latest_imported
  FROM ocr_capture_batches b
  WHERE b.match_id IS NOT NULL
  GROUP BY b.match_id
),
match_decoders AS (
  SELECT
    s.match_id,
    array_agg(DISTINCT s.decoder_version) FILTER (WHERE s.decoder_version IS NOT NULL) AS decoder_versions
  FROM ocr_segments s
  WHERE s.match_id IS NOT NULL
  GROUP BY s.match_id
),
match_combined AS (
  SELECT
    mp.match_id,
    -- video_sha256: single distinct non-null sha + no manual → that sha; else NULL
    CASE
      WHEN array_length(mp.video_shas, 1) = 1
        AND mp.video_shas[1] IS NOT NULL
        AND NOT mp.has_manual
      THEN mp.video_shas[1]
      ELSE NULL
    END AS chosen_sha,
    -- decoder_version: single distinct → that value; multiple → 'legacy-mixed'; none → 'unknown'
    CASE
      WHEN md.decoder_versions IS NULL OR array_length(md.decoder_versions, 1) = 0 THEN 'unknown'
      WHEN array_length(md.decoder_versions, 1) = 1 THEN md.decoder_versions[1]
      ELSE 'legacy-mixed'
    END AS chosen_decoder,
    md.decoder_versions,
    mp.video_shas,
    mp.has_manual,
    mp.earliest_imported,
    mp.latest_imported
  FROM match_provenance mp
  LEFT JOIN match_decoders md USING (match_id)
)
INSERT INTO ocr_decoder_runs (
  match_id, video_sha256, decoder_version, weights_hash, config_hash,
  started_at, completed_at, is_active, notes
)
SELECT
  mc.match_id,
  mc.chosen_sha,
  mc.chosen_decoder,
  'synthetic-backfill-no-weights-hash' AS weights_hash,
  'synthetic-backfill-no-config-hash'  AS config_hash,
  mc.earliest_imported,
  mc.latest_imported,
  true AS is_active,
  format(
    'synthetic backfill 2026-05-24: videos=[%s] decoders=[%s] has_manual=%s — weights/config hashes are placeholders (legacy ingest did not record them; see ocr_capture_batches.run_id = this run for actual source provenance)',
    COALESCE(array_to_string(mc.video_shas, ', '), 'none'),
    COALESCE(array_to_string(mc.decoder_versions, ', '), 'none'),
    mc.has_manual::text
  ) AS notes
FROM match_combined mc;
--> statement-breakpoint

-- Cascade run_id onto match-linked rows across all 5 tables. Rows whose batches
-- have match_id IS NULL keep run_id IS NULL (legacy / unmatched scope).
UPDATE ocr_capture_batches AS b
SET run_id = r.id
FROM ocr_decoder_runs r
WHERE b.match_id = r.match_id
  AND b.match_id IS NOT NULL
  AND r.is_active = true
  AND b.run_id IS NULL;
--> statement-breakpoint

UPDATE ocr_segments AS s
SET run_id = r.id
FROM ocr_decoder_runs r
WHERE s.match_id = r.match_id
  AND s.match_id IS NOT NULL
  AND r.is_active = true
  AND s.run_id IS NULL;
--> statement-breakpoint

UPDATE ocr_field_evidence AS e
SET run_id = r.id
FROM ocr_decoder_runs r
WHERE e.match_id = r.match_id
  AND e.match_id IS NOT NULL
  AND r.is_active = true
  AND e.run_id IS NULL;
--> statement-breakpoint

UPDATE ocr_extractions AS x
SET run_id = r.id
FROM ocr_decoder_runs r
WHERE x.match_id = r.match_id
  AND x.match_id IS NOT NULL
  AND r.is_active = true
  AND x.run_id IS NULL;
--> statement-breakpoint

UPDATE ocr_promotions AS p
SET run_id = r.id
FROM ocr_decoder_runs r
WHERE p.match_id = r.match_id
  AND p.match_id IS NOT NULL
  AND r.is_active = true
  AND p.run_id IS NULL;
--> statement-breakpoint

-- ─── 6. Sanity checks (RAISE EXCEPTION → ROLLBACK on any failure) ────────────
-- "Fail closed": every invariant below must hold, or the entire migration
-- (including the new table + columns + index swaps) is rolled back.
DO $$
DECLARE
  v_matches_with_data int;
  v_matches_with_active_run int;
  v_match_linked_count bigint;
  v_unmatched_count bigint;
  v_table_name text;
  v_pre bigint;
  v_post bigint;
BEGIN
  -- ── 6a. Exactly one active run per match with match-linked batches ──────────
  SELECT COUNT(DISTINCT match_id) INTO v_matches_with_data
    FROM ocr_capture_batches WHERE match_id IS NOT NULL;
  SELECT COUNT(*) INTO v_matches_with_active_run
    FROM (
      SELECT match_id, COUNT(*) FILTER (WHERE is_active) AS active_runs
      FROM ocr_decoder_runs GROUP BY match_id
    ) sub WHERE active_runs = 1;
  IF v_matches_with_data != v_matches_with_active_run THEN
    RAISE EXCEPTION 'Backfill mismatch: % matches with data, % with exactly-one-active-run',
      v_matches_with_data, v_matches_with_active_run;
  END IF;

  -- ── 6b. run_id propagation across ALL FIVE affected tables ──────────────────
  -- For each table, assert: rows where match_id IS NOT NULL all have run_id set,
  -- and rows where match_id IS NULL all have run_id NULL. Done in a loop over
  -- the five tables to avoid five copy-pasted blocks.
  FOR v_table_name IN
    SELECT unnest(ARRAY[
      'ocr_capture_batches',
      'ocr_segments',
      'ocr_field_evidence',
      'ocr_extractions',
      'ocr_promotions'
    ])
  LOOP
    -- Match-linked rows without run_id (must be 0)
    EXECUTE format(
      'SELECT COUNT(*) FROM %I WHERE match_id IS NOT NULL AND run_id IS NULL',
      v_table_name
    ) INTO v_match_linked_count;
    IF v_match_linked_count > 0 THEN
      RAISE EXCEPTION 'Backfill mismatch in %: % match-linked rows still have run_id IS NULL',
        v_table_name, v_match_linked_count;
    END IF;

    -- Unmatched rows incorrectly assigned run_id (must be 0)
    EXECUTE format(
      'SELECT COUNT(*) FROM %I WHERE match_id IS NULL AND run_id IS NOT NULL',
      v_table_name
    ) INTO v_unmatched_count;
    IF v_unmatched_count > 0 THEN
      RAISE EXCEPTION 'Backfill mismatch in %: % unmatched rows incorrectly got run_id',
        v_table_name, v_unmatched_count;
    END IF;
  END LOOP;

  -- ── 6c. Row-count preservation (no data destroyed) ──────────────────────────
  -- UPDATE shouldn't change row counts; we capture pre-counts before any work
  -- and compare here. Any divergence means rows were unexpectedly added/dropped.
  FOR v_table_name IN
    SELECT unnest(ARRAY[
      'ocr_capture_batches',
      'ocr_segments',
      'ocr_field_evidence',
      'ocr_extractions',
      'ocr_promotions'
    ])
  LOOP
    SELECT row_count INTO v_pre FROM _migration_0048_pre_counts WHERE table_name = v_table_name;
    EXECUTE format('SELECT COUNT(*) FROM %I', v_table_name) INTO v_post;
    IF v_pre != v_post THEN
      RAISE EXCEPTION 'Row count changed for %: pre=% post=% (UPDATE should not add/drop rows)',
        v_table_name, v_pre, v_post;
    END IF;
  END LOOP;

  -- ── 6d. No orphaned active runs: every active run must own at least one
  --        ocr_capture_batches row. (We only check the batch table — that's
  --        the root of the cascade; downstream tables flow from batches via
  --        match_id and are covered by the run_id propagation check in 6b.)
  IF EXISTS (
    SELECT 1 FROM ocr_decoder_runs r
    WHERE r.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM ocr_capture_batches b
        WHERE b.run_id = r.id
      )
  ) THEN
    RAISE EXCEPTION 'Orphaned active run: at least one ocr_decoder_runs row has no child ocr_capture_batches rows';
  END IF;
END $$;
--> statement-breakpoint

COMMIT;
