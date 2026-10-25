/**
 * Night and week keys for the news desk. A "night" runs from 06:00 to 06:00
 * America/Edmonton, so a game that ends after midnight still belongs to the
 * evening it started in. Same rule as the SQL
 * `((played_at at time zone 'America/Edmonton') - interval '6 hours')::date`:
 * take the Edmonton wall clock, then subtract 6 h from the wall clock.
 */

const EDMONTON = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Edmonton',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function isoDay(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
}

function parseNight(night: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night)
  if (!m) throw new Error(`news keys: "${night}" is not a YYYY-MM-DD night`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (isoDay(d) !== night) throw new Error(`news keys: "${night}" is not a real date`)
  return d
}

/** The night (`YYYY-MM-DD`) a game that ended at `playedAt` belongs to. */
export function nightKey(playedAt: Date): string {
  if (Number.isNaN(playedAt.getTime())) throw new Error('news keys: invalid date')
  const parts: Record<string, number> = {}
  for (const p of EDMONTON.formatToParts(playedAt)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const wall = Date.UTC(
    parts['year']!,
    parts['month']! - 1,
    parts['day']!,
    parts['hour']!,
    parts['minute']!,
    parts['second']!,
  )
  return isoDay(new Date(wall - SIX_HOURS_MS))
}

/** The Monday (`YYYY-MM-DD`) of the week that `night` falls in. Weeks run Monday to Sunday. */
export function weekStart(night: string): string {
  const d = parseNight(night)
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return isoDay(new Date(d.getTime() - sinceMonday * DAY_MS))
}

/** The seven nights of the week that starts on Monday `start`. */
export function nightsOfWeek(start: string): string[] {
  const first = parseNight(start).getTime()
  return Array.from({ length: 7 }, (_, i) => isoDay(new Date(first + i * DAY_MS)))
}

/** The `count` Mondays before Monday `start`, oldest first. */
export function previousWeekStarts(start: string, count: number): string[] {
  const d = parseNight(start)
  if (d.getUTCDay() !== 1) throw new Error(`news keys: "${start}" is not a Monday`)
  return Array.from({ length: count }, (_, i) =>
    isoDay(new Date(d.getTime() - (count - i) * 7 * DAY_MS)),
  )
}

const LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

/**
 * A night key as people say it: "Monday, October 12". The key is already the
 * America/Edmonton evening date, so the label is that date, no time zone shift.
 */
export function nightLabel(night: string): string {
  return LABEL.format(parseNight(night))
}
