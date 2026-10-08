/**
 * Per-position skater stats for the roster / stats tables and the player
 * page. Loads the two sources and hands them to the pure rules in
 * `position-model.ts` (archive wins per title; wing handling; coverage).
 */
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  eaMemberSeasonStats,
  gameTitles,
  historicalPlayerSeasonStats,
  playerPositionStats,
  players,
} from '../schema/index.js'
import type { GameMode } from '../schema/index.js'
import { compareGameTitlesNewestFirst } from './game-titles.js'
import {
  buildArchivePositionTable,
  buildCareerPositionRows,
  buildLocalPositionTable,
  titleLines,
  type PositionLine,
  type PositionPlayerRow,
  type PositionTable,
  type SkaterPosition,
} from './position-model.js'

export * from './position-model.js'

const ARCHIVE_POSITION_SCOPES = ['center', 'leftWing', 'rightWing', 'wing', 'defenseMen'] as const

const titleColumns = {
  gameTitleId: gameTitles.id,
  gameTitleName: gameTitles.name,
  gameTitleSlug: gameTitles.slug,
  gameTitleReleaseOrder: gameTitles.releaseOrder,
}

async function loadLocal(where: SQL | undefined) {
  const rows = await db
    .select({
      ...titleColumns,
      playerId: playerPositionStats.playerId,
      gamertag: players.gamertag,
      playerPosition: players.position,
      position: playerPositionStats.position,
      gp: playerPositionStats.gp,
      goals: playerPositionStats.goals,
      assists: playerPositionStats.assists,
      points: playerPositionStats.points,
      plusMinus: playerPositionStats.plusMinus,
      shots: playerPositionStats.shots,
      shotAttempts: playerPositionStats.shotAttempts,
      hits: playerPositionStats.hits,
      pim: playerPositionStats.pim,
      takeaways: playerPositionStats.takeaways,
      giveaways: playerPositionStats.giveaways,
      faceoffWins: playerPositionStats.faceoffWins,
      faceoffLosses: playerPositionStats.faceoffLosses,
      passCompletions: playerPositionStats.passCompletions,
      passAttempts: playerPositionStats.passAttempts,
      blockedShots: playerPositionStats.blockedShots,
      ppGoals: playerPositionStats.ppGoals,
      shGoals: playerPositionStats.shGoals,
      hatTricks: playerPositionStats.hatTricks,
      interceptions: playerPositionStats.interceptions,
      penaltiesDrawn: playerPositionStats.penaltiesDrawn,
      possessionSeconds: playerPositionStats.possessionSeconds,
      deflections: playerPositionStats.deflections,
      saucerPasses: playerPositionStats.saucerPasses,
      toiSeconds: playerPositionStats.toiSeconds,
      eaCGp: eaMemberSeasonStats.cGp,
      eaLwGp: eaMemberSeasonStats.lwGp,
      eaRwGp: eaMemberSeasonStats.rwGp,
      eaDGp: eaMemberSeasonStats.dGp,
    })
    .from(playerPositionStats)
    .innerJoin(players, eq(playerPositionStats.playerId, players.id))
    .innerJoin(gameTitles, eq(playerPositionStats.gameTitleId, gameTitles.id))
    .leftJoin(
      eaMemberSeasonStats,
      and(
        eq(eaMemberSeasonStats.playerId, playerPositionStats.playerId),
        eq(eaMemberSeasonStats.gameTitleId, playerPositionStats.gameTitleId),
      ),
    )
    .where(where)
  return rows.map(({ eaCGp, eaLwGp, eaRwGp, eaDGp, ...r }) => ({
    ...r,
    ea:
      eaCGp === null || eaLwGp === null || eaRwGp === null || eaDGp === null
        ? null
        : { cGp: eaCGp, lwGp: eaLwGp, rwGp: eaRwGp, dGp: eaDGp },
  }))
}

