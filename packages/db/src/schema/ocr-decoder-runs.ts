import {
  bigint,
  bigserial,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { matches } from './matches.js'

/**
 * One row per execution of pass1+pass2 against a match's video (or per legacy
 * backfill bucket). All `ocr_capture_batches`, `ocr_segments`,
 * `ocr_field_evidence`, `ocr_extractions`, and `ocr_promotions` rows born from
 * a single ingest invocation carry that ingest's `run_id`. Exactly one run per
 * match is `is_active=true`; canonical metrics read only from active-run rows
 * (plus the legacy NULL-run leg for unmatched batches).
 *
 * Scope: video-match reprocess flow only (where match_id is known at ingest
 * time). Unmatched / pre-reconciliation batches keep `run_id IS NULL` and are
 * always visible to live readers via the NULL leg of the `liveRunFilter`.
 *
 * decoder_version semantics:
 *   - `ocr_decoder_runs.decoder_version` is PROVENANCE metadata. It may carry
 *     synthetic markers like `'legacy-mixed'` from backfill. Do NOT use it for
 *     runtime engine dispatch.
 *   - `ocr_segments.decoder_version` is OPERATIONAL — always a real engine
 *     name (e.g. `'hmm-viterbi-v1'`, `'legacy-passthrough-v0-video'`).
 */
export const ocrDecoderRuns = pgTable(
  'ocr_decoder_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    /**
     * sha256 of the source video. NULL for synthetic-backfill runs that span
     * multiple videos, or for manual-screenshot ingests with no video. See
     * `notes` for provenance details when NULL.
     */
    videoSha256: text('video_sha256'),
    /**
     * Operational engine name OR synthetic provenance marker. New runs use
     * runnable engine names; backfill may use `'legacy-mixed'`.
     */
    decoderVersion: text('decoder_version').notNull(),
    /** sha256 of weights JSON in use at ingest time (or backfill time for synthetic runs). */
    weightsHash: text('weights_hash').notNull(),
    /** sha256 of state machine + regex priors YAML in use. */
    configHash: text('config_hash').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(false),
    notes: text('notes'),
  },
  (table) => [
    // Provenance uniqueness. Drizzle 0.45 doesn't expose .nullsNotDistinct(),
    // so the generated migration is hand-edited to add `NULLS NOT DISTINCT` —
    // this prevents two synthetic backfill runs (both video_sha256=NULL)
    // collapsing onto the same identity.
    uniqueIndex('ocr_decoder_runs_provenance_uniq').on(
      table.matchId,
      table.videoSha256,
      table.decoderVersion,
      table.weightsHash,
    ),
    // Exactly one active run per match (partial unique).
    uniqueIndex('ocr_decoder_runs_one_active_per_match')
      .on(table.matchId)
      .where(sql`${table.isActive} = true`),
    index('ocr_decoder_runs_match_idx').on(table.matchId),
  ],
)

export type OcrDecoderRun = typeof ocrDecoderRuns.$inferSelect
export type NewOcrDecoderRun = typeof ocrDecoderRuns.$inferInsert
