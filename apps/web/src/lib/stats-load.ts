/**
 * Failure isolation for the player-stat and archive queries on `/stats`.
 *
 * Deliberately a separate module from `apps/web/src/lib/roster-load.ts`
 * rather than a reuse of it: that module's default logger prefixes every
 * failure with `[roster]`, which would mislabel a `/stats` failure. The
 * `settle`/`Loaded` shape here is intentionally the same contract (so the
 * two pages compose the same way), but this module's own default logger
 * prefixes with `[stats]`.
 *
 * Each query settles independently into `ok | error`. A failed query must
 * NEVER be presented as an empty table or converted to `[]` — the caller
 * always has the settled result available to distinguish "loaded, zero
 * rows" from "failed to load".
 */

export type Loaded<T> = { status: 'ok'; data: T } | { status: 'error' }

export type ErrorLogger = (label: string, error: unknown) => void

const defaultLogger: ErrorLogger = (label, error) => {
  console.error(`[stats] ${label} failed`, error)
}

/** Run a query; convert a throw/rejection into `{status:'error'}` (logged), never propagate. */
export async function settle<T>(
  label: string,
  run: () => Promise<T>,
  log: ErrorLogger = defaultLogger,
): Promise<Loaded<T>> {
  try {
    return { status: 'ok', data: await run() }
  } catch (error) {
    log(label, error)
    return { status: 'error' }
  }
}

/**
 * Rows to render for a table body. A failed query renders `[]` here ONLY
 * because callers pair this with `resolveTablePresentation` (or the raw
 * `.status`) to render the error state instead — the empty array here is
 * never read as "no data" on its own.
 */
export function rowsOrEmpty<T>(l: Loaded<readonly T[]>): T[] {
  return l.status === 'ok' ? [...l.data] : []
}

/**
 * The one three-way decision every player-stat/archive table on `/stats`
 * needs to render correctly:
 *   - a failed query is `'error'` (the table's own unavailable state, never
 *     a false empty result)
 *   - a successful, genuinely empty result is `'empty'` (an explicit
 *     role/source-specific empty message, never silently omitted and never
 *     shown as an error)
 *   - a successful, non-empty result is `'rows'`, carrying the rows
 *
 * Kept as one pure function so every call site (active skaters/goalies,
 * archive club-member/player-card skaters/goalies, archive club/team) makes
 * this decision identically and it is exhaustively testable without a page
 * render.
 */
export type TablePresentation<T> =
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'rows'; rows: T[] }

export function resolveTablePresentation<T>(l: Loaded<readonly T[]>): TablePresentation<T> {
  if (l.status === 'error') return { kind: 'error' }
  if (l.data.length === 0) return { kind: 'empty' }
  return { kind: 'rows', rows: [...l.data] }
}

/**
 * Whether the active-title Skaters/Goalies module has anything to show.
 *
 * Gating this on club-level activity alone (e.g. `clubStats.gamesPlayed > 0`)
 * is wrong: a brand-new or currently-empty season can still have non-empty
 * career (All Time) rows, or a genuinely failed query, and both of those are
 * real state that must render — a failed query must never be hidden, and a
 * successful non-empty All Time dataset must never be hidden just because
 * Current happens to be empty this season.
 *
 * The module only stays hidden when every one of the four player queries
 * succeeded and came back empty — at that point there is truly nothing to
 * show, and the page-top "No stats recorded" notice already covers it.
 */
export function shouldShowPlayerModule(datasets: {
  /** The club-level "any activity this season" signal — kept as one more
   * reason to show the module, never the only one. */
  hasClubActivity: boolean
  currentSkaters: Loaded<readonly unknown[]>
  currentGoalies: Loaded<readonly unknown[]>
  allTimeSkaters: Loaded<readonly unknown[]>
  allTimeGoalies: Loaded<readonly unknown[]>
}): boolean {
  const { hasClubActivity, currentSkaters, currentGoalies, allTimeSkaters, allTimeGoalies } =
    datasets
  if (hasClubActivity) return true
  const anyFailed =
    currentSkaters.status === 'error' ||
    currentGoalies.status === 'error' ||
    allTimeSkaters.status === 'error' ||
    allTimeGoalies.status === 'error'
  if (anyFailed) return true
  return (
    rowsOrEmpty(currentSkaters).length > 0 ||
    rowsOrEmpty(currentGoalies).length > 0 ||
    rowsOrEmpty(allTimeSkaters).length > 0 ||
    rowsOrEmpty(allTimeGoalies).length > 0
  )
}
