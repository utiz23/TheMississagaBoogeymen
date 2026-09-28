import type { StatsSource, StatsSourceKind } from './types.ts'

export const LOCAL_RECORD_NOTE =
  'W / L / OTL are not shown for local 6s/3s: the stored record counts a player’s results in every role, not only games in goal. EA season totals (All) carry the goalie-only record.'

export const CAREER_TOI_NOTE =
  'Career TOI is missing for some seasons, so TOI/GP and GAA may be inaccurate. Coverage review is pending.'

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

export function collectFootnotes(args: {
  role: 'skaters' | 'goalies'
  scope: 'current' | 'allTime'
  source: StatsSource
  visibleKeys: readonly string[]
  activeRows: readonly { recordUnavailable?: boolean }[]
}): string[] {
  const notes: string[] = [...(args.source.notes ?? [])]
  if (args.scope === 'allTime') notes.push(CAREER_TOI_NOTE)
  if (localRecordNoteVisible(args.role, args.visibleKeys, args.activeRows)) {
    notes.push(LOCAL_RECORD_NOTE)
  }
  return notes
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
