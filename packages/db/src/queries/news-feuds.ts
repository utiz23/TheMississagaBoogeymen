import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  FEUD_HALF_LIFE_DAYS,
  FEUD_MAX_POINTS,
  decayedPoints,
  feudLevelOf,
  type FeudLevel,
} from '../news/feuds.js'
import type { NewsReporterId } from '../schema/index.js'

// Reporter feud queries (T5, migration 0076). `addFeudPointsSql` is pinned by
// `__tests__/news-feuds.test.ts`. The level is never stored: it is read from
// the faded points (`news/feuds.ts`).

const DISPLAY_NAME = sql.raw(`coalesce(nullif(btrim(pp.player_name), ''), p.gamertag)`)
const num = (v: string | number): number => Number(v)

/** Rows older than this have faded below every level and are not read. */
const FEUD_READ_DAYS = 90

/**
 * Adds `points` to the pair, in one statement. The stored total is faded to
 * `at` first, the new total is capped (`FEUD_MAX_POINTS`), and `last_event_at`
 * moves to `at`. Table-qualified columns: the existing row is `news_press_feuds`.
 */
export function addFeudPointsSql(args: {
  playerId: number
  reporter: NewsReporterId
  points: number
  at: Date
}): SQL {
  const at = args.at.toISOString()
  return sql`
    insert into news_press_feuds (player_id, reporter, points, last_event_at, updated_at)
    values (${args.playerId}, ${args.reporter},
      least(${FEUD_MAX_POINTS}::numeric, ${args.points}::numeric), ${at}::timestamptz, ${at}::timestamptz)
    on conflict (player_id, reporter) do update set
      points = least(${FEUD_MAX_POINTS}::numeric,
        news_press_feuds.points * power(0.5::numeric,
          greatest(0, extract(epoch from (${at}::timestamptz - news_press_feuds.last_event_at)))::numeric
            / (${FEUD_HALF_LIFE_DAYS}::numeric * 86400)) + ${args.points}::numeric),
      last_event_at = ${at}::timestamptz,
      updated_at = ${at}::timestamptz`
}

export async function addFeudPoints(args: {
  playerId: number
  reporter: NewsReporterId
  points: number
  at: Date
}): Promise<void> {
  if (!(args.points > 0)) return
  await db.execute(addFeudPointsSql(args))
}

/** One pair with its faded points and level now. */
export interface FeudRow {
  playerId: number
  name: string
  reporter: NewsReporterId
  points: number
  level: FeudLevel
  lastEventAt: Date
}

export function listFeudRowsSql(now: Date, playerIds: readonly number[] | null): SQL {
  const only =
    playerIds === null
      ? sql``
      : sql`and f.player_id in (${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
  return sql`
    select f.player_id, ${DISPLAY_NAME} as name, f.reporter, f.points, f.last_event_at
    from news_press_feuds f
    join players p on p.id = f.player_id
    left join player_profiles pp on pp.player_id = f.player_id
    where f.last_event_at > ${now.toISOString()}::timestamptz - make_interval(days => ${FEUD_READ_DAYS})
      ${only}
    order by f.player_id, f.reporter`
}

/**
 * Feuds above "none" right now (for these players, or all when `playerIds` is
 * null), strongest first. An empty `playerIds` is an empty answer.
 */
export async function listFeuds(args: {
  now: Date
  playerIds?: readonly number[] | null
}): Promise<FeudRow[]> {
  const ids = args.playerIds ?? null
  if (ids !== null && ids.length === 0) return []
  const rows = await db.execute<{
    player_id: string | number
    name: string
    reporter: NewsReporterId
    points: string | number
    last_event_at: Date | string
  }>(listFeudRowsSql(args.now, ids))
  return rows
    .map((r): FeudRow => {
      const lastEventAt = new Date(r.last_event_at)
      const points = decayedPoints(num(r.points), lastEventAt, args.now)
      return {
        playerId: num(r.player_id),
        name: r.name,
        reporter: r.reporter,
        points,
        level: feudLevelOf(points),
        lastEventAt,
      }
    })
    .filter((r) => r.level !== 'none')
    .sort((a, b) => b.points - a.points)
}

/**
 * True when `threadId` is a press thread: a scrum thread (stored, or the scrum
 * message the thread was started from) or an interview thread. A message in any
 * other thread of the guild is none of the press's business (feud points from a
 * non-answer message count only here).
 */
export function isPressThreadSql(threadId: string): SQL {
  return sql`
    select (
      exists (select 1 from news_scrums s where s.thread_id = ${threadId} or s.message_id = ${threadId})
      or exists (select 1 from news_interviews i
        where i.thread_id = ${threadId} or i.offer_message_id = ${threadId})
    ) as yes`
}

export async function isPressThread(threadId: string): Promise<boolean> {
  const rows = await db.execute<{ yes: boolean }>(isPressThreadSql(threadId))
  return rows[0]?.yes === true
}
