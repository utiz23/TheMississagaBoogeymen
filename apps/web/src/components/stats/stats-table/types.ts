import type { EAGoalieExpandedRow, EASkaterExpandedRow } from '@eanhl/db/queries'

/** Where a table's rows come from. Sources are never merged. */
export type StatsSourceKind =
  | 'ea-season'
  | 'local-tracked'
  | 'archive-club-member'
  | 'career'
  | 'unspecified'

export interface StatsSource {
  kind: StatsSourceKind
  /** Short badge text, e.g. "EA season totals". */
  label: string
  /** One-sentence explanation shown beside the badge. */
  description?: string
  /** Static footnotes for this source. */
  notes?: string[]
}

export type SkaterExpanded = Omit<EASkaterExpandedRow, 'playerId'>
export type GoalieExpanded = Omit<EAGoalieExpandedRow, 'playerId'>

export interface BaseDisplayRow {
  playerId: number | null
  gamertag: string
  /** Role GP: skater GP for skater rows, goalie GP for goalie rows. */
  gamesPlayed: number | null
}

/** Every numeric field is nullable so an unavailable value can never be mistaken for 0. */
export interface SkaterDisplayRow extends BaseDisplayRow {
  position: string | null
  goals: number | null
  assists: number | null
  points: number | null
  plusMinus: number | null
  pim: number | null
  shots: number | null
  hits: number | null
  takeaways: number | null
  giveaways: number | null
  faceoffPct: string | null
  passPct: string | null
  shotAttempts: number | null
  toiSeconds: number | null
  expanded: SkaterExpanded | null
}

export interface GoalieDisplayRow extends BaseDisplayRow {
  wins: number | null
  losses: number | null
  otl: number | null
  savePct: string | null
  gaa: string | null
  shutouts: number | null
  totalSaves: number | null
  totalShotsAgainst: number | null
  totalGoalsAgainst: number | null
  toiSeconds: number | null
  /** Set only by the local 6s/3s query: W/L/OTL withheld (player-wide, not goalie-only). */
  recordUnavailable: boolean
  expanded: GoalieExpanded | null
}
