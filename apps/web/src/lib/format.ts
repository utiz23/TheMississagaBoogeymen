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

/** Map EA position strings to short display labels. */
export function formatPosition(pos: string): string {
  const map: Record<string, string> = {
    goalie: 'G',
    center: 'C',
    defenseMen: 'D',
    leftWing: 'LW',
    rightWing: 'RW',
  }
  return map[pos] ?? pos
}

/** Map EA position strings to full display labels for the player card pill. */
export function formatPositionFull(pos: string): string {
  const map: Record<string, string> = {
    goalie: 'Goalie',
    center: 'Center',
    defenseMen: 'Defense',
    leftWing: 'Left Wing',
    rightWing: 'Right Wing',
  }
  return map[pos] ?? pos
}

/**
 * Format a W-L-OTL record as "8–3–1".
 */
export function formatRecord(wins: number, losses: number, otl: number): string {
  return `${wins.toString()}–${losses.toString()}–${otl.toString()}`
}

/**
 * Derive a short team code from a full club name.
 * Single word: first 4 chars uppercase.
 * Multi-word: initials (first char of each word), capped at 4 chars.
 * Examples: "Samurai" → "SAMU", "Le Duo Plus Mario" → "LDPM", "BGM" → "BGM"
 */
export function abbreviateTeamName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return (words[0] ?? '').slice(0, 4).toUpperCase()
  return words
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 4)
    .toUpperCase()
}
