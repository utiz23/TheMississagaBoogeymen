/**
 * Render an ASCII rink showing all `match_events` with x,y, highlighting
 * Class C collision pairs (events whose markers are within 1.0 hockey unit
 * of another event in the same period). Diagnostic for Phase 5b.2.
 *
 * Usage:
 *   pnpm --filter worker match-rink-diff --match 463
 *   pnpm --filter worker match-rink-diff --match 463 --period 2
 */

import { db, sql as dbSql, matchEvents } from '@eanhl/db'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

const RINK_X_MIN = -100
const RINK_X_MAX = 100
const RINK_Y_MIN = -42.5
const RINK_Y_MAX = 42.5
const COLS = 80
const ROWS = 20

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

interface EventRow {
  id: number
  period: number
  clock: string | null
  eventType: string
  teamSide: 'for' | 'against' | null
  actor: string | null
  x: number
  y: number
}

interface CollisionPair {
  a_id: number
  b_id: number
}

async function loadEvents(matchId: number, period: number | null): Promise<EventRow[]> {
  const where = and(
    eq(matchEvents.matchId, matchId),
    isNotNull(matchEvents.x),
    isNotNull(matchEvents.y),
    period !== null ? eq(matchEvents.periodNumber, period) : sql`TRUE`,
  )
  const rows = await db
    .select({
      id: matchEvents.id,
      period: matchEvents.periodNumber,
      clock: matchEvents.clock,
      eventType: matchEvents.eventType,
      teamSide: matchEvents.teamSide,
      actor: matchEvents.actorGamertagSnapshot,
      x: matchEvents.x,
      y: matchEvents.y,
    })
    .from(matchEvents)
    .where(where)
    .orderBy(matchEvents.periodNumber, matchEvents.clock)
  return rows.map((r) => ({
    id: r.id,
    period: r.period,
    clock: r.clock,
    eventType: r.eventType,
    teamSide: r.teamSide as 'for' | 'against' | null,
    actor: r.actor,
    x: Number(r.x),
    y: Number(r.y),
  }))
}

async function loadCollisions(matchId: number): Promise<Set<number>> {
  const rows = (await db.execute(sql`
    SELECT a.id AS a_id, b.id AS b_id
    FROM ${matchEvents} a
    JOIN ${matchEvents} b ON
         a.match_id = b.match_id
     AND a.period_number = b.period_number
     AND a.id < b.id
     AND a.x IS NOT NULL AND b.x IS NOT NULL
     AND ABS((a.x::numeric) - (b.x::numeric)) <= 1.0
     AND ABS((a.y::numeric) - (b.y::numeric)) <= 1.0
    WHERE a.match_id = ${matchId}
  `)) as unknown as CollisionPair[]
  const involved = new Set<number>()
  for (const p of rows) {
    involved.add(Number(p.a_id))
    involved.add(Number(p.b_id))
  }
  return involved
}

function projectX(x: number): number {
  const t = (x - RINK_X_MIN) / (RINK_X_MAX - RINK_X_MIN)
  return Math.round(t * (COLS - 1))
}

function projectY(y: number): number {
  // y is negative-down in hockey coords; invert for ASCII (row 0 is top).
  const t = 1 - (y - RINK_Y_MIN) / (RINK_Y_MAX - RINK_Y_MIN)
  return Math.round(t * (ROWS - 1))
}

function glyphFor(ev: EventRow, inCollision: boolean): string {
  if (inCollision) return '#' // collision-flagged
  const base =
    ev.eventType === 'shot'
      ? 's'
      : ev.eventType === 'hit'
        ? 'h'
        : ev.eventType === 'goal'
          ? 'G'
          : ev.eventType === 'faceoff'
            ? 'f'
            : ev.eventType === 'penalty'
              ? 'P'
              : '?'
  return ev.teamSide === 'for' ? base.toUpperCase() : base.toLowerCase()
}

