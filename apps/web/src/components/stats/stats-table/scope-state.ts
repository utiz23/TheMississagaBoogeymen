/**
 * Pure Current/All-Time scope derivation for `StatsTableShell`.
 *
 * The shell's `state` prop describes the CURRENT dataset's load result only.
 * Before this fix the shell applied it unconditionally, so a failed Current
 * query kept showing the error panel even after the viewer switched to a
 * successfully loaded All Time dataset — and a successful All Time dataset
 * could never actually be seen behind that error. These two functions are
 * the shell's single source of truth for scope selection and per-scope
 * state, kept pure and separate from the component so the exact failure
 * matrix (Current failure + All Time success, and vice versa, in both scope
 * directions) is directly testable.
 */

export type LoadState = 'ok' | 'error'
export type Scope = 'current' | 'allTime'

export interface ScopeAvailability {
  /** All Time can only ever be selected when it is a genuine, non-empty, successful dataset. */
  canAllTime: boolean
  /** The scope actually rendered — falls back to 'current' when All Time was requested but isn't available. */
  activeScope: Scope
}

/**
 * `allTimeRowCount` is 0 both when the All Time query never ran and when it
 * failed (a failed query's rows are always `[]` — see `rowsOrEmpty`), so a
 * failed All Time query can never be force-selected: the toggle stays
 * visible-but-disabled (driven separately by `allTimeUnavailable`), and the
 * scope collapses back to Current.
 */
export function resolveScopeAvailability(
  requestedScope: Scope,
  allTimeRowCount: number,
): ScopeAvailability {
  const canAllTime = allTimeRowCount > 0
  const activeScope = requestedScope === 'allTime' && canAllTime ? 'allTime' : 'current'
  return { canAllTime, activeScope }
}

/**
 * The Current dataset's `state` never applies to the All Time scope: All
 * Time only ever renders when `resolveScopeAvailability` already proved it a
 * successful, non-empty dataset, so it is always `'ok'` when active,
 * regardless of whether Current failed.
 */
export function resolveScopeState(activeScope: Scope, currentState: LoadState): LoadState {
  return activeScope === 'current' ? currentState : 'ok'
}
