/**
 * Archive (reviewed screenshot) season detail read from `stats_json`.
 *
 * The historical importer promotes only some screenshot fields to columns;
 * the rest (PPG, hat tricks, dekes, breakaways, penalty shots, goalie
 * minutes …) survive verbatim in `stats_json` as display strings ("1,912").
 * This module parses those counts and sums a player's 6s + 3s rows per title.
 *
 * Pure (no db import) so it is unit-testable; the query lives in
 * `historical.ts` (`getPlayerArchiveSeasonDetail`).
 */

/** Detail field → `stats_json` key, skater screenshots. Counts only; rates are derived by consumers. */
export const ARCHIVE_SKATER_KEYS = {
  powerPlayGoals: 'ppg',
  shortHandedGoals: 'shg',
  gameWinningGoals: 'gwg',
  hatTricks: 'hat_tricks',
  passes: 'pass_completions',
  passAttempts: 'pass_attempts',
  saucerPasses: 'spass',
  // The screenshot's "dekes" is completed dekes (always ≤ dekes_attempted).
  dekes: 'dekes_attempted',
  dekesMade: 'dekes',
  deflections: 'deflections',
  faceoffWins: 'faceoff_wins',
  faceoffLosses: 'faceoff_losses',
  blockedShots: 'blocked_shots',
  interceptions: 'interceptions',
  pkClearZone: 'pkzc',
  penaltiesDrawn: 'penalties_drawn',
  offsides: 'offsides',
  fights: 'fights',
  fightsWon: 'fights_won',
  breakaways: 'breakaways',
  breakawayGoals: 'breakaway_goals',
  penaltyShotAttempts: 'ps',
  penaltyShotGoals: 'psg',
} as const

/** Detail field → `stats_json` key, goalie screenshots. */
export const ARCHIVE_GOALIE_KEYS = {
  // In-game "diving saves" is the stat EA's API calls desperation saves.
  desperationSaves: 'diving_saves',
  breakawayShots: 'breakaway_shots',
  breakawaySaves: 'breakaway_saves',
  penaltyShots: 'ps',
  penaltyShotSaves: 'penalty_shot_saves',
  pkClearZone: 'pkzc',
  minutesPlayed: 'minutes_played',
} as const

export type ArchiveSkaterDetail = { [K in keyof typeof ARCHIVE_SKATER_KEYS]: number | null }
export type ArchiveGoalieDetail = { [K in keyof typeof ARCHIVE_GOALIE_KEYS]: number | null }

export interface ArchiveSeasonDetail {
  gameTitleId: number
  /** Null when the player has no reviewed skater rows for the title. */
  skater: ArchiveSkaterDetail | null
  goalie: ArchiveGoalieDetail | null
}

export interface ArchiveDetailSourceRow {
  gameTitleId: number
  roleGroup: string
  statsJson: unknown
}

/** "1,912" → 1912. Anything that isn't a plain non-negative count → null. */
export function parseArchiveCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(s)) return null
  return Number.parseInt(s.replaceAll(',', ''), 10)
}

/**
 * Sum each field across a title's mode rows. A field missing or unparseable
 * in ANY contributing row is null for the title — a partial sum would
 * understate the season, so it is never shown.
 */
function sumRows<K extends string>(
  rows: readonly ArchiveDetailSourceRow[],
  keys: Record<K, string>,
): Record<K, number | null> {
  const out = {} as Record<K, number | null>
  for (const field of Object.keys(keys) as K[]) {
    let total: number | null = 0
    for (const row of rows) {
      const json = row.statsJson
      const raw =
        json !== null && typeof json === 'object'
          ? (json as Record<string, unknown>)[keys[field]]
          : undefined
      const n = parseArchiveCount(raw)
      if (n === null) {
        total = null
        break
      }
      total += n
    }
    out[field] = total
  }
  return out
}

/** Group a player's reviewed archive rows by title and sum each role's detail. */
export function summarizeArchiveDetail(
  rows: readonly ArchiveDetailSourceRow[],
): ArchiveSeasonDetail[] {
  const byTitle = new Map<number, ArchiveDetailSourceRow[]>()
  for (const row of rows) {
    const list = byTitle.get(row.gameTitleId) ?? []
    list.push(row)
    byTitle.set(row.gameTitleId, list)
  }
  return [...byTitle].map(([gameTitleId, list]) => {
    const skaterRows = list.filter((r) => r.roleGroup === 'skater')
    const goalieRows = list.filter((r) => r.roleGroup === 'goalie')
    return {
      gameTitleId,
      skater: skaterRows.length > 0 ? sumRows(skaterRows, ARCHIVE_SKATER_KEYS) : null,
      goalie: goalieRows.length > 0 ? sumRows(goalieRows, ARCHIVE_GOALIE_KEYS) : null,
    }
  })
}
