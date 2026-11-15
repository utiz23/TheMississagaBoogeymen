// Goals by period read from video (task P1, operator decision D27: goals only, no shots).
// Pure helpers for the home panel table.

export interface PeriodGoalsRow {
  periodNumber: number
  goalsFor: number
  goalsAgainst: number
}

const LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: 'OT', 5: 'OT2', 6: 'OT3' }

/** "1st", "2nd", "3rd", "OT", "OT2", "OT3"; anything else "P7". */
export function periodWord(n: number): string {
  return LABELS[n] ?? `P${String(n)}`
}
