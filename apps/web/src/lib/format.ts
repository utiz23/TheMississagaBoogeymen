/**
 * Format a match date for display.
 * Shows month/day and year only when it differs from the current year.
 */
export function formatMatchDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }
  return d.toLocaleDateString('en-US', opts)
}

/**
 * Format a score as "3–1" using an en-dash.
 */
export function formatScore(scoreFor: number, scoreAgainst: number): string {
  return `${scoreFor.toString()}–${scoreAgainst.toString()}`
}

/**
 * Convert seconds to "mm:ss". Returns "—" when null.
 */
export function formatTOA(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString()}:${s.toString().padStart(2, '0')}`
}

/**
 * Format a numeric percentage string from the DB (e.g. "52.50") as "52.50%".
 * Returns "—" when null.
 */
export function formatPct(val: string | null): string {
  if (val === null) return '—'
  return `${val}%`
}

/**
 * Derive the opponent's faceoff percentage from ours (they sum to 100).
 * Returns null when input is null.
 */
export function opponentFaceoffPct(ourPct: string | null): string | null {
  if (ourPct === null) return null
  const theirs = (100 - parseFloat(ourPct)).toFixed(2)
  return theirs
}
