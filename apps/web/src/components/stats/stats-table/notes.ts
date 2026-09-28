import type { CellAnnotation } from './metrics.ts'
import type { CareerCoverage, StatsSource, StatsSourceKind } from './types.ts'

export const LOCAL_RECORD_NOTE =
  'W / L / OTL are not shown for local 6s/3s: the stored record counts a player’s results in every role, not only games in goal. EA season totals (All) carry the goalie-only record.'

/**
 * Shown only when the All Time scope actually has a partial-coverage row on
 * a visible TOI/GAA metric — see `careerToiFootnoteVisible`. Superseded the
 * old "Coverage review is pending" wording once the coverage math itself was
 * fixed (see `career-coverage.ts`).
 */
export const CAREER_TOI_COVERAGE_FOOTNOTE =
  '* TOI-based values use only games with recorded time on ice. Earlier player-card seasons without TOI are excluded.'

export const EXPANDED_UNAVAILABLE_NOTE =
  'Expanded EA stats (PPG, GWG, possession, breakaways …) are only available for the active title in All mode.'

export const EXPANDED_FETCH_FAILED_NOTE = 'Expanded EA stats are unavailable right now.'

const RECORD_KEYS = ['w', 'l', 'otl']

/**
 * The local-record footnote shows only when the rows currently on screen carry
 * `recordUnavailable` AND a W/L/OTL column is visible. Pass the ACTIVE rows
 * (they change when the Current / All Time scope switches).
 */
export function localRecordNoteVisible(
  role: 'skaters' | 'goalies',
  visibleKeys: readonly string[],
  activeRows: readonly { recordUnavailable?: boolean }[],
): boolean {
  return (
    role === 'goalies' &&
    visibleKeys.some((k) => RECORD_KEYS.includes(k)) &&
    activeRows.some((r) => r.recordUnavailable === true)
  )
}

interface CoverageRow {
  toiCoverage?: CareerCoverage
  gaaCoverage?: CareerCoverage
}

/**
 * The coverage footnote is All-Time-only, and it inspects only the coverage
 * that a currently-visible column actually uses: a visible `toi`/`toigp`
 * column checks `toiCoverage`, and a visible `gaa` column checks
 * `gaaCoverage`. This keeps the footnote metric-specific — e.g. a partial
 * `toiCoverage` on a row must not surface the `*` note when only `gaa` (using
 * `gaaCoverage`) is on screen, since no visible cell on that row would
 * actually carry the marker. When both kinds of column are visible, either
 * one having a partial row is enough. Complete-only or unavailable-only
 * data, Current scope, and unrelated views (neither TOI nor GAA columns
 * visible) never show it.
 */
export function careerToiFootnoteVisible(
  scope: 'current' | 'allTime',
  visibleKeys: readonly string[],
  activeRows: readonly CoverageRow[],
): boolean {
  if (scope !== 'allTime') return false
  const toiVisible = visibleKeys.includes('toi') || visibleKeys.includes('toigp')
  const gaaVisible = visibleKeys.includes('gaa')
  if (!toiVisible && !gaaVisible) return false
  return activeRows.some(
    (r) =>
      (toiVisible && r.toiCoverage?.state === 'partial') ||
      (gaaVisible && r.gaaCoverage?.state === 'partial'),
  )
}

export function collectFootnotes(args: {
  role: 'skaters' | 'goalies'
  scope: 'current' | 'allTime'
  source: StatsSource
  visibleKeys: readonly string[]
  activeRows: readonly (CoverageRow & { recordUnavailable?: boolean })[]
}): string[] {
  const notes: string[] = [...(args.source.notes ?? [])]
  if (careerToiFootnoteVisible(args.scope, args.visibleKeys, args.activeRows)) {
    notes.push(CAREER_TOI_COVERAGE_FOOTNOTE)
  }
  if (localRecordNoteVisible(args.role, args.visibleKeys, args.activeRows)) {
    notes.push(LOCAL_RECORD_NOTE)
  }
  return notes
}

/** Accessible/title wording for a skater career TOI/GP cell (or goalie TOI/TOI-GP). */
export function toiCoverageAnnotation(
  coverage: CareerCoverage | undefined,
): CellAnnotation | undefined {
  if (coverage === undefined) return undefined
  if (coverage.state === 'complete') {
    return { srText: `Based on all ${String(coverage.totalGp)} GP with recorded time on ice.` }
  }
  if (coverage.state === 'partial') {
    return {
      marker: '*',
      srText: `Based on ${String(coverage.coveredGp)} of ${String(coverage.totalGp)} GP with recorded time on ice.`,
    }
  }
  return { srText: 'No time on ice was recorded for this player’s career history.' }
}

/** Accessible/title wording for a goalie career GAA cell. */
export function gaaCoverageAnnotation(
  coverage: CareerCoverage | undefined,
): CellAnnotation | undefined {
  if (coverage === undefined) return undefined
  if (coverage.state === 'complete') {
    return {
      srText: `Based on all ${String(coverage.totalGp)} GP with recorded time on ice and goals against.`,
    }
  }
  if (coverage.state === 'partial') {
    return {
      marker: '*',
      srText: `Based on ${String(coverage.coveredGp)} of ${String(coverage.totalGp)} GP with recorded time on ice and goals against.`,
    }
  }
  return {
    srText:
      'No matching time-on-ice and goals-against coverage is available for this player’s career history.',
  }
}

/** The failure notice belongs to the current (active-title, All-mode) scope only. */
export function expandedFailedNoteVisible(
  scope: 'current' | 'allTime',
  expandedFailed: boolean,
): boolean {
  return expandedFailed && scope === 'current'
}

/**
 * The generic "expanded stats are only available for the active title in All
 * mode" explanation is for sources where expanded data is genuinely out of
 * scope (local 6s/3s, archive, career). It is suppressed when the expanded
 * query FAILED in the current scope: the user is already in the All-mode
 * context, so the failure notice alone is accurate.
 */
export function expandedKeyNoteVisible(args: {
  hasExpanded: boolean
  sourceKind: StatsSourceKind
  scope: 'current' | 'allTime'
  expandedFailed: boolean
}): boolean {
  if (args.hasExpanded) return false
  if (args.sourceKind === 'unspecified') return false
  if (expandedFailedNoteVisible(args.scope, args.expandedFailed)) return false
  return true
}
