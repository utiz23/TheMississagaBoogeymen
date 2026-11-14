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
 * Feud points between a player and a reporter (T5, migration 0076). One row
 * per pair. `points` is the total as of `last_event_at`; the level is read
 * from the points faded by the half-life (`packages/db/src/news/feuds.ts`).
 * No message text is stored: only the points.
 */

const REPORTER_LIST = `'barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'`

export const newsPressFeuds = pgTable(
  'news_press_feuds',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    /** The total as of `lastEventAt` (not faded). */
    points: numeric('points', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('news_press_feuds_player_reporter_uniq').on(table.playerId, table.reporter),
    check('news_press_feuds_reporter_check', sql.raw(`"reporter" IN (${REPORTER_LIST})`)),
    check('news_press_feuds_points_check', sql`${table.points} >= 0`),
  ],
)

export type NewsPressFeudRow = typeof newsPressFeuds.$inferSelect
