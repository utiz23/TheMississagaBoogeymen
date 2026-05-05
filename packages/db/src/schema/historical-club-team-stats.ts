import {
  bigserial,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'

export type HistoricalClubTeamReviewStatus = 'pending_review' | 'reviewed' | 'rejected'

/**
 * Club/team historical totals from archived `STATS → CLUB STATS` screen
 * captures (`club_stats__*.png`).
 *
 * Distinct from:
 *   - `historical_player_season_stats` — per-player season-card totals.
 *   - `historical_club_member_season_stats` — per-player club-scoped totals.
 *   - `club_seasonal_stats` — live, EA-fetched, one row per title, ~7 columns.
 *
 * This table is **club-level only** (no player rows) and **per-playlist**:
 * `eashl_6v6`, `eashl_3v3`, `6_player_full_team`, `threes`, `clubs_*` (NHL 22
 * naming). The playlist axis is preserved as the captured label; future
 * normalisation can collapse equivalent labels across titles.
 *
 * One row per (game_title_id, playlist). Two source PNGs per logical row are
 * normal due to vertical-scroll splitting in the in-game view; both paths land
 * in `source_asset_paths`. Wide column set is intentionally nullable — not
 * every screenshot exposes every metric, and we honour that with NULL rather
 * than zero.
 */
export const historicalClubTeamStats = pgTable(
  'historical_club_team_stats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** Verbatim playlist label as captured (e.g. 'eashl_6v6', 'threes'). */
    playlist: text('playlist').notNull(),

    // Record / W-L
    gamesPlayed: integer('games_played'),
    wins: integer('wins'),
    losses: integer('losses'),
    otl: integer('otl'),
    winLossStreak: integer('win_loss_streak'),
    didNotFinishPct: numeric('did_not_finish_pct', { precision: 5, scale: 2 }),
    dnfWins: integer('dnf_wins'),
    divisionTitles: integer('division_titles'),
    clubFinalsGp: integer('club_finals_gp'),

    // Goal totals
    goalsFor: integer('goals_for'),
    goalsAgainst: integer('goals_against'),
    goalDifference: integer('goal_difference'),
    avgGoalsFor: numeric('avg_goals_for', { precision: 5, scale: 2 }),
    avgGoalsAgainst: numeric('avg_goals_against', { precision: 5, scale: 2 }),
    avgWinMargin: numeric('avg_win_margin', { precision: 5, scale: 2 }),
    avgLossMargin: numeric('avg_loss_margin', { precision: 5, scale: 2 }),

    // Shots / shooting
    shotsFor: integer('shots_for'),
    shotsAgainst: integer('shots_against'),
    shotsPerGame: numeric('shots_per_game', { precision: 5, scale: 2 }),
    avgShotsAgainst: numeric('avg_shots_against', { precision: 5, scale: 2 }),
    shootingPct: numeric('shooting_pct', { precision: 5, scale: 2 }),

    // Hits / physical
    hits: integer('hits'),
    hitsPerGame: numeric('hits_per_game', { precision: 5, scale: 2 }),

    // Penalties / power play
    pim: integer('pim'),
    avgPim: numeric('avg_pim', { precision: 5, scale: 2 }),
    powerPlays: integer('power_plays'),
    powerPlayGoals: integer('power_play_goals'),
    powerPlayPct: numeric('power_play_pct', { precision: 5, scale: 2 }),
    powerPlayKillPct: numeric('power_play_kill_pct', { precision: 5, scale: 2 }),
    timesShorthanded: integer('times_shorthanded'),
    shortHandedGoals: integer('short_handed_goals'),
    shortHandedGoalsAgainst: integer('short_handed_goals_against'),

    // Faceoffs / passes / breakaways / one-timers
    faceoffsWon: integer('faceoffs_won'),
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    breakaways: integer('breakaways'),
    breakawayPct: numeric('breakaway_pct', { precision: 5, scale: 2 }),
    oneTimerGoals: integer('one_timer_goals'),
    oneTimerPct: numeric('one_timer_pct', { precision: 5, scale: 2 }),
    passes: integer('passes'),
    passAttempts: integer('pass_attempts'),
    passingPct: numeric('passing_pct', { precision: 5, scale: 2 }),
    blockedShots: integer('blocked_shots'),

    /** "Avg Time on Attack" displayed as MM:SS in-game. Stored as text to
     * avoid imposing a timezone-free interval type; downstream can parse. */
    avgTimeOnAttack: text('avg_time_on_attack'),

    // Provenance / review.
    sourceAssetPaths: text('source_asset_paths').array().notNull(),
    /** Verbatim key/value snapshot from each screenshot (per-source slice). */
    rawExtractJson: jsonb('raw_extract_json').notNull(),
    importBatch: text('import_batch').notNull(),
    reviewStatus: text('review_status')
      .$type<HistoricalClubTeamReviewStatus>()
      .notNull()
      .default('pending_review'),
    confidenceScore: numeric('confidence_score', { precision: 5, scale: 2 }),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hct_stats_title_playlist_uniq').on(table.gameTitleId, table.playlist),
  ],
)

export type HistoricalClubTeamStat = typeof historicalClubTeamStats.$inferSelect
export type NewHistoricalClubTeamStat = typeof historicalClubTeamStats.$inferInsert
