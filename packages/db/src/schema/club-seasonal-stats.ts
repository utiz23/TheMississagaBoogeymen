import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'

/**
 * Official EA club record fetched from clubs/seasonalStats.
 *
 * One row per game title, upserted each ingestion cycle. Represents the
 * current EA-official W-L-OTL record and ranking points as of the last fetch.
 *
 * Distinct from club_game_title_stats (local aggregate from ingested matches).
 * Use this table for record display; use club_game_title_stats for match metrics.
 */
export const clubSeasonalStats = pgTable(
  'club_seasonal_stats',
  {
    id: serial('id').primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    otl: integer('otl').notNull(),
    /** wins + losses + otl (computed at write time, not from EA) */
    gamesPlayed: integer('games_played').notNull(),
    /** Raw EA record string, e.g. "283-188-20". */
    record: text('record'),
    rankingPoints: integer('ranking_points'),
    goals: integer('goals'),
    goalsAgainst: integer('goals_against'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('club_seasonal_stats_game_title_uniq').on(table.gameTitleId)],
)

export type ClubSeasonalStats = typeof clubSeasonalStats.$inferSelect
export type NewClubSeasonalStats = typeof clubSeasonalStats.$inferInsert
