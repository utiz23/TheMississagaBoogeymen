import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { type AnyPgColumn } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { matches } from './matches.js'
import { ocrDecoderRuns } from './ocr-decoder-runs.js'

export type OcrCaptureKind = 'video_frames' | 'manual_screenshots' | 'post_game_bundle'

/**
 * Legacy `ocr_extractions.screen_type` union. Phase-A appends
 * `player_loadout_landing` so the new landing screen produces an extraction
 * row even though no typed extractor runs on it. All other new v2 states
 * (`menu_club_management`, `menu_world_of_chel`) do NOT need to appear here —
 * they live only on the segment layer (`ocr_segments.state` via
 * `OcrSegmentState`) and never reach the dispatch path that writes
 * `ocr_extractions`.
 */
export type OcrScreenType =
  | 'pre_game_lobby_state_1'
  | 'pre_game_lobby_state_2'
  | 'player_loadout_view'
  | 'post_game_player_summary'
  | 'in_game_clock'
  | 'in_game_goal_state_1'
  | 'in_game_goal_state_2'
  | 'post_game_box_score_goals'
  | 'post_game_box_score_shots'
  | 'post_game_box_score_faceoffs'
  | 'post_game_events'
  | 'post_game_action_tracker'
  | 'post_game_faceoff_map'
  | 'post_game_net_chart'
  // Phase-A v2 addition
  | 'player_loadout_landing'

export type OcrTransformStatus = 'pending' | 'success' | 'error'
export type OcrReviewStatus = 'pending_review' | 'reviewed' | 'rejected'
export type OcrEntityType = 'match' | 'team' | 'player' | 'event' | 'loadout' | 'faceoff_dot'
export type OcrFieldStatus = 'ok' | 'uncertain' | 'missing'

/**
 * Groups one game's worth of OCR captures into an import session.
 * match_id is nullable until reconciliation links the batch to a known match row.
 * video_sha256 is set when frames came from a video; combined with
 * source_directory it makes re-ingests of the same video idempotent.
 */
export const ocrCaptureBatches = pgTable(
  'ocr_capture_batches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    /** Filesystem directory or archive path containing source screenshots/frames. */
    sourceDirectory: text('source_directory'),
    captureKind: text('capture_kind').notNull().$type<OcrCaptureKind>(),
    /** SHA-256 hex of the source video file; NULL for manual screenshots. */
    videoSha256: text('video_sha256'),
    /**
     * Phase-A: decoder run this batch belongs to. NULL for legacy / unmatched
     * batches (preserves single-NULL idempotency for non-reprocess ingests via
     * the NULLS NOT DISTINCT unique below).
     */
    runId: bigint('run_id', { mode: 'number' }).references(() => ocrDecoderRuns.id),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (table) => [
    // Phase-A: include run_id so v1 and v2 batches for the same video/dir
    // coexist as distinct rows. Generated migration is hand-edited to add
    // NULLS NOT DISTINCT, which preserves legacy idempotency for
    // non-reprocess ingests where run_id IS NULL (two such inserts still
    // collide and trigger the existing ingestOcrBatch onConflictDoUpdate
    // path on (video_sha256, source_directory)).
    uniqueIndex('ocr_capture_batches_video_sha_dir_run_uniq')
      .on(table.videoSha256, table.sourceDirectory, table.runId)
      .where(sql`${table.videoSha256} IS NOT NULL`),
    index('ocr_capture_batches_run_idx').on(table.runId),
  ],
)

/**
 * One row per screenshot or video frame processed by the OCR CLI.
 * raw_result_json always preserved regardless of parse quality.
 * review_status guards promotion — nothing is trusted until 'reviewed'.
 */
export const ocrExtractions = pgTable(
  'ocr_extractions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .references(() => ocrCaptureBatches.id),
    /** Set after reconciliation links this extraction to a known match. */
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    screenType: text('screen_type').notNull().$type<OcrScreenType>(),
    sourcePath: text('source_path').notNull(),
    /** SHA-256 hex of the source file for cross-batch deduplication. */
    sourceHash: text('source_hash'),
    ocrBackend: text('ocr_backend').notNull().default('rapidocr'),
    /** Average OCR confidence across all detected regions (0.0000–1.0000). */
    overallConfidence: numeric('overall_confidence', { precision: 5, scale: 4 }),
    rawResultJson: jsonb('raw_result_json').notNull(),
    transformStatus: text('transform_status')
      .notNull()
      .$type<OcrTransformStatus>()
      .default('pending'),
    transformError: text('transform_error'),
    reviewStatus: text('review_status')
      .notNull()
      .$type<OcrReviewStatus>()
      .default('pending_review'),
    /** Points to the canonical extraction when this row is a detected duplicate. */
    duplicateOfExtractionId: bigint('duplicate_of_extraction_id', {
      mode: 'number',
    }).references((): AnyPgColumn => ocrExtractions.id),
    /**
     * Phase-A: decoder run this extraction belongs to. NULL for legacy /
     * unmatched batches. Uniqueness on (batch_id, source_path) already
     * discriminates per run transitively via ocr_capture_batches.run_id.
     */
    runId: bigint('run_id', { mode: 'number' }).references(() => ocrDecoderRuns.id),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ocr_extractions_batch_path_uniq').on(table.batchId, table.sourcePath),
    index('ocr_extractions_match_idx').on(table.matchId),
    index('ocr_extractions_review_idx').on(table.reviewStatus, table.transformStatus),
    index('ocr_extractions_run_idx').on(table.runId),
  ],
)

/**
 * One row per parsed field from an OCR extraction.
 * Granular confidence + status tracking lets review tooling surface uncertain
 * or missing fields without re-inspecting the whole extraction.
 *
 * entity_key semantics by entity_type:
 *   player  → gamertag string or slot index string ("0", "1", "silkyjoker85")
 *   team    → "home" or "away"
 *   match   → null (applies to the whole match)
 *   event   → sequential index string ("0", "1", ...)
 *   loadout → null (one loadout per extraction)
 */
export const ocrExtractionFields = pgTable(
  'ocr_extraction_fields',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    extractionId: bigint('extraction_id', { mode: 'number' })
      .notNull()
      .references(() => ocrExtractions.id),
    entityType: text('entity_type').notNull().$type<OcrEntityType>(),
    entityKey: text('entity_key'),
    fieldKey: text('field_key').notNull(),
    rawText: text('raw_text'),
    /** Typed parsed value: string, number, boolean, or object. */
    parsedValueJson: jsonb('parsed_value_json'),
    /** Per-field OCR confidence (0.0000–1.0000). */
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    status: text('status').notNull().$type<OcrFieldStatus>().default('ok'),
    /** Set when this field's value has been promoted into a canonical table. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
  },
  (table) => [
    index('ocr_extraction_fields_extraction_idx').on(table.extractionId),
    index('ocr_extraction_fields_promoted_idx').on(table.promotedAt),
  ],
)

export type OcrCaptureBatch = typeof ocrCaptureBatches.$inferSelect
export type NewOcrCaptureBatch = typeof ocrCaptureBatches.$inferInsert
export type OcrExtraction = typeof ocrExtractions.$inferSelect
export type NewOcrExtraction = typeof ocrExtractions.$inferInsert
export type OcrExtractionField = typeof ocrExtractionFields.$inferSelect
export type NewOcrExtractionField = typeof ocrExtractionFields.$inferInsert
