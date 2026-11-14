import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  integer,
  numeric,
  pgTable,
  timestamp,
  text,
  unique,
} from 'drizzle-orm/pg-core'
import { players } from './players.js'
import type { NewsReporterId } from './news.js'

/**
 * The relationship between a player and a reporter (T9, migration 0078; the
 * table was `news_press_feuds` in T5, migration 0076). One row per pair.
 * `points` is the SIGNED total as of `last_event_at` (negative = the feud side,
 * positive = the favour side, capped at +-12); the level is read from the points
 * faded toward zero by the half-life (`packages/db/src/news/relationships.ts`).
 * No message text is stored: only the points.
 */

const REPORTER_LIST = `'barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'`

export const newsPressRelationships = pgTable(
  'news_press_relationships',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    /** The signed total as of `lastEventAt` (not faded): -12 .. +12. */
    points: numeric('points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('news_press_relationships_player_reporter_uniq').on(table.playerId, table.reporter),
    check('news_press_relationships_reporter_check', sql.raw(`"reporter" IN (${REPORTER_LIST})`)),
    check('news_press_relationships_points_check', sql`${table.points} between -12 and 12`),
  ],
)

export type NewsPressRelationshipRow = typeof newsPressRelationships.$inferSelect
