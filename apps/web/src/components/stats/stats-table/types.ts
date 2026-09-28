import type { CareerCoverage, EAGoalieExpandedRow, EASkaterExpandedRow } from '@eanhl/db/queries'

export type { CareerCoverage }

/** Where a table's rows come from. Sources are never merged. */
export type StatsSourceKind =
  | 'ea-season'
  | 'local-tracked'
  | 'archive-club-member'
  | 'archive-player-card'
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
  /** Set only on career (All Time) rows — the GP from exactly the TOI-covered
   * source rows, the correct TOI/GP denominator. Undefined for every other
   * source (EA, local, archive), which use `gamesPlayed` directly. */
  toiCoverageGp?: number
  toiCoverage?: CareerCoverage
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
  /** Career-only TOI coverage — see `SkaterDisplayRow.toiCoverageGp`. */
  toiCoverageGp?: number
  toiCoverage?: CareerCoverage
  /** Career-only GAA coverage: GA/GP from exactly the rows with BOTH TOI and
   * GA recorded — the correct GAA numerator/denominator pairing. */
  gaaCoveredGoalsAgainst?: number | null
  gaaCoverageGp?: number
  gaaCoverage?: CareerCoverage
}
