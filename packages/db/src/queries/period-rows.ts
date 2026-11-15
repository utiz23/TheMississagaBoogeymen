/**
 * Pure rules for the per-period rows that come from the engine's video readings
 * (`match_period_summaries.source = 'engine_video'`, task P1). No database here,
 * so the rules are unit-testable without a connection.
 *
 * Two rules, both about "a period box must add up to EA's final score":
 *
 *   1. `periodGoalsMatchFinal` — the period goals must sum to EA's final score.
 *      The importer refuses to write a match that fails it; the read side checks
 *      again, so a row edited or written some other way is still never shown.
 *   2. `preferOtherSourceRows` — other sources (EA, reviewed OCR, manual) keep
 *      winning. Engine rows are shown only when no other source has a visible row
 *      for the match, so nothing that shows today changes.
 */

export const ENGINE_VIDEO_SOURCE = 'engine_video' as const

export interface PeriodGoalsRow {
  periodNumber: number
  goalsFor: number | null
  goalsAgainst: number | null
}

/**
 * True when every period has both goal counts and the sums equal EA's final score.
 * An empty list is false: no periods proves nothing.
 */
export function periodGoalsMatchFinal(
  rows: readonly PeriodGoalsRow[],
  scoreFor: number,
  scoreAgainst: number,
): boolean {
  if (rows.length === 0) return false
  let forSum = 0
  let againstSum = 0
  for (const r of rows) {
    if (r.goalsFor === null || r.goalsAgainst === null) return false
    forSum += r.goalsFor
    againstSum += r.goalsAgainst
  }
  return forSum === scoreFor && againstSum === scoreAgainst
}

/**
 * Engine rows yield to any other source's rows. Returns the other sources' rows
 * when there are any, else the engine rows. Row order is kept.
 */
export function preferOtherSourceRows<T extends { source: string }>(rows: readonly T[]): T[] {
  const others = rows.filter((r) => r.source !== ENGINE_VIDEO_SOURCE)
  return others.length > 0 ? others : [...rows]
}

/** Drop the engine rows of a match whose period goals do not add up to EA's final. */
export function dropUnverifiedEngineRows<T extends PeriodGoalsRow & { source: string }>(
  rows: readonly T[],
  scoreFor: number,
  scoreAgainst: number,
): T[] {
  const engine = rows.filter((r) => r.source === ENGINE_VIDEO_SOURCE)
  if (engine.length === 0) return [...rows]
  const ok = periodGoalsMatchFinal(engine, scoreFor, scoreAgainst)
  return ok ? [...rows] : rows.filter((r) => r.source !== ENGINE_VIDEO_SOURCE)
}
