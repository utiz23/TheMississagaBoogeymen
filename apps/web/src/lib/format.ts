/** The club's zone. Every date and time is read here, never in the server's
 *  zone (the live container runs UTC) or the viewer's (hydration). */
const CLUB_TIME_ZONE = 'America/Edmonton'
const CLUB_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: CLUB_TIME_ZONE, year: 'numeric' })

/**
 * Format a match date for display, in the club's zone.
 * Shows month/day and year only when it differs from the current year.
 */
export function formatMatchDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const sameYear = CLUB_YEAR.format(d) === CLUB_YEAR.format(new Date())
  return d.toLocaleDateString('en-US', {
    timeZone: CLUB_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Format match time as "9:40 PM", in the club's zone.
 */
export function formatMatchTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-US', {
    timeZone: CLUB_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
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
 * Format a long running total of seconds (season TOI, possession) as
 * "17d 22h 47m". Leading zero units are dropped; partial minutes are floored.
 * Returns "—" when null, non-finite or not positive.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d.toString()}d ${h.toString()}h ${m.toString()}m`
  if (h > 0) return `${h.toString()}h ${m.toString()}m`
  return `${m.toString()}m`
}

/**
 * Format a save percentage string from the DB (e.g. "67.00") as hockey style ".670".
 * Returns "—" when null or unparseable.
 */
export function formatSavePct(val: string | null): string {
  if (val === null) return '—'
  const n = parseFloat(val)
  if (!Number.isFinite(n)) return '—'
  const s = (n / 100).toFixed(3)
  return s.startsWith('0') ? s.slice(1) : s
}

const DATA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLUB_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const CLUB_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLUB_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "2026-10-09 21:14" in the club's zone (a game's time, not a fetch time). */
export function formatClubDateTime(date: Date | null | undefined): string | null {
  if (date === null || date === undefined || Number.isNaN(date.getTime())) return null
  return `${DATA_DAY.format(date)} ${CLUB_TIME.format(date)}`
}

/**
 * "Updated" stamps: the day data was last fetched, as "2026-10-09" in the
 * club's zone, so server and browser render the same text. "—" when unknown.
 */
export function formatDataDay(date: Date | string | null | undefined): string {
  if (date === null || date === undefined) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return DATA_DAY.format(d)
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
 * Win % as a display string (e.g. "78.3%") given a wins count and total games
 * played. Used for record summaries on `/stats`, chemistry tables, and
 * anywhere we want a one-decimal percentage of the team's overall record.
 *
 * Returns "—" when `gp <= 0` so the empty case matches the rest of the
 * formatter family.
 */
export function formatWinPct(wins: number, gp: number): string {
  if (gp <= 0) return '—'
  return `${((wins / gp) * 100).toFixed(1)}%`
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
    leftDefenseMen: 'LD',
    rightDefenseMen: 'RD',
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
    leftDefenseMen: 'Left Defense',
    rightDefenseMen: 'Right Defense',
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
 * Multi-word: initials from significant words, capped at 4 chars.
 * Common filler words are ignored when possible.
 */
export function abbreviateTeamName(name: string): string {
  const cleanedWords = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)

  if (cleanedWords.length === 0) return 'TEAM'

  if (cleanedWords.length === 1) return (cleanedWords[0] ?? '').slice(0, 4).toUpperCase()

  const fillerWords = new Set(['A', 'AN', 'AND', 'DE', 'LA', 'LE', 'OF', 'THE'])
  const significantWords = cleanedWords.filter((word) => !fillerWords.has(word.toUpperCase()))
  const sourceWords = significantWords.length > 0 ? significantWords : cleanedWords

  return sourceWords
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 4)
    .toUpperCase()
}

/**
 * Resolve an EA opponent crest asset ID to ordered CDN image URLs.
 * EA metadata is dirty, so callers should try the preferred path first
 * and fall back to the alternate path if the image 404s.
 */
export function opponentCrestUrls(
  crestAssetId: string | null | undefined,
  useBaseAsset: string | null | undefined,
): string[] {
  if (!crestAssetId) return []

  const baseUrl = `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t${crestAssetId}.png`
  const customUrl = `https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/custom-crests/${crestAssetId}.png`

  if (useBaseAsset === '1') {
    return [baseUrl, customUrl]
  }

  return [customUrl, baseUrl]
}

/**
 * A heading-length name: a multi-word name longer than 12 characters becomes
 * first initial + last word ("Matteo Lehmann" → "M. Lehmann"). Single-word
 * names (gamertags) and short names are unchanged.
 */
export function headingName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (name.length <= 12 || words.length < 2) return name
  const first = words[0] ?? ''
  const last = words[words.length - 1] ?? ''
  return /^[A-Za-z]/.test(first) ? `${first.charAt(0).toUpperCase()}. ${last}` : last
}