async function loadArchive(where: SQL | undefined) {
  return db
    .select({
      ...titleColumns,
      playerId: players.id,
      gamertag: players.gamertag,
      playerPosition: players.position,
      gameMode: historicalPlayerSeasonStats.gameMode,
      positionScope: historicalPlayerSeasonStats.positionScope,
      gamesPlayed: historicalPlayerSeasonStats.gamesPlayed,
      goals: historicalPlayerSeasonStats.goals,
      assists: historicalPlayerSeasonStats.assists,
      points: historicalPlayerSeasonStats.points,
      plusMinus: historicalPlayerSeasonStats.plusMinus,
      pim: historicalPlayerSeasonStats.pim,
      shots: historicalPlayerSeasonStats.shots,
      shotAttempts: historicalPlayerSeasonStats.shotAttempts,
      hits: historicalPlayerSeasonStats.hits,
      takeaways: historicalPlayerSeasonStats.takeaways,
      giveaways: historicalPlayerSeasonStats.giveaways,
      statsJson: historicalPlayerSeasonStats.statsJson,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(players, eq(historicalPlayerSeasonStats.playerId, players.id))
    .innerJoin(gameTitles, eq(historicalPlayerSeasonStats.gameTitleId, gameTitles.id))
    .where(
      and(
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
        eq(historicalPlayerSeasonStats.roleGroup, 'skater'),
        inArray(historicalPlayerSeasonStats.positionScope, [...ARCHIVE_POSITION_SCOPES]),
        where,
      ),
    )
}

/**
 * Every position's rows for one title × playlist (null = all playlists).
 * Archive screenshots when the title has position rows for that playlist,
 * otherwise the tracked-games aggregate.
 */
export async function getPositionSkaterStats(
  gameTitleId: number,
  gameMode: GameMode | null,
): Promise<PositionTable> {
  const mode = gameMode === '6s' || gameMode === '3s' ? gameMode : null
  const archive = await loadArchive(
    and(
      eq(historicalPlayerSeasonStats.gameTitleId, gameTitleId),
      mode === null ? undefined : eq(historicalPlayerSeasonStats.gameMode, mode),
    ),
  )
  if (archive.length > 0) return buildArchivePositionTable(archive, mode)
  const local = await loadLocal(
    and(
      eq(playerPositionStats.gameTitleId, gameTitleId),
      mode === null ? isNull(playerPositionStats.gameMode) : eq(playerPositionStats.gameMode, mode),
    ),
  )
  return buildLocalPositionTable(local, mode)
}

/** Career rows per position (All Time): every title, one source per player × title. */
export async function getAllTimePositionSkaterStats(): Promise<
  Record<SkaterPosition, PositionPlayerRow[]>
> {
  const [archive, local] = await Promise.all([
    loadArchive(undefined),
    loadLocal(isNull(playerPositionStats.gameMode)),
  ])
  return buildCareerPositionRows(archive, local)
}

export interface PlayerPositionSeason {
  gameTitleId: number
  gameTitleName: string
  gameTitleSlug: string
  gameTitleReleaseOrder: number | null
  source: 'archive' | 'local'
  lines: Record<SkaterPosition, PositionLine | null>
}

/** One player's per-position line for every title, newest first. */
export async function getPlayerPositionSeasons(playerId: number): Promise<PlayerPositionSeason[]> {
  const [archive, local] = await Promise.all([
    loadArchive(eq(historicalPlayerSeasonStats.playerId, playerId)),
    loadLocal(
      and(eq(playerPositionStats.playerId, playerId), isNull(playerPositionStats.gameMode)),
    ),
  ])
  const titles = new Map<number, (typeof archive)[number] | (typeof local)[number]>()
  for (const r of [...archive, ...local]) titles.set(r.gameTitleId, r)
  return [...titles.values()]
    .map((t) => {
      const loc = local.filter((r) => r.gameTitleId === t.gameTitleId)
      const { source, lines } = titleLines(
        archive.filter((r) => r.gameTitleId === t.gameTitleId),
        loc,
        loc[0]?.ea ?? null,
      )
      return {
        gameTitleId: t.gameTitleId,
        gameTitleName: t.gameTitleName,
        gameTitleSlug: t.gameTitleSlug,
        gameTitleReleaseOrder: t.gameTitleReleaseOrder,
        source,
        lines,
      }
    })
    .sort((a, b) =>
      compareGameTitlesNewestFirst(
        { releaseOrder: a.gameTitleReleaseOrder, slug: a.gameTitleSlug },
        { releaseOrder: b.gameTitleReleaseOrder, slug: b.gameTitleSlug },
      ),
    )
}