function renderRink(
  matchId: number,
  events: EventRow[],
  collisions: Set<number>,
  period: number | null,
): string {
  const grid: string[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => '·'),
  )

  // Rink centre line + blue lines
  const centerCol = projectX(0)
  const blueLeftCol = projectX(-25)
  const blueRightCol = projectX(25)
  for (let r = 0; r < ROWS; r++) {
    grid[r]![centerCol] = '|'
    if (grid[r]![blueLeftCol] === '·') grid[r]![blueLeftCol] = ':'
    if (grid[r]![blueRightCol] === '·') grid[r]![blueRightCol] = ':'
  }

  // Goal lines (~88 from centre, but rink coords X_MAX is 100; in this system the
  // goal lines sit ~89 from centre. Approximation good enough for ASCII.)
  for (let r = 0; r < ROWS; r++) {
    grid[r]![projectX(-89)] = grid[r]![projectX(-89)] === '·' ? '.' : grid[r]![projectX(-89)]!
    grid[r]![projectX(89)] = grid[r]![projectX(89)] === '·' ? '.' : grid[r]![projectX(89)]!
  }

  for (const ev of events) {
    const col = Math.max(0, Math.min(COLS - 1, projectX(ev.x)))
    const row = Math.max(0, Math.min(ROWS - 1, projectY(ev.y)))
    const isCollision = collisions.has(ev.id)
    grid[row]![col] = glyphFor(ev, isCollision)
  }

  const periodLabel = period === null ? 'All periods' : `Period ${period}`
  const lines: string[] = []
  lines.push('')
  lines.push(`Match ${matchId} — ${periodLabel}`)
  lines.push(
    `Glyphs: G/g=goal  S/s=shot  H/h=hit  F/f=faceoff  P/p=penalty  (upper=BGM, lower=opp)`,
  )
  lines.push(`Markers in Class C collision pair (within 1.0 hockey unit of another event): #`)
  lines.push('')
  lines.push(' OPP ATK ←' + '─'.repeat(COLS - 14) + '→ BGM ATK')
  for (const row of grid) lines.push(' ' + row.join(''))
  lines.push('')
  return lines.join('\n')
}

function renderCollisionList(events: EventRow[], collisions: Set<number>): string {
  const colliding = events.filter((e) => collisions.has(e.id))
  if (colliding.length === 0) return 'No marker collisions.'
  const byPos = new Map<string, EventRow[]>()
  for (const ev of colliding) {
    const key = `${ev.period}:${Math.round(ev.x * 10) / 10},${Math.round(ev.y * 10) / 10}`
    const arr = byPos.get(key) ?? []
    arr.push(ev)
    byPos.set(key, arr)
  }
  const lines: string[] = []
  lines.push('--- Class C collision pairs ---')
  // Group by (period, rounded x, rounded y) to surface which events share a position
  const groups = [...byPos.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [, group] of groups) {
    if (group.length < 2) continue
    const first = group[0]!
    lines.push(`  P${first.period} @(${first.x.toFixed(2)}, ${first.y.toFixed(2)}):`)
    for (const ev of group) {
      lines.push(
        `    id=${ev.id}  ${ev.eventType}@${ev.clock}  ${ev.teamSide}  actor="${ev.actor ?? '?'}"`,
      )
    }
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const matchStr = getFlag('match')
  const periodStr = getFlag('period')
  if (!matchStr) {
    console.log('Usage: pnpm --filter worker match-rink-diff --match <id> [--period <n>]')
    process.exitCode = 1
    return
  }
  const matchId = Number.parseInt(matchStr, 10)
  const period = periodStr ? Number.parseInt(periodStr, 10) : null
  if (!Number.isFinite(matchId) || (periodStr && !Number.isFinite(period))) {
    console.error('Invalid --match or --period')
    process.exitCode = 1
    return
  }
  const events = await loadEvents(matchId, period)
  const collisions = await loadCollisions(matchId)
  console.log(renderRink(matchId, events, collisions, period))
  console.log(renderCollisionList(events, collisions))
}

main()
  .catch((err: unknown) => {
    console.error('[match-rink-diff] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
