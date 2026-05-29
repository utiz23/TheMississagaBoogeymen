-- Migration: add ocr_run_quality_reports — run-level quality reporting
-- Phase 1 (schema + migration) of the Run-Level Quality Reporting workstream.
--
-- Source docs:
--   * Architecture review §6: docs/research/video-extraction-architecture-review-2026-05-28.md
--   * Approved plan: /home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md
--
-- One row per ocr_decoder_runs.id captures the L1/L2/L3 quality-report
-- output of a single OCR run. Aggregate scores live in dedicated columns
-- for cheap trend queries (recent runs per match, cross-match recent
-- runs); the full structured report is preserved verbatim in the
-- `report` jsonb column for drill-down / forensic work.
--
-- Observability-only: never read on canonical metric paths. FKs to
-- ocr_decoder_runs and matches are one-way with NO CASCADE — quality
-- artifacts persist past any (unexpected) run-row deletion until
-- explicitly cleaned up.
--
-- Idempotent via IF NOT EXISTS guards; runs in a single transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS "ocr_run_quality_reports" (
  "id"                  bigserial PRIMARY KEY,
  "run_id"              bigint NOT NULL REFERENCES "ocr_decoder_runs"("id"),
  "match_id"            bigint NOT NULL REFERENCES "matches"("id"),
  "generated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "schema_version"      smallint NOT NULL,
  "overall_pass"        boolean NOT NULL,
  "l1_score"            numeric(5,4),
  "l2_score"            numeric(5,4) NOT NULL,
  "l2_lineup_score"     numeric(5,4) NOT NULL,
  "l3_score"            numeric(5,4) NOT NULL,
  "total_wall_ms"       bigint,
  "total_segments"      integer NOT NULL,
  "total_demoted"       integer NOT NULL,
  "total_unresolved"    integer NOT NULL,
  "report"              jsonb NOT NULL
);
--> statement-breakpoint

-- One quality report per run.
CREATE UNIQUE INDEX IF NOT EXISTS "ocr_run_quality_reports_run_id_uniq"
  ON "ocr_run_quality_reports" ("run_id");
--> statement-breakpoint

-- Match-scoped recency: hand-edited DESC on generated_at so "most recent
-- reports for match X" trend queries can index-scan in order.
CREATE INDEX IF NOT EXISTS "ocr_run_quality_reports_match_generated_idx"
  ON "ocr_run_quality_reports" ("match_id", "generated_at" DESC);
--> statement-breakpoint

-- Cross-match recency for global "latest runs" dashboards.
CREATE INDEX IF NOT EXISTS "ocr_run_quality_reports_generated_idx"
  ON "ocr_run_quality_reports" ("generated_at" DESC);
--> statement-breakpoint

COMMENT ON TABLE "ocr_run_quality_reports" IS
  'Run-level OCR quality reports — one row per ocr_decoder_runs.id. Captures L1/L2/L3 aggregate scores (numeric columns for cheap trend queries) plus the full structured report (jsonb). Observability-only: never read on canonical metric paths. Append-only; FKs to ocr_decoder_runs and matches are one-way with NO CASCADE. The report jsonb shape is owned by the Phase-3 quality-report CLI (tools/game_ocr/...) — bump schema_version when that shape changes. See docs/research/video-extraction-architecture-review-2026-05-28.md §6.';

COMMIT;
