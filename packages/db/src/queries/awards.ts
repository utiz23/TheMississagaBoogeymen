import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  eaMemberSeasonStats,
  gameTitles,
  historicalPlayerSeasonStats,
  players,
} from '../schema/index.js'
import { excludeHistoricalRowsCoveredByEa } from './career-coverage.js'

/**
 * One player's line for one game title — the inputs the profile Awards
 * section ranks to find club records and career milestones.
 */
export interface ClubSeasonLine {
  playerId: number
  gamertag: string
  gameTitleId: number
  gameTitleName: string
  /** Chronology key (22 for NHL 22 …); null sorts last. */
  releaseOrder: number | null
  skaterGp: number
  goals: number
  assists: number
  points: number
  hits: number
  pim: number
  fightsWon: number
  hatTricks: number
  blockedShots: number
  goalieGp: number
  wins: number
  shutouts: number
}

/** A whole-number count from the archive row's `stats_json`; anything else counts 0. */
const jsonCount = (key: string) =>
  sql`CASE WHEN ${historicalPlayerSeasonStats.statsJson}->>${key} ~ '^[0-9]+$'
    THEN (${historicalPlayerSeasonStats.statsJson}->>${key})::int ELSE 0 END`

const toInt = (v: string | number | null): number =>
  v === null ? 0 : typeof v === 'number' ? v : Number.parseInt(v, 10) || 0

/**
 * Every human player's per-title line, one source per player+title — the same
 * precedence as `getPlayerCareerSeasons`: an EA member-season row wins, and a
 * reviewed historical row (6s + 3s summed, the `all_skaters` / `goalie` scopes
 * that `getHistorical*StatsAllModes` read) fills titles EA doesn't cover.
 * The AI goalies are excluded: they are not club members and can't hold club
 * records.
 */
export async function getClubSeasonLines(): Promise<ClubSeasonLine[]> {
  const eaRows = await db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamertag: players.gamertag,
      gameTitleId: eaMemberSeasonStats.gameTitleId,
      gameTitleName: gameTitles.name,
      releaseOrder: gameTitles.releaseOrder,
      skaterGp: eaMemberSeasonStats.skaterGp,
      goals: eaMemberSeasonStats.goals,
      assists: eaMemberSeasonStats.assists,
      points: eaMemberSeasonStats.points,
      hits: eaMemberSeasonStats.hits,
      pim: eaMemberSeasonStats.pim,
      fightsWon: eaMemberSeasonStats.fightsWon,
      hatTricks: eaMemberSeasonStats.hatTricks,
      blockedShots: eaMemberSeasonStats.blockedShots,
      goalieGp: eaMemberSeasonStats.goalieGp,
      wins: eaMemberSeasonStats.goalieWins,
      shutouts: eaMemberSeasonStats.goalieShutouts,
    })
    .from(eaMemberSeasonStats)
    .innerJoin(players, eq(eaMemberSeasonStats.playerId, players.id))
    .innerJoin(gameTitles, eq(eaMemberSeasonStats.gameTitleId, gameTitles.id))
    .where(isNull(players.aiGoalieSide))

  const historicalRows = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamertag: players.gamertag,
      gameTitleId: historicalPlayerSeasonStats.gameTitleId,
      gameTitleName: gameTitles.name,
      releaseOrder: gameTitles.releaseOrder,
      roleGroup: historicalPlayerSeasonStats.roleGroup,
      gamesPlayed: sql<string>`SUM(${historicalPlayerSeasonStats.gamesPlayed})`,
      goals: sql<string | null>`SUM(${historicalPlayerSeasonStats.goals})`,
      assists: sql<string | null>`SUM(${historicalPlayerSeasonStats.assists})`,
      points: sql<string | null>`SUM(${historicalPlayerSeasonStats.points})`,
      hits: sql<string | null>`SUM(${historicalPlayerSeasonStats.hits})`,
      pim: sql<string | null>`SUM(${historicalPlayerSeasonStats.pim})`,
      blockedShots: sql<string | null>`SUM(${historicalPlayerSeasonStats.blockedShots})`,
      // Fights won and hat tricks were only captured in the raw screenshot data.
      fightsWon: sql<string | null>`SUM(${jsonCount('fights_won')})`,
      hatTricks: sql<string | null>`SUM(${jsonCount('hat_tricks')})`,
      wins: sql<string | null>`SUM(${historicalPlayerSeasonStats.wins})`,
      shutouts: sql<string | null>`SUM(${historicalPlayerSeasonStats.shutouts})`,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(players, eq(historicalPlayerSeasonStats.playerId, players.id))
    .innerJoin(gameTitles, eq(historicalPlayerSeasonStats.gameTitleId, gameTitles.id))
    .where(
      and(
        isNull(players.aiGoalieSide),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
        sql`(
          (${historicalPlayerSeasonStats.roleGroup} = 'skater'
            AND ${historicalPlayerSeasonStats.positionScope} = 'all_skaters')
          OR
          (${historicalPlayerSeasonStats.roleGroup} = 'goalie'
            AND ${historicalPlayerSeasonStats.positionScope} = 'goalie')
        )`,
      ),
    )
    .groupBy(
      historicalPlayerSeasonStats.playerId,
      players.gamertag,
      historicalPlayerSeasonStats.gameTitleId,
      gameTitles.name,
      gameTitles.releaseOrder,
      historicalPlayerSeasonStats.roleGroup,
    )

  const lines: ClubSeasonLine[] = eaRows.map((r) => ({
    playerId: r.playerId,
    gamertag: r.gamertag,
    gameTitleId: r.gameTitleId,
    gameTitleName: r.gameTitleName,
    releaseOrder: r.releaseOrder,
    skaterGp: r.skaterGp,
    goals: r.goals,
    assists: r.assists,
    points: r.points,
    hits: r.hits,
    pim: r.pim,
    fightsWon: r.fightsWon,
    hatTricks: r.hatTricks,
    blockedShots: r.blockedShots,
    goalieGp: r.goalieGp,
    wins: r.wins ?? 0,
    shutouts: r.shutouts ?? 0,
  }))

  // Merge the skater and goalie role rows of each historical player+title.
  const historical = new Map<string, ClubSeasonLine>()
  for (const r of excludeHistoricalRowsCoveredByEa(eaRows, historicalRows)) {
    const key = `${String(r.playerId)}:${String(r.gameTitleId)}`
    const line = historical.get(key) ?? {
      playerId: r.playerId,
      gamertag: r.gamertag,
      gameTitleId: r.gameTitleId,
      gameTitleName: r.gameTitleName,
      releaseOrder: r.releaseOrder,
      skaterGp: 0,
      goals: 0,
      assists: 0,
      points: 0,
      hits: 0,
      pim: 0,
      fightsWon: 0,
      hatTricks: 0,
      blockedShots: 0,
      goalieGp: 0,
      wins: 0,
      shutouts: 0,
    }
    if (r.roleGroup === 'skater') {
      line.skaterGp = toInt(r.gamesPlayed)
      line.goals = toInt(r.goals)
      line.assists = toInt(r.assists)
      line.points = toInt(r.points)
      line.hits = toInt(r.hits)
      line.pim = toInt(r.pim)
      line.fightsWon = toInt(r.fightsWon)
      line.hatTricks = toInt(r.hatTricks)
      line.blockedShots = toInt(r.blockedShots)
    } else {
      line.goalieGp = toInt(r.gamesPlayed)
      line.wins = toInt(r.wins)
      line.shutouts = toInt(r.shutouts)
    }
    historical.set(key, line)
  }
  return [...lines, ...historical.values()]
}
