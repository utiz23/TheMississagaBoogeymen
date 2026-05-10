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

export type OcrCaptureKind = 'video_frames' | 'manual_screenshots' | 'post_game_bundle'

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

export type OcrTransformStatus = 'pending' | 'success' | 'error'
export type OcrReviewStatus = 'pending_review' | 'reviewed' | 'rejected'
export type OcrEntityType = 'match' | 'team' | 'player' | 'event' | 'loadout'
export type OcrFieldStatus = 'ok' | 'uncertain' | 'missing'

/**
 * Groups one game's worth of OCR captures into an import session.
 * match_id is nullable until reconciliation links the batch to a known match row.
 */
export const ocrCaptureBatches = pgTable('ocr_capture_batches', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  gameTitleId: integer('game_title_id')
    .notNull()
    .references(() => gameTitles.id),
  matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
  /** Filesystem directory or archive path containing source screenshots/frames. */
  sourceDirectory: text('source_directory'),
  captureKind: text('capture_kind').notNull().$type<OcrCaptureKind>(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
})

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
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ocr_extractions_batch_path_uniq').on(table.batchId, table.sourcePath),
    index('ocr_extractions_match_idx').on(table.matchId),
    index('ocr_extractions_review_idx').on(table.reviewStatus, table.transformStatus),
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
