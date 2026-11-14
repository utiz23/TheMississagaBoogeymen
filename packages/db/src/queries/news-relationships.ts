import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  REL_HALF_LIFE_DAYS,
  REL_MAX_POINTS,
  decayedPoints,
  relLevelAt,
  type RelLevel,
} from '../news/relationships.js'
import type { NewsReporterId } from '../schema/index.js'

// Reporter relationship queries (T9, migration 0078; T5's feud queries, signed). `addRelationshipPointsSql`
// is pinned by `__tests__/news-relationships.test.ts`. The level is never stored: it is read from the
// faded points, the reporter's lean and range (`news/relationships.ts`).

const DISPLAY_NAME = sql.raw(`coalesce(nullif(btrim(pp.player_name), ''), p.gamertag)`)
const num = (v: string | number): number => Number(v)

/** Rows older than this have faded below every level and are not read. */
const REL_READ_DAYS = 90

/**
 * Adds the SIGNED `points` to the pair, in one statement. The stored total is faded to `at` first
 * (toward zero), the new total is capped at +-`REL_MAX_POINTS`, and `last_event_at` moves to `at`.
 * Table-qualified columns: the existing row is `news_press_relationships`.
 */
export function addRelationshipPointsSql(args: {
  playerId: number
  reporter: NewsReporterId
  points: number
  at: Date
}): SQL {
  const at = args.at.toISOString()
  return sql`
    insert into news_press_relationships (player_id, reporter, points, last_event_at, updated_at)
    values (${args.playerId}, ${args.reporter},
      greatest(-${REL_MAX_POINTS}::numeric, least(${REL_MAX_POINTS}::numeric, ${args.points}::numeric)),
      ${at}::timestamptz, ${at}::timestamptz)
    on conflict (player_id, reporter) do update set
      points = greatest(-${REL_MAX_POINTS}::numeric, least(${REL_MAX_POINTS}::numeric,
        news_press_relationships.points * power(0.5::numeric,
          greatest(0, extract(epoch from (${at}::timestamptz - news_press_relationships.last_event_at)))::numeric
            / (${REL_HALF_LIFE_DAYS}::numeric * 86400)) + ${args.points}::numeric)),
      last_event_at = ${at}::timestamptz,
      updated_at = ${at}::timestamptz`
}

/** Adds signed points (a step toward favour is positive, toward feud negative). Nothing for 0. */
export async function addRelationshipPoints(args: {
  playerId: number
  reporter: NewsReporterId
  points: number
  at: Date
}): Promise<void> {
  if (!Number.isFinite(args.points) || args.points === 0) return
  await db.execute(addRelationshipPointsSql(args))
}

/** One pair with its faded signed points and its level now (the reporter's lean and range applied). */
export interface RelationshipRow {
  playerId: number
  name: string
  reporter: NewsReporterId
  /** Faded, signed. */
  points: number
  level: RelLevel
  lastEventAt: Date
}

export function listRelationshipRowsSql(now: Date, playerIds: readonly number[] | null): SQL {
  const only =
    playerIds === null
      ? sql``
      : sql`and f.player_id in (${sql.join(
          playerIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
  return sql`
    select f.player_id, ${DISPLAY_NAME} as name, f.reporter, f.points, f.last_event_at
    from news_press_relationships f
    join players p on p.id = f.player_id
    left join player_profiles pp on pp.player_id = f.player_id
    where f.last_event_at > ${now.toISOString()}::timestamptz - make_interval(days => ${REL_READ_DAYS})
      ${only}
    order by f.player_id, f.reporter`
}

/**
 * Relationships off neutral right now (for these players, or all when `playerIds` is null), the
 * strongest (largest magnitude) first. An empty `playerIds` is an empty answer.
 */
export async function listRelationships(args: {
  now: Date
  playerIds?: readonly number[] | null
}): Promise<RelationshipRow[]> {
  const ids = args.playerIds ?? null
  if (ids !== null && ids.length === 0) return []
  const rows = await db.execute<{
    player_id: string | number
    name: string
    reporter: NewsReporterId
    points: string | number
    last_event_at: Date | string
  }>(listRelationshipRowsSql(args.now, ids))
  return rows
    .map((r): RelationshipRow => {
      const lastEventAt = new Date(r.last_event_at)
      return {
        playerId: num(r.player_id),
        name: r.name,
        reporter: r.reporter,
        points: decayedPoints(num(r.points), lastEventAt, args.now),
        level: relLevelAt({ points: num(r.points), lastEventAt }, r.reporter, args.now),
        lastEventAt,
      }
    })
    .filter((r) => r.level !== 'neutral')
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
}

/**
 * True when `threadId` is a press thread: a scrum thread (stored, or the scrum
 * message the thread was started from) or an interview thread. A message in any
 * other thread of the guild is none of the press's business (relationship points from a
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
