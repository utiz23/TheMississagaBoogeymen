import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Live events (E1, migration 0079): small JSON events that OBS or the engine
 * send to `POST /api/internal/live-events` during a game (the horn, the game's
 * end). Append only; kept 30 days (the worker deletes older rows). Never shown
 * directly and never written into match data: EA stays the truth. The worker
 * reads them to poll EA fast after the horn.
 * Interface: docs/superpowers/specs/2026-11-14-live-events-interface.md (§3, v1).
 */

export const LIVE_EVENT_TYPES = [
  'lobby_countdown',
  'game_start',
  'period_end',
  'goal',
  'penalty',
  'end_of_game_screen',
  'game_end',
] as const
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number]

export const LIVE_EVENT_SOURCES = ['obs', 'engine'] as const
export type LiveEventSource = (typeof LIVE_EVENT_SOURCES)[number]

/** Longest accepted event id (the sender's own id; it makes resends harmless). */
export const LIVE_EVENT_ID_MAX = 128

const quoted = (list: readonly string[]) => list.map((v) => `'${v}'`).join(', ')

export const liveEvents = pgTable(
  'live_events',
  {
    /** The sender's id. A resend with the same id is not stored twice. */
    id: text('id').primaryKey(),
    type: text('type').$type<LiveEventType>().notNull(),
    source: text('source').$type<LiveEventSource>().notNull(),
    /** The sender's wall time of the event. */
    at: timestamp('at', { withTimezone: true }).notNull(),
    /** The website's clock when it stored the event. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** The whole validated v1 event, as received. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('live_events_received_at_idx').on(table.receivedAt),
    check('live_events_type_check', sql.raw(`"type" IN (${quoted(LIVE_EVENT_TYPES)})`)),
    check('live_events_source_check', sql.raw(`"source" IN (${quoted(LIVE_EVENT_SOURCES)})`)),
    check(
      'live_events_id_check',
      sql.raw(`char_length("id") BETWEEN 1 AND ${String(LIVE_EVENT_ID_MAX)}`),
    ),
  ],
)

export type LiveEventRow = typeof liveEvents.$inferSelect
export type NewLiveEventRow = typeof liveEvents.$inferInsert
