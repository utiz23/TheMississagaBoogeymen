import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'

/**
 * Current competitive season rank from EA clubs/seasonRank.
 *
 * One row per game title, upserted each ingestion cycle.
 * Captures division placement, season-specific W-L-OTL, points, and thresholds.
 *
 * ⚠ The wins/losses/otl here are SEASON-SPECIFIC (current ranking period) — NOT
 * the all-time official club record. See club_seasonal_stats for the EA official record.
 *
 * Division thresholds (pointsForPromotion, pointsToHoldDivision, pointsToTitle)
 * are joined from the EA settings endpoint at write time and stored here for
 * read-free display without a second join.
 *
 * All numeric fields from EA are stored as nullable integers — the endpoint shape is
 * UNVERIFIED and any field may be absent from the response.
 */
export const clubSeasonRank = pgTable(
  'club_season_rank',
  {
    id: serial('id').primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** Season wins — NOT all-time. */
    wins: integer('wins'),
    /** Season losses. */
    losses: integer('losses'),
    /** Season OTL. */
    otl: integer('otl'),
    /** Season games played. */
    gamesPlayed: integer('games_played'),
    /** Current division points. */
    points: integer('points'),
    /** Ranking/season points (may equal points). */
    rankingPoints: integer('ranking_points'),
    /** Projected end-of-season points. */
    projectedPoints: integer('projected_points'),
    /** Division number (1 = top division, higher = lower). */
    currentDivision: integer('current_division'),
    /** Human-readable division name from settings (e.g. "Division I"). */
    divisionName: text('division_name'),
    /** Points required to earn promotion to the next division. */
    pointsForPromotion: integer('points_for_promotion'),
    /** Minimum points to hold current division (avoid relegation). */
    pointsToHoldDivision: integer('points_to_hold_division'),
    /** Points required to win the division title. */
    pointsToTitle: integer('points_to_title'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('club_season_rank_game_title_uniq').on(table.gameTitleId)],
)

export type ClubSeasonRank = typeof clubSeasonRank.$inferSelect
export type NewClubSeasonRank = typeof clubSeasonRank.$inferInsert
