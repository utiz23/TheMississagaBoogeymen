/**
 * Local `player_game_title_stats.wins/losses/otl` count the player's team result
 * across EVERY appearance (skater or goalie), so for a goalie they are not a
 * goalie-only record and will not add up to goalie GP. The stored values stay
 * as they are (the profile page reads them player-wide); goalie-table queries
 * mask them instead, flagging the row so the UI can explain the `—`.
 *
 * Pure and DB-free so it is unit-testable without a database.
 */
export type MaskedGoalieRecord<T> = Omit<T, 'wins' | 'losses' | 'otl'> & {
  wins: number | null
  losses: number | null
  otl: number | null
  /** Marker: W/L/OTL withheld because the stored record is player-wide, not goalie-only. */
  recordUnavailable: true
}

export function maskPlayerWideGoalieRecord<
  T extends { wins: number | null; losses: number | null; otl: number | null },
>(rows: T[]): MaskedGoalieRecord<T>[] {
  return rows.map((row) => ({
    ...row,
    wins: null,
    losses: null,
    otl: null,
    recordUnavailable: true as const,
  }))
}
