// Goals by period read from video (task P1, operator decision D27: goals only, no shots).
// Pure helpers for the compact card line and the home panel table.

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

/** One cell of the card line: `{ label: '1st', score: '2–1' }` (BGM goals first, en dash). */
export function periodGoalCells(
  rows: readonly PeriodGoalsRow[],
): { label: string; score: string }[] {
  return [...rows]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((r) => ({
      label: periodWord(r.periodNumber),
      score: `${String(r.goalsFor)}–${String(r.goalsAgainst)}`,
    }))
}

/** The same line as plain text: "1st 2–1 · 2nd 1–1 · 3rd 2–1 · OT 1–0" (for aria-labels and tests). */
export function periodGoalsText(rows: readonly PeriodGoalsRow[]): string {
  return periodGoalCells(rows)
    .map((c) => `${c.label} ${c.score}`)
    .join(' · ')
}
