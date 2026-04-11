import {
  bigserial,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { gameTitles } from './game-titles.js'
import { ingestionLog } from './ingestion-log.js'

export const TRANSFORM_STATUS = ['pending', 'success', 'error'] as const
export type TransformStatus = (typeof TRANSFORM_STATUS)[number]

/**
 * Immutable archive of every EA API match response.
 *
 * Written BEFORE any transformation attempt. If the transform fails, this row
 * survives and can be reprocessed once the bug is fixed.
 *
 * Uniqueness: (game_title_id, ea_match_id) — composite rather than ea_match_id
 * alone because match IDs may not be globally unique across game titles.
 * This assumption is UNVERIFIED pending real fixtures; the composite key is
 * the safe default.
 */
export const rawMatchPayloads = pgTable(
  'raw_match_payloads',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** The match ID as returned by the EA API. */
    eaMatchId: text('ea_match_id').notNull(),
    /** EA match type. e.g. 'gameType5', 'gameType10', 'club_private' */
    matchType: text('match_type').notNull(),
    /** Full URL of the endpoint that produced this payload. */
    sourceEndpoint: text('source_endpoint').notNull(),
    /** Unmodified EA API response body. Never mutated after insert. */
    payload: jsonb('payload').notNull(),
    /** SHA-256 of the payload JSON. Used to detect unexpected payload changes. */
    payloadHash: text('payload_hash').notNull(),
    /**
     * Incremented when EA changes the response format for this game title.
     * Allows the transform layer to handle multiple response shapes.
     */
    schemaVersion: integer('schema_version').notNull().default(1),
    /**
     * 'pending'  — not yet transformed (e.g. inserted during a failed cycle)
     * 'success'  — transformed and inserted into structured tables
     * 'error'    — transform failed; see transform_error for details
     */
    transformStatus: text('transform_status').notNull().default('pending').$type<TransformStatus>(),
    /** Populated when transform_status = 'error'. Cleared on successful retry. */
    transformError: text('transform_error'),
    /** Which ingestion run captured this payload. Nullable (may be inserted manually). */
    ingestionLogId: integer('ingestion_log_id').references(() => ingestionLog.id),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('raw_match_payloads_title_match_uniq').on(table.gameTitleId, table.eaMatchId),
    check(
      'raw_match_payloads_transform_status_check',
      sql`${table.transformStatus} IN ('pending', 'success', 'error')`,
    ),
  ],
)

export type RawMatchPayload = typeof rawMatchPayloads.$inferSelect
export type NewRawMatchPayload = typeof rawMatchPayloads.$inferInsert
