/**
 * Failure isolation for the active-title `/roster` page.
 *
 * Each query settles independently into `ok | error`. A failed query must NEVER
 * be presented as an empty roster or a zero-stat table, and one failure must
 * not blank the sections that do not depend on it:
 *
 *   getEARoster                  → Ledger + Depth chart + "no player stats yet" gate
 *   getPlayerPositionEligibility → Depth chart only
 *   skater stats                 → Skater table only
 *   goalie stats                 → Goalie table only
 */

export type Loaded<T> = { status: 'ok'; data: T } | { status: 'error' }

export type ErrorLogger = (label: string, error: unknown) => void

const defaultLogger: ErrorLogger = (label, error) => {
  console.error(`[roster] ${label} failed`, error)
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

export interface RosterFetchers<R, E, S, G> {
  roster: () => Promise<R[]>
  eligibility: () => Promise<E[]>
  skaters: () => Promise<S[]>
  goalies: () => Promise<G[]>
}

export interface RosterData<R, E, S, G> {
  roster: Loaded<R[]>
  eligibility: Loaded<E[]>
  skaters: Loaded<S[]>
  goalies: Loaded<G[]>
}

/** Fetch the four core queries in parallel, each settled on its own. Re-runs fresh on every call (Retry). */
export async function loadRosterData<R, E, S, G>(
  f: RosterFetchers<R, E, S, G>,
  log: ErrorLogger = defaultLogger,
): Promise<RosterData<R, E, S, G>> {
  const [roster, eligibility, skaters, goalies] = await Promise.all([
    settle('getEARoster', f.roster, log),
    settle('getPlayerPositionEligibility', f.eligibility, log),
    settle('skater stats', f.skaters, log),
    settle('goalie stats', f.goalies, log),
  ])
  return { roster, eligibility, skaters, goalies }
}

export interface TableSection {
  /** `error` = the query failed (show an error + Retry, never rows or "no data"). */
  state: 'ok' | 'error'
  /** Only meaningful when state is `ok`: the query succeeded and returned no rows. */
  empty: boolean
}

export interface RosterSections {
  /** getEARoster succeeded with zero rows: the whole page shows "no player stats recorded". */
  pageEmpty: boolean
  /** Roster Ledger needs roster rows only. */
  summary: 'ready' | 'unavailable'
  /** Depth chart needs roster rows AND eligibility; without eligibility it is unavailable, never guessed. */
  depthChart: 'ready' | 'unavailable'
  skaters: TableSection
  goalies: TableSection
}

const table = (l: Loaded<readonly unknown[]>): TableSection =>
  l.status === 'error'
    ? { state: 'error', empty: false }
    : { state: 'ok', empty: l.data.length === 0 }

export function deriveRosterSections(d: {
  roster: Loaded<readonly unknown[]>
  eligibility: Loaded<readonly unknown[]>
  skaters: Loaded<readonly unknown[]>
  goalies: Loaded<readonly unknown[]>
}): RosterSections {
  const rosterFailed = d.roster.status === 'error'
  return {
    pageEmpty: d.roster.status === 'ok' && d.roster.data.length === 0,
    summary: rosterFailed ? 'unavailable' : 'ready',
    depthChart: rosterFailed || d.eligibility.status === 'error' ? 'unavailable' : 'ready',
    skaters: table(d.skaters),
    goalies: table(d.goalies),
  }
}
