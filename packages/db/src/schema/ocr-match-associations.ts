import {
  bigint,
  bigserial,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { matches } from './matches.js'
import { ocrDecoderRuns } from './ocr-decoder-runs.js'

/**
 * Association status enum. Mirrors the review-queue lifecycle used by
 * `ocr_capture_batches.review_status` / `ingest-ocr-review-cli`:
 *   - `pending`   — a scorer proposal awaiting operator decision
 *   - `confirmed` — operator accepted; `ocr_capture_batches.match_id` stamped
 *   - `rejected`  — operator declined; no stamp performed
 */
export type OcrAssociationStatus = 'pending' | 'confirmed' | 'rejected'

/**
 * One row per reel awaiting reel→match_id association (Milestone ② ASSOCIATE
 * of the OCR mass-ingest & eval program).
 *
 * A multi-match video is split by Milestone ① into per-match reels. Each reel
 * gets a cheap identity probe (score / opponent / personas + a capture epoch),
 * which the pure fuzzy scorer (`match-association-score.ts`) matches against the
 * enumerated API-truth match candidates. The winning candidate lands here as a
 * `pending` proposal. On operator confirm, the reel's capture batch has its
 * `match_id` stamped and per-reel dispatch is unlocked (the `reel_match_ids`
 * map that `orchestrator.py` currently passes as `None`).
 *
 * This table is a review queue, not a canonical metric path:
 *   - Rows are the durable record of "which reel maps to which match, and why".
 *   - `evidence` (jsonb) preserves the full scoring rationale (score, opponent,
 *     personas, per-signal contributions, runner-up gap) for operator review
 *     and later threshold calibration (spec §12). Treat it as opaque from the
 *     DB layer's POV; its shape is owned by the scorer + `resolve-match-cli`.
 *
 * Nullability:
 *   - `runId` — nullable: a reel identity may be scored before a decoder run
 *     row exists for it (association can precede the full pass-2 run).
 *   - `proposedMatchId` — NULL means `no_api_match`: no candidate cleared the
 *     confidence threshold. Operator supplies a match id on confirm in that case.
 *   - `confidence` — NULL only for operator-authored (`no_api_match`) rows with
 *     no scorer proposal; bounded 0.0-1.0 by a CHECK for scored rows.
 */
export const ocrMatchAssociations = pgTable(
  'ocr_match_associations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Stable reel key: `${video_sha256}:${reel_index}`. One association per reel. */
    reelIdentity: text('reel_identity').notNull(),
    videoSha256: text('video_sha256').notNull(),
    /** Decoder run this reel belongs to; NULL if association precedes the run. */
    runId: bigint('run_id', { mode: 'number' }).references(() => ocrDecoderRuns.id),
    /** Winning candidate; NULL ⇒ no_api_match (operator supplies id on confirm). */
    proposedMatchId: bigint('proposed_match_id', { mode: 'number' }).references(() => matches.id),
    /** Best weighted score in [0,1]; bounded by ocr_match_associations_confidence_range_chk. */
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    /** Full scoring rationale: { score, opponent, personas, signals{...}, runnerUpGap }. */
    evidence: jsonb('evidence').notNull(),
    status: text('status').notNull().$type<OcrAssociationStatus>().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when an operator confirms or rejects the proposal. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    // One association per reel. The (video_sha256, reel_index) identity is
    // collapsed into a single text key so the unique index is a plain btree.
    uniqueIndex('ocr_match_associations_reel_uniq').on(table.reelIdentity),
  ],
)

export type OcrMatchAssociation = typeof ocrMatchAssociations.$inferSelect
export type NewOcrMatchAssociation = typeof ocrMatchAssociations.$inferInsert
