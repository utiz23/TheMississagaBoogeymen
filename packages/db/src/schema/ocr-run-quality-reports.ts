import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { matches } from './matches.js'
import { ocrDecoderRuns } from './ocr-decoder-runs.js'

/**
 * One row per `ocr_decoder_runs.id` — captures the run-level quality report
 * produced by the OCR pipeline's L1/L2/L3 scoring harness.
 *
 * Observability-only: this table is never read by canonical metric paths.
 * Aggregated scores live in dedicated columns so trend queries (recent runs
 * per match, cross-match recent runs) stay cheap; the full structured report
 * is preserved verbatim in `report` (jsonb) for forensic / drill-down work.
 *
 * The `report` body's schema is owned by the Phase-3 CLI that writes these
 * rows. Once that CLI lands, point here at its
 * `tools/game_ocr/quality_report/...` schema docstring for the canonical
 * shape. Until then, treat the jsonb as opaque from the DB layer's POV.
 *
 * Lifecycle:
 *   - Rows are append-only. There is no deletion path — observability
 *     artifacts persist for trend analysis across decoder versions.
 *   - FK to `ocr_decoder_runs` is one-way with no CASCADE; if a run row is
 *     ever removed (not expected), the quality-report rows must be cleaned
 *     up explicitly first.
 *   - `matchId` is denormalized from `ocr_decoder_runs.match_id` so the
 *     common "recent quality reports for match X" query doesn't have to
 *     join through `ocr_decoder_runs`.
 *
 * Score columns:
 *   - `l1Score` is nullable: ground-truth fixtures for L1 may not exist
 *     yet at the time the report is produced.
 *   - `l2Score`, `l2LineupScore`, `l3Score` are required.
 *   - `totalWallMs` is nullable: backfilled rows (synthetic / historical
 *     re-scoring) have no real runtime to attribute.
 */
export const ocrRunQualityReports = pgTable(
  'ocr_run_quality_reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => ocrDecoderRuns.id),
    /** Denormalized from ocr_decoder_runs.match_id for cheap match-scoped reads. */
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Bumped whenever the structural shape of `report` changes. */
    schemaVersion: smallint('schema_version').notNull(),
    overallPass: boolean('overall_pass').notNull(),
    /** NULL when L1 ground-truth fixtures are not yet available. */
    l1Score: numeric('l1_score', { precision: 5, scale: 4 }),
    l2Score: numeric('l2_score', { precision: 5, scale: 4 }).notNull(),
    l2LineupScore: numeric('l2_lineup_score', { precision: 5, scale: 4 }).notNull(),
    l3Score: numeric('l3_score', { precision: 5, scale: 4 }).notNull(),
    /** NULL for backfilled / synthetic rescoring rows with no real runtime. */
    totalWallMs: bigint('total_wall_ms', { mode: 'number' }),
    totalSegments: integer('total_segments').notNull(),
    totalDemoted: integer('total_demoted').notNull(),
    totalUnresolved: integer('total_unresolved').notNull(),
    /** Full structured report; shape owned by the Phase-3 quality-report CLI. */
    report: jsonb('report').notNull(),
  },
  (table) => [
    // One quality report per run.
    uniqueIndex('ocr_run_quality_reports_run_id_uniq').on(table.runId),
    // Match-scoped recency. Drizzle 0.45 .on() doesn't take DESC; the
    // generated migration SQL hand-adds DESC on generated_at for proper
    // trend ordering.
    index('ocr_run_quality_reports_match_generated_idx').on(table.matchId, table.generatedAt),
    // Cross-match recency for global "latest runs" dashboards.
    index('ocr_run_quality_reports_generated_idx').on(table.generatedAt),
  ],
)

export type OcrRunQualityReport = typeof ocrRunQualityReports.$inferSelect
export type NewOcrRunQualityReport = typeof ocrRunQualityReports.$inferInsert
