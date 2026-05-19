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
import { matches } from './matches.js'

/**
 * Phase 0 of the OCR-pipeline redesign (plan-redesign-ocr-pipeline-2026-05-19).
 *
 * Three intermediate tables between extraction and canonical promotion. Lives
 * beside the legacy `ocr-pipeline.ts` schema during migration; no canonical
 * write paths reference these yet.
 *
 * See docs/calibration/redesign-round-4-codex-synthesis-2026-05-19.md §6 for
 * the column-shape source of truth.
 */

/**
 * Round 4 §4 — 17 explicit screen states for the HMM/Viterbi decoder.
 * Extends the legacy `OcrScreenType` (14 entries) with the missing
 * `unknown_or_transition`, `loading_or_intro`, `end_of_video` states.
 * Kept as a distinct type so the legacy enum stays frozen during migration.
 */
export type OcrSegmentState =
  | 'unknown_or_transition'
  | 'pre_game_lobby_state_1'
  | 'pre_game_lobby_state_2'
  | 'player_loadout_view'
  | 'loading_or_intro'
  | 'in_game_clock'
  | 'in_game_goal_state_1'
  | 'in_game_goal_state_2'
  | 'post_game_player_summary'
  | 'post_game_box_score_goals'
  | 'post_game_box_score_shots'
  | 'post_game_box_score_faceoffs'
  | 'post_game_events'
  | 'post_game_action_tracker'
  | 'post_game_faceoff_map'
  | 'post_game_net_chart'
  | 'end_of_video'

/** Five extractor families from Round 4 §5. */
export type OcrExtractorFamily =
  | 'open_text'
  | 'closed_vocab'
  | 'tabular_numeric'
  | 'icon'
  | 'geometry'

/** Whether the source recording actually contained observable evidence. */
export type OcrObservabilityStatus =
  | 'observable'
  | 'not_observable_from_source'
  | 'obstructed'
  | 'low_quality'

export type OcrNormalizationStatus = 'normalized' | 'unnormalized' | 'failed'

/** Promotion decision outcome, per Round 4 §6 blocking conditions. */
export type OcrPromotionStatus =
  | 'promoted'
  | 'blocked_observability'
  | 'blocked_consensus'
  | 'blocked_invariant'
  | 'blocked_authority'

/** Which source won at the promotion gate. */
export type OcrAuthoritySource = 'manual_truth' | 'ea_api' | 'ocr_evidence'

/**
 * One row per decoded screen segment OR HUD interval from Pass-1 (HMM/Viterbi
 * in Phase 1; populated by an adapter over the legacy run-length segmenter
 * during Phase 0). Replaces the implicit "what screen did Pass-1 think it was
 * looking at" knowledge that today lives only in segments.json on disk.
 */
