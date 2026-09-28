import type {
  ArchiveGoalieStatsRow,
  ArchiveSkaterStatsRow,
  EAGoalieExpandedRow,
  EASkaterExpandedRow,
  GoalieStatsRow,
  HistoricalGoalieStatsRow,
  HistoricalSkaterStatsRow,
  SkaterStatsRow,
} from '@eanhl/db/queries'
import type { GoalieDisplayRow, GoalieExpanded, SkaterDisplayRow, SkaterExpanded } from './types.ts'

export type SkaterInputRow = SkaterStatsRow | HistoricalSkaterStatsRow | ArchiveSkaterStatsRow
export type GoalieInputRow = GoalieStatsRow | HistoricalGoalieStatsRow | ArchiveGoalieStatsRow

function stripId<T extends { playerId: number }>(row: T | undefined): Omit<T, 'playerId'> | null {
  if (row === undefined) return null
  const { playerId: _ignored, ...rest } = row
  void _ignored
  return rest
}

/**
 * Normalise any accepted skater row (live EA, local, archive, career) into the
 * display row. Values pass through unchanged: this adapter never converts a
 * missing value into 0 or a 0 into missing. `ArchiveSkaterStatsRow` doesn't
 * carry `shotAttempts`/`toiSeconds`/`faceoffPct` at all (the club-member
 * source never captures them) — this adapter supplies explicit `null` for
 * those fields so the shared display row renders "—" rather than a false 0.
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
    faceoffPct: 'faceoffPct' in row ? row.faceoffPct : null,
    passPct: row.passPct,
    shotAttempts: 'shotAttempts' in row ? row.shotAttempts : null,
    toiSeconds: 'toiSeconds' in row ? row.toiSeconds : null,
    expanded,
  }
}

/**
 * `ArchiveGoalieStatsRow` doesn't carry `totalShotsAgainst`/`toiSeconds` at
 * all (the club-member source never captures them) — this adapter supplies
 * explicit `null` for those fields, same rationale as the skater adapter.
 */
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
    totalShotsAgainst: 'totalShotsAgainst' in row ? row.totalShotsAgainst : null,
    totalGoalsAgainst: row.totalGoalsAgainst,
    toiSeconds: 'toiSeconds' in row ? row.toiSeconds : null,
    recordUnavailable: (row as { recordUnavailable?: boolean }).recordUnavailable === true,
    expanded,
  }
}
