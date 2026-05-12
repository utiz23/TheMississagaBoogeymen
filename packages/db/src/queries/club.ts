import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  clubGameTitleStats,
  clubSeasonalStats,
  clubSeasonRank,
  historicalClubTeamStats,
  opponentClubs,
} from '../schema/index.js'
import type { GameMode } from '../schema/index.js'

/**
 * Club aggregate stats for a given game title.
 *
 * gameMode defaults to null = all-modes combined row. Pass '6s' or '3s' for
 * mode-specific rows emitted by the Phase 2 aggregate dimension.
 *
 * Returns null when no aggregate row exists (worker has not yet run).
 * All integer fields (wins, losses, otl, etc.) default to 0 in the schema,
 * so a non-null result always has complete integer data.
 * Numeric rate fields (shotsPerGame, hitsPerGame, faceoffPct, passPct) are
 * nullable — null means the worker has not yet computed them.
 */
/**
 * Official EA club record from clubs/seasonalStats.
 *
 * Returns null when no snapshot has been captured yet (worker has not yet fetched
 * from the EA endpoint). Never falls back to local aggregate counts.
 * Display an honest unavailable state when this returns null.
 */
export async function getOfficialClubRecord(gameTitleId: number) {
  const rows = await db
    .select()
    .from(clubSeasonalStats)
    .where(eq(clubSeasonalStats.gameTitleId, gameTitleId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Opponent club metadata fetched from EA clubs/info.
 *
 * Returns null when the opponent has not yet been looked up (e.g. first
 * ingestion cycle after the feature was deployed). Never returns our own
 * club — Boogeymen branding stays local.
 */
export async function getOpponentClub(eaClubId: string) {
  const rows = await db
    .select()
    .from(opponentClubs)
    .where(eq(opponentClubs.eaClubId, eaClubId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Opponent club metadata for multiple EA club IDs.
 *
 * Used by the scores page to avoid one lookup per match card.
 * Returns [] when the list is empty.
 */
export async function getOpponentClubs(eaClubIds: string[]) {
  if (eaClubIds.length === 0) return []

  return db
    .select()
    .from(opponentClubs)
    .where(inArray(opponentClubs.eaClubId, eaClubIds))
}

/**
 * Current competitive season rank from EA clubs/seasonRank.
 *
 * Returns null when no row has been fetched yet. The wins/losses/otl here are
 * SEASON-SPECIFIC — not the all-time official club record (use getOfficialClubRecord
 * for that). Use this for division placement and season progress display only.
 */
export async function getClubSeasonRank(gameTitleId: number) {
  const rows = await db
    .select()
    .from(clubSeasonRank)
    .where(eq(clubSeasonRank.gameTitleId, gameTitleId))
    .limit(1)
  return rows[0] ?? null
}

export async function getClubStats(gameTitleId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(clubGameTitleStats.gameMode)
      : eq(clubGameTitleStats.gameMode, gameMode)
  const rows = await db
    .select()
    .from(clubGameTitleStats)
    .where(and(eq(clubGameTitleStats.gameTitleId, gameTitleId), gameModeFilter))
    .limit(1)
  return rows[0] ?? null
}

export interface AllTimeTeamRecord {
  wins: number
  losses: number
  otl: number
  gamesPlayed: number
  goals: number | null
  goalsAgainst: number | null
  /** Number of game titles contributing to the total. */
  titlesCount: number
}

/**
 * Career team record across every stored game title.
 *
 * Live titles (currently NHL 26) are read from `club_seasonal_stats`. Older
 * titles come from `historical_club_team_stats` — every reviewed playlist row
 * sums into the same totals. Goals-for / goals-against are pulled where they
 * exist; older historical rows store only avg goals/game so we omit them and
 * mark the totals nullable.
 */
export async function getAllTimeTeamRecord(): Promise<AllTimeTeamRecord> {
  const liveAgg = await db
    .select({
      wins: sql<number>`COALESCE(SUM(${clubSeasonalStats.wins}), 0)::int`,
      losses: sql<number>`COALESCE(SUM(${clubSeasonalStats.losses}), 0)::int`,
      otl: sql<number>`COALESCE(SUM(${clubSeasonalStats.otl}), 0)::int`,
      gamesPlayed: sql<number>`COALESCE(SUM(${clubSeasonalStats.gamesPlayed}), 0)::int`,
      goals: sql<number>`COALESCE(SUM(${clubSeasonalStats.goals}), 0)::int`,
      goalsAgainst: sql<number>`COALESCE(SUM(${clubSeasonalStats.goalsAgainst}), 0)::int`,
      titles: sql<number>`COUNT(DISTINCT ${clubSeasonalStats.gameTitleId})::int`,
    })
    .from(clubSeasonalStats)

  const histAgg = await db
    .select({
      wins: sql<number>`COALESCE(SUM(${historicalClubTeamStats.wins}), 0)::int`,
      losses: sql<number>`COALESCE(SUM(${historicalClubTeamStats.losses}), 0)::int`,
      otl: sql<number>`COALESCE(SUM(${historicalClubTeamStats.otl}), 0)::int`,
      gamesPlayed: sql<number>`COALESCE(SUM(${historicalClubTeamStats.gamesPlayed}), 0)::int`,
      goalsFor: sql<number>`COALESCE(SUM(${historicalClubTeamStats.goalsFor}), 0)::int`,
      goalsAgainst: sql<number>`COALESCE(SUM(${historicalClubTeamStats.goalsAgainst}), 0)::int`,
      titles: sql<number>`COUNT(DISTINCT ${historicalClubTeamStats.gameTitleId})::int`,
    })
    .from(historicalClubTeamStats)
    .where(eq(historicalClubTeamStats.reviewStatus, 'reviewed'))

  const live = liveAgg[0] ?? {
    wins: 0,
    losses: 0,
    otl: 0,
    gamesPlayed: 0,
    goals: 0,
    goalsAgainst: 0,
    titles: 0,
  }
  const hist = histAgg[0] ?? {
    wins: 0,
    losses: 0,
    otl: 0,
    gamesPlayed: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    titles: 0,
  }

  return {
    wins: live.wins + hist.wins,
    losses: live.losses + hist.losses,
    otl: live.otl + hist.otl,
    gamesPlayed: live.gamesPlayed + hist.gamesPlayed,
    goals: live.goals + hist.goalsFor || null,
    goalsAgainst: live.goalsAgainst + hist.goalsAgainst || null,
    titlesCount: live.titles + hist.titles,
  }
}
