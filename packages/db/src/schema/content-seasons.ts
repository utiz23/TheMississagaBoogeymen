import { boolean, date, integer, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'

/**
 * In-game content seasons (battlepass seasons, ~5 per game title per year).
 *
 * Managed manually — EA does not expose season metadata in the API.
 * Matches are assigned to a season based on played_at vs. the date range here.
 *
 * Promoted from a bare integer field to a proper table so we can store:
 * - display labels ('Season 4')
 * - date boundaries (for auto-assignment)
 * - a 'current' flag (for default UI filtering)
 * - manual overrides (reassign by updating matches.content_season_id)
 */
export const contentSeasons = pgTable(
  'content_seasons',
  {
    id: serial('id').primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** Season number within the game title. e.g. 4 for 'Season 4'. */
    number: integer('number').notNull(),
    /** Display label. e.g. 'Season 4' */
    name: text('name').notNull(),
    startsAt: date('starts_at').notNull(),
    /** Null means this season is currently active. */
    endsAt: date('ends_at'),
    isCurrent: boolean('is_current').notNull().default(false),
  },
  (table) => [uniqueIndex('content_seasons_title_number_uniq').on(table.gameTitleId, table.number)],
)

export type ContentSeason = typeof contentSeasons.$inferSelect
export type NewContentSeason = typeof contentSeasons.$inferInsert
