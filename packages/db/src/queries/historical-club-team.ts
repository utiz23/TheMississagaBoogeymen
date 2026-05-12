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

/**
 * Live team-stats rows derived from `matches`, shaped to the same column set
 * as `HistoricalClubTeamBatchRow` so the team-history table can render live
 * + archive rows uniformly.
 *
 * Returns one row per `game_mode` for the requested title (currently `6s`
 * and `3s`). Mapping to playlist slug:
 *   - `6s` → `eashl_6v6`
 *   - `3s` → `eashl_3v3`
 *
 * DNFs are excluded from PP/PK rate calc but counted in GP/W/L because that
 * matches how `clubs/seasonalStats` reports the record.
 */
export async function getLiveTeamStatsByMode(gameTitleId: number) {
  const result = await db.execute(sql`
    WITH per_mode AS (
      SELECT
        m.game_mode,
        CAST(count(*) AS integer)                                                  AS gp,
        CAST(sum(CASE WHEN m.result = 'WIN'  THEN 1 ELSE 0 END) AS integer)        AS wins,
        CAST(sum(CASE WHEN m.result = 'LOSS' THEN 1 ELSE 0 END) AS integer)        AS losses,
        CAST(sum(CASE WHEN m.result = 'OTL'  THEN 1 ELSE 0 END) AS integer)        AS otl,
        CAST(sum(m.score_for) AS integer)                                          AS goals_for,
        CAST(sum(m.score_against) AS integer)                                      AS goals_against,
        CAST(sum(m.time_on_attack) AS integer)                                     AS toa_total_seconds,
        CAST(sum(m.pp_goals) AS integer)                                           AS pp_goals,
        CAST(sum(m.pp_opportunities) AS integer)                                   AS pp_opp,
        CAST(sum(m.pp_goals_against) AS integer)                                   AS pp_goals_against,
        CAST(sum(m.pp_opportunities_against) AS integer)                           AS pp_opp_against
      FROM matches m
      WHERE m.game_title_id = ${gameTitleId}
        AND m.game_mode IS NOT NULL
      GROUP BY m.game_mode
    )
    SELECT
      ${gameTitleId}::int                                                          AS "gameTitleId",
      CASE game_mode
        WHEN '6s' THEN 'eashl_6v6'
        WHEN '3s' THEN 'eashl_3v3'
        ELSE game_mode
      END                                                                          AS playlist,
      gp                                                                           AS "gamesPlayed",
      wins,
      losses,
      otl,
      ROUND(goals_for::numeric / NULLIF(gp, 0), 2)                                  AS "avgGoalsFor",
      ROUND(goals_against::numeric / NULLIF(gp, 0), 2)                              AS "avgGoalsAgainst",
      -- Match the historical row's MM:SS text format for avgTimeOnAttack so
      -- the renderer doesn't need a special case.
      CASE
        WHEN gp > 0 THEN
          (toa_total_seconds / gp / 60)::text || ':' ||
          LPAD((toa_total_seconds / gp % 60)::text, 2, '0')
        ELSE NULL
      END                                                                          AS "avgTimeOnAttack",
      ROUND((pp_goals::numeric / NULLIF(pp_opp, 0)) * 100, 2)                        AS "powerPlayPct",
      ROUND((1 - pp_goals_against::numeric / NULLIF(pp_opp_against, 0)) * 100, 2)   AS "powerPlayKillPct"
    FROM per_mode
    WHERE gp > 0
    ORDER BY gp DESC
  `)

  return (result as unknown as Record<string, unknown>[]).map((r) => ({
    gameTitleId: Number(r.gameTitleId),
    playlist: String(r.playlist),
    gamesPlayed: Number(r.gamesPlayed),
    wins: Number(r.wins),
    losses: Number(r.losses),
    otl: Number(r.otl),
    avgGoalsFor: r.avgGoalsFor === null ? null : String(r.avgGoalsFor),
    avgGoalsAgainst: r.avgGoalsAgainst === null ? null : String(r.avgGoalsAgainst),
    avgTimeOnAttack: r.avgTimeOnAttack === null ? null : String(r.avgTimeOnAttack),
    powerPlayPct: r.powerPlayPct === null ? null : String(r.powerPlayPct),
    powerPlayKillPct: r.powerPlayKillPct === null ? null : String(r.powerPlayKillPct),
  })) satisfies HistoricalClubTeamBatchRow[]
}
