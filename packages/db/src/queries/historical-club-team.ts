import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { historicalClubTeamStats } from '../schema/index.js'
import type { GameMode } from '../schema/index.js'

/**
 * Playlist slugs that belong to each effective game mode.
 *
 * `historical_club_team_stats` uses the verbatim playlist label from the
 * in-game screen (no `game_mode` column), so we must derive the set from the
 * UI filter. The mapping is deterministic and explicit — no guessing at
 * run-time.
 *
 * `quickplay_3v3` is included under 3s but will always be excluded by the
 * `gamesPlayed > 0` guard (the club has 0 games recorded there).
 */
const PLAYLISTS_6S = [
  'eashl_6v6',
  'clubs_6v6',
  '6_player_full_team',
  'clubs_6_players',
] satisfies string[]

const PLAYLISTS_3S = [
  'eashl_3v3',
  'clubs_3v3',
  'threes',
  'quickplay_3v3',
] satisfies string[]

const ALL_PLAYLISTS: string[] = [...PLAYLISTS_6S, ...PLAYLISTS_3S]

function playlistsForMode(gameMode: GameMode | null): string[] {
  if (gameMode === '6s') return PLAYLISTS_6S
  if (gameMode === '3s') return PLAYLISTS_3S
  return ALL_PLAYLISTS
}

/**
 * Historical club/team totals from `STATS → CLUB STATS` screen captures.
 *
 * Returns reviewed rows for the requested title, filtered to playlists that
 * match the requested game mode. Rows with `games_played = 0` or NULL are
 * excluded — they carry no meaningful season data.
 *
 * The row set is ordered by games_played DESC so the most-played modes appear
 * first regardless of playlist label alphabetics.
 */
export async function getHistoricalClubTeamStats(
  gameTitleId: number,
  gameMode: GameMode | null,
) {
  const playlists = playlistsForMode(gameMode)
  return db
    .select({
      playlist: historicalClubTeamStats.playlist,
      gamesPlayed: historicalClubTeamStats.gamesPlayed,
      wins: historicalClubTeamStats.wins,
      losses: historicalClubTeamStats.losses,
      otl: historicalClubTeamStats.otl,
      goalsFor: historicalClubTeamStats.goalsFor,
      goalsAgainst: historicalClubTeamStats.goalsAgainst,
      avgGoalsFor: historicalClubTeamStats.avgGoalsFor,
      avgGoalsAgainst: historicalClubTeamStats.avgGoalsAgainst,
      avgTimeOnAttack: historicalClubTeamStats.avgTimeOnAttack,
      powerPlayPct: historicalClubTeamStats.powerPlayPct,
      powerPlayKillPct: historicalClubTeamStats.powerPlayKillPct,
      faceoffPct: historicalClubTeamStats.faceoffPct,
      passingPct: historicalClubTeamStats.passingPct,
    })
    .from(historicalClubTeamStats)
    .where(
      and(
        eq(historicalClubTeamStats.gameTitleId, gameTitleId),
        eq(historicalClubTeamStats.reviewStatus, 'reviewed'),
        inArray(historicalClubTeamStats.playlist, playlists),
        sql`${historicalClubTeamStats.gamesPlayed} > 0`,
      ),
    )
    .orderBy(
      sql`${historicalClubTeamStats.gamesPlayed} DESC NULLS LAST`,
      historicalClubTeamStats.playlist,
    )
}

export type HistoricalClubTeamStatsRow = Awaited<
  ReturnType<typeof getHistoricalClubTeamStats>
>[number]

/**
 * Batch fetch of reviewed club-team rows for multiple title IDs.
 *
 * Returns raw playlist rows (gamesPlayed > 0, review_status = reviewed) across
 * all requested titles. Callers group by gameTitleId and map playlist slugs to
 * logical mode columns (6v6 / full-team / 3v3) using the explicit per-era
 * naming constants defined in page-level consumers.
 */
export async function getHistoricalClubTeamStatsBatch(gameTitleIds: number[]) {
  if (gameTitleIds.length === 0) return []
  return db
    .select({
      gameTitleId: historicalClubTeamStats.gameTitleId,
      playlist: historicalClubTeamStats.playlist,
      gamesPlayed: historicalClubTeamStats.gamesPlayed,
      wins: historicalClubTeamStats.wins,
      losses: historicalClubTeamStats.losses,
      otl: historicalClubTeamStats.otl,
      avgGoalsFor: historicalClubTeamStats.avgGoalsFor,
      avgGoalsAgainst: historicalClubTeamStats.avgGoalsAgainst,
      avgTimeOnAttack: historicalClubTeamStats.avgTimeOnAttack,
      powerPlayPct: historicalClubTeamStats.powerPlayPct,
      powerPlayKillPct: historicalClubTeamStats.powerPlayKillPct,
    })
    .from(historicalClubTeamStats)
    .where(
      and(
        inArray(historicalClubTeamStats.gameTitleId, gameTitleIds),
        eq(historicalClubTeamStats.reviewStatus, 'reviewed'),
        sql`${historicalClubTeamStats.gamesPlayed} > 0`,
      ),
    )
}

export type HistoricalClubTeamBatchRow = Awaited<
  ReturnType<typeof getHistoricalClubTeamStatsBatch>
>[number]
