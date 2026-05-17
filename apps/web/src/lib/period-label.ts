// apps/web/src/lib/period-label.ts

/**
 * Short period labels used by all match-page filter chips.
 * Regulation periods are 1–3; periods 4+ are OT (4=OT, 5=OT2, 6=OT3).
 * Note: EASHL has no shootout — period 6 is OT3, never SO.
 */
export function formatPeriodLabel(n: number): string {
  if (n === 1) return '1ST'
  if (n === 2) return '2ND'
  if (n === 3) return '3RD'
  if (n === 4) return 'OT'
  if (n === 5) return 'OT2'
  if (n === 6) return 'OT3'
  return `P${String(n)}`
}

/** Period numbers always shown in filters (regulation). */
export const REGULATION_PERIODS = [1, 2, 3] as const

/**
 * Build the list of period numbers to show in a filter, always including
 * regulation 1–3 plus any OT periods present in the data. Use the highest
 * period seen in the data to decide which OT periods to include (so if the
 * game went to OT2 we show 1, 2, 3, OT, OT2 — even if some are empty).
 */
export function periodsToShow(maxPeriodSeen: number): readonly number[] {
  if (maxPeriodSeen <= 3) return REGULATION_PERIODS
  const ot: number[] = []
  for (let n = 4; n <= maxPeriodSeen; n += 1) ot.push(n)
  return [...REGULATION_PERIODS, ...ot]
}