export const ocrSegments = pgTable(
  'ocr_segments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    /** Stable per-match segment key produced by the decoder (e.g. "seg-007"). */
    segmentKey: text('segment_key').notNull(),
    state: text('state').notNull().$type<OcrSegmentState>(),
    /** Frame timestamps in seconds from video start (NULL for manual-screenshot ingest). */
    tStartSec: numeric('t_start_sec', { precision: 10, scale: 3 }),
    tEndSec: numeric('t_end_sec', { precision: 10, scale: 3 }),
    frameCount: integer('frame_count').notNull().default(0),
    /** Pass-1 decoder posterior over the assigned state (0.0000–1.0000). */
    segmentConfidence: numeric('segment_confidence', { precision: 5, scale: 4 }),
    observabilityStatus: text('observability_status')
      .notNull()
      .$type<OcrObservabilityStatus>()
      .default('observable'),
    /** Game version label (e.g. "nhl26") for per-version asset versioning. */
    uiVersion: text('ui_version').notNull(),
    /** Pass-1 decoder + state-machine YAML sha for reproducibility. */
    decoderVersion: text('decoder_version').notNull(),
    /** Provenance: which capture batch (legacy `ocr_capture_batches`) this segment came from. */
    captureBatchId: bigint('capture_batch_id', { mode: 'number' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ocr_segments_match_segment_uniq').on(table.matchId, table.segmentKey),
    index('ocr_segments_match_state_idx').on(table.matchId, table.state),
    index('ocr_segments_state_observability_idx').on(table.state, table.observabilityStatus),
  ],
)

/**
 * One row per candidate claim about one semantic field from one extractor
 * invocation. Append-only within a run. Competing hypotheses live as separate
 * rows distinguished by candidate_rank.
 *
 * Round 4 §6 columns: match_id, segment_id, screen_state, screen_instance_key,
 * field_key, field_family, candidate_value, candidate_rank, raw_confidence,
 * calibrated_confidence, support_frame_ids, roi_bbox, template_version,
 * extractor_family, extractor_version, observability_status, normalization_status,
 * plus row_key/column_key for tables, x_norm/y_norm/shape_or_icon_class for
 * geometry, subject_slot_key for entity-bearing rows.
 */
export const ocrFieldEvidence = pgTable(
  'ocr_field_evidence',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    /** Segment this evidence was extracted from (NULL for HUD intervals not yet bundled). */
    segmentId: bigint('segment_id', { mode: 'number' }).references(() => ocrSegments.id),
    screenState: text('screen_state').notNull().$type<OcrSegmentState>(),
    /** Disambiguates multiple instances of the same screen state within a match
     *  (e.g. P1/P2/P3/OT box-score tabs). Free-form string keyed by the extractor. */
    screenInstanceKey: text('screen_instance_key'),
    /** Slot/row identity for entity-bearing rows (e.g. "loadout_slot_3", "event_42"). */
    subjectSlotKey: text('subject_slot_key'),
    /** Semantic field identity (e.g. "build_class", "scorer_gamertag", "shots"). */
    fieldKey: text('field_key').notNull(),
    fieldFamily: text('field_family').notNull().$type<OcrExtractorFamily>(),
    /** Normalized candidate value (string / number / object). */
    candidateValue: jsonb('candidate_value'),
    /** Rank among candidates for the same (segment, field, instance, slot). 0 = top. */
    candidateRank: integer('candidate_rank').notNull().default(0),
    rawConfidence: numeric('raw_confidence', { precision: 5, scale: 4 }),
    calibratedConfidence: numeric('calibrated_confidence', { precision: 5, scale: 4 }),
    /** Array of `ocr_extractions.id` frames that contributed to this candidate. */
    supportFrameIds: bigint('support_frame_ids', { mode: 'number' }).array(),
    /** ROI in normalised template coordinates: {x, y, w, h} all in [0,1]. */
    roiBbox: jsonb('roi_bbox'),
    /** Per-version screen template id used for ROI alignment. */
    templateVersion: text('template_version'),
    extractorFamily: text('extractor_family').notNull().$type<OcrExtractorFamily>(),
    /** Extractor code version (git sha or semver tag). */
    extractorVersion: text('extractor_version').notNull(),
    observabilityStatus: text('observability_status')
      .notNull()
      .$type<OcrObservabilityStatus>()
      .default('observable'),
    normalizationStatus: text('normalization_status')
      .notNull()
      .$type<OcrNormalizationStatus>()
      .default('normalized'),
    /** Table-extractor columns. */
    rowKey: text('row_key'),
    columnKey: text('column_key'),
    /** Geometry-extractor columns: normalised rink-coordinate position. */
    xNorm: numeric('x_norm', { precision: 6, scale: 4 }),
    yNorm: numeric('y_norm', { precision: 6, scale: 4 }),
    shapeOrIconClass: text('shape_or_icon_class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ocr_field_evidence_match_field_idx').on(table.matchId, table.fieldKey),
    index('ocr_field_evidence_segment_idx').on(table.segmentId),
    index('ocr_field_evidence_promotion_lookup_idx').on(
      table.matchId,
      table.screenState,
      table.fieldKey,
      table.subjectSlotKey,
      table.candidateRank,
    ),
  ],
)

/**
 * Result of consensus + promotion. "Not promoted" is itself an inspectable
 * fact — blocked rows record which condition fired so triage can pick them up
 * without re-running the gate.
 *
 * Round 4 §6: target_table, target_semantic_key, winning_value, winning_confidence,
 * evidence_count, conflict_count, blocking_reason, authority_source.
 */
export const ocrPromotions = pgTable(
  'ocr_promotions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    /** Canonical Postgres table the promotion targeted (e.g. "player_loadout_snapshots"). */
    targetTable: text('target_table').notNull(),
    /** Composite key identifying the target row (e.g. {match_id, slot_index}). */
    targetSemanticKey: jsonb('target_semantic_key').notNull(),
    /** Semantic field being promoted; NULL when promotion is whole-row. */
    fieldKey: text('field_key'),
    winningValue: jsonb('winning_value'),
    winningConfidence: numeric('winning_confidence', { precision: 5, scale: 4 }),
    /** Number of evidence rows that voted for the winner. */
    evidenceCount: integer('evidence_count').notNull().default(0),
    /** Number of candidate values that exceeded the calibrated-confidence floor. */
    conflictCount: integer('conflict_count').notNull().default(0),
    /** All `ocr_field_evidence.id` rows that participated in this decision. */
    evidenceIds: bigint('evidence_ids', { mode: 'number' }).array(),
    promotionStatus: text('promotion_status').notNull().$type<OcrPromotionStatus>(),
    /** Free-form explanation when promotionStatus is one of the blocked_* variants. */
    blockingReason: text('blocking_reason'),
    authoritySource: text('authority_source').$type<OcrAuthoritySource>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ocr_promotions_target_uniq').on(
      table.targetTable,
      sql`(target_semantic_key::text)`,
      table.fieldKey,
    ),
    index('ocr_promotions_match_status_idx').on(table.matchId, table.promotionStatus),
    index('ocr_promotions_blocked_idx').on(table.promotionStatus, table.matchId),
  ],
)

export type OcrSegment = typeof ocrSegments.$inferSelect
export type NewOcrSegment = typeof ocrSegments.$inferInsert
export type OcrFieldEvidence = typeof ocrFieldEvidence.$inferSelect
export type NewOcrFieldEvidence = typeof ocrFieldEvidence.$inferInsert
export type OcrPromotion = typeof ocrPromotions.$inferSelect
export type NewOcrPromotion = typeof ocrPromotions.$inferInsert
