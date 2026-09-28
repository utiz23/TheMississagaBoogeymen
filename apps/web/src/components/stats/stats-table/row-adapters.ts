import type {
  EAGoalieExpandedRow,
  EASkaterExpandedRow,
  GoalieStatsRow,
  HistoricalGoalieStatsRow,
  HistoricalSkaterStatsRow,
  SkaterStatsRow,
} from '@eanhl/db/queries'
import type { GoalieDisplayRow, GoalieExpanded, SkaterDisplayRow, SkaterExpanded } from './types.ts'

export type SkaterInputRow = SkaterStatsRow | HistoricalSkaterStatsRow
export type GoalieInputRow = GoalieStatsRow | HistoricalGoalieStatsRow

function stripId<T extends { playerId: number }>(row: T | undefined): Omit<T, 'playerId'> | null {
  if (row === undefined) return null
  const { playerId: _ignored, ...rest } = row
  void _ignored
  return rest
}

/**
 * Normalise any accepted skater row (live EA, local, archive, career) into the
 * display row. Values pass through unchanged: this adapter never converts a
 * missing value into 0 or a 0 into missing.
 */
export function toSkaterDisplayRow(
  row: SkaterInputRow,
  expandedById?: ReadonlyMap<number, EASkaterExpandedRow>,
): SkaterDisplayRow {
  const expanded: SkaterExpanded | null =
    row.playerId !== null ? stripId(expandedById?.get(row.playerId)) : null
  return {
    playerId: row.playerId,
    gamertag: row.gamertag,
    position: row.position,
    gamesPlayed: row.gamesPlayed,
    goals: row.goals,
    assists: row.assists,
    points: row.points,
    plusMinus: row.plusMinus,
    pim: row.pim,
    shots: row.shots,
    hits: row.hits,
    takeaways: row.takeaways,
    giveaways: row.giveaways,
    faceoffPct: row.faceoffPct,
    passPct: row.passPct,
    shotAttempts: row.shotAttempts,
    toiSeconds: row.toiSeconds,
    expanded,
  }
}

export function toGoalieDisplayRow(
  row: GoalieInputRow,
  expandedById?: ReadonlyMap<number, EAGoalieExpandedRow>,
): GoalieDisplayRow {
  const expanded: GoalieExpanded | null =
    row.playerId !== null ? stripId(expandedById?.get(row.playerId)) : null
  return {
    playerId: row.playerId,
    gamertag: row.gamertag,
    gamesPlayed: row.gamesPlayed,
    wins: row.wins,
    losses: row.losses,
    otl: row.otl,
    savePct: row.savePct,
    gaa: row.gaa,
    shutouts: row.shutouts,
    totalSaves: row.totalSaves,
    totalShotsAgainst: row.totalShotsAgainst,
    totalGoalsAgainst: row.totalGoalsAgainst,
    toiSeconds: row.toiSeconds,
    recordUnavailable: (row as { recordUnavailable?: boolean }).recordUnavailable === true,
    expanded,
  }
}
