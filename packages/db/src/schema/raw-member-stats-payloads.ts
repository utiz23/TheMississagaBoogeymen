import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'

/**
 * One-row-per-game-title archive of the most recent EA members/stats response.
 *
 * Written BEFORE any transformation attempt (raw-first principle). Upserted on
 * each ingestion cycle — this is a mutable snapshot, not an append-only log.
 * The previous payload is overwritten with each fetch.
 *
 * If the transform logic changes, re-run member stats ingestion to reprocess
 * from the latest archived payload.
 */
export const rawMemberStatsPayloads = pgTable(
  'raw_member_stats_payloads',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** SHA-256 of the payload JSON. Allows detecting when EA data actually changed. */
    payloadHash: text('payload_hash').notNull(),
    /** Unmodified EA API response body. Overwritten on each successful fetch. */
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('raw_member_stats_payloads_title_uniq').on(table.gameTitleId)],
)

export type RawMemberStatsPayload = typeof rawMemberStatsPayloads.$inferSelect
export type NewRawMemberStatsPayload = typeof rawMemberStatsPayloads.$inferInsert
