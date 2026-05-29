-- Migration: relax NOT NULL on ocr_run_quality_reports layer hot columns
--
-- Codex P1-2: layer scores (L2 / L2.5 / L3) computed via computeLayers
-- against match-scoped DB state only reflect the run's actual contribution
-- when that run IS the active run for the match. For inactive / superseded
-- runs (--all-runs backfill, historical comparisons) the scores would be
-- the canonical state, not the run's. The fix is to skip layer compute
-- when isActive=false and persist NULLs.
--
-- The CHECK (col BETWEEN 0 AND 1) constraints from 0050 already permit
-- NULL (NULL BETWEEN 0 AND 1 is UNKNOWN, which passes a CHECK). No
-- constraint changes needed.
--
-- Idempotent: ALTER COLUMN DROP NOT NULL on an already-nullable column
-- is a no-op in Postgres 16.

BEGIN;

ALTER TABLE "ocr_run_quality_reports"
  ALTER COLUMN "overall_pass" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "ocr_run_quality_reports"
  ALTER COLUMN "l2_score" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "ocr_run_quality_reports"
  ALTER COLUMN "l2_lineup_score" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "ocr_run_quality_reports"
  ALTER COLUMN "l3_score" DROP NOT NULL;
--> statement-breakpoint

COMMIT;
