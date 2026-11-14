import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import type { LiveEventSource, LiveEventType } from '../schema/index.js'

// Live events (E1, migration 0079). The web endpoint stores events; the worker reads the
// fast-poll triggers, reads the latest club game, and deletes old rows. The SQL shapes are
// pinned by `__tests__/live-events.test.ts` (no database). Events never write match data.

/** Rows older than this are deleted by the worker. */
export const LIVE_EVENTS_RETENTION_DAYS = 30

export interface NewLiveEvent {
  id: string
  type: LiveEventType
  source: LiveEventSource
  at: Date
  payload: Record<string, unknown>
}

/** Stores one event; a second event with the same id changes nothing (`returning` is then empty). */
export function insertLiveEventSql(event: NewLiveEvent): SQL {
  return sql`
    insert into live_events (id, type, source, at, payload)
    values (${event.id}, ${event.type}, ${event.source}, ${event.at.toISOString()}::timestamptz,
      ${JSON.stringify(event.payload)}::jsonb)
    on conflict (id) do nothing
    returning id`
}

/** Stores one event. `inserted: false` means the id was already stored (a resend). */
export async function insertLiveEvent(event: NewLiveEvent): Promise<{ inserted: boolean }> {
  const rows = await db.execute<{ id: string }>(insertLiveEventSql(event))
  return { inserted: rows.length > 0 }
}

/** Where the worker last read: the (received_at, id) of the last event it saw. */
export interface LiveEventCursor {
  receivedAt: Date
  id: string
}

/** A stored `period_end` or `game_end` event (the candidates for a fast EA poll). */
export interface LiveEventTriggerRow {
  id: string
  type: 'period_end' | 'game_end'
  /** `payload.period` when it is a number, else null. */
  period: number | null
  at: Date
  receivedAt: Date
}

/** `period_end` and `game_end` events stored after the cursor, oldest first. */
export function listLiveEventTriggersSql(cursor: LiveEventCursor, limit: number): SQL {
  return sql`
    select e.id, e.type,
      case when jsonb_typeof(e.payload->'period') = 'number' then (e.payload->>'period')::numeric end as period,
      e.at, e.received_at
    from live_events e
    where (e.received_at, e.id) > (${cursor.receivedAt.toISOString()}::timestamptz, ${cursor.id})
      and e.type in ('period_end', 'game_end')
    order by e.received_at, e.id
    limit ${limit}`
}

export async function listLiveEventTriggers(
  cursor: LiveEventCursor,
  limit = 50,
): Promise<LiveEventTriggerRow[]> {
  const rows = await db.execute<{
    id: string
    type: 'period_end' | 'game_end'
    period: string | number | null
    at: Date | string
    received_at: Date | string
  }>(listLiveEventTriggersSql(cursor, limit))
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    period: r.period === null ? null : Number(r.period),
    at: new Date(r.at),
    receivedAt: new Date(r.received_at),
  }))
}

/** The newest club game (surrogate `matches.id`) of the active titles; null when there is none. */
export function latestActiveClubMatchIdSql(): SQL {
  return sql`
    select max(m.id) as id
    from matches m
    join game_titles g on g.id = m.game_title_id
    where g.is_active = true`
}

export async function latestActiveClubMatchId(): Promise<number | null> {
  const rows = await db.execute<{ id: string | number | null }>(latestActiveClubMatchIdSql())
  const id = rows[0]?.id
  return id === null || id === undefined ? null : Number(id)
}

/** True when an active title has a club game that ended (`played_at`) at or after `since`. */
export function activeClubGameEndedSinceSql(since: Date): SQL {
  return sql`
    select exists (
      select 1 from matches m
      join game_titles g on g.id = m.game_title_id
      where g.is_active = true and m.played_at >= ${since.toISOString()}::timestamptz
    ) as yes`
}

export async function activeClubGameEndedSince(since: Date): Promise<boolean> {
  const rows = await db.execute<{ yes: boolean }>(activeClubGameEndedSinceSql(since))
  return rows[0]?.yes === true
}

/** Deletes events stored before `cutoff`; answers how many. */
export function deleteLiveEventsBeforeSql(cutoff: Date): SQL {
  return sql`
    with gone as (
      delete from live_events where received_at < ${cutoff.toISOString()}::timestamptz returning 1
    )
    select count(*)::int as n from gone`
}

export async function deleteLiveEventsBefore(cutoff: Date): Promise<number> {
  const rows = await db.execute<{ n: number }>(deleteLiveEventsBeforeSql(cutoff))
  return Number(rows[0]?.n ?? 0)
}
