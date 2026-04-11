import { check, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { gameTitles } from './game-titles.js'

export const INGESTION_STATUS = ['success', 'partial', 'error'] as const
export type IngestionStatus = (typeof INGESTION_STATUS)[number]

/**
 * One row written per ingestion cycle per match type.
 * Primary observability mechanism — query this to detect stuck workers.
 */
export const ingestionLog = pgTable(
  'ingestion_log',
  {
    id: serial('id').primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** EA match type polled in this cycle. e.g. 'gameType5' */
    matchType: text('match_type').notNull(),
    matchesFound: integer('matches_found').notNull().default(0),
    matchesNew: integer('matches_new').notNull().default(0),
    transformsFailed: integer('transforms_failed').notNull().default(0),
    status: text('status').notNull().$type<IngestionStatus>(),
    errorMessage: text('error_message'),
  },
  (table) => [
    check('ingestion_log_status_check', sql`${table.status} IN ('success', 'partial', 'error')`),
  ],
)

export type IngestionLog = typeof ingestionLog.$inferSelect
export type NewIngestionLog = typeof ingestionLog.$inferInsert
