import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db } from '../client.js'
import {
  newsAiUsage,
  newsItems,
  newsJobs,
  newsSettings,
  newsStances,
  newsReporterSwitch,
  newsReporterTakes,
  playerProfiles,
  players,
  type NewNewsItem,
  type NewNewsStance,
  type NewNewsUsage,
  type NewsReporterTakeRow,
  type NewsItemKind,
  type NewsItemRow,
  type NewsJobKind,
  type NewsReporterId,
  type PressLevel,
  type PressLevelSetBy,
} from '../schema/index.js'
import { correctionItem } from '../news/correction.js'
import { NEWS_RULES_VERSION } from '../news/rules-version.js'
import type { FeatureKind } from '../news/features.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'
import type { UnlockEventRow } from './discord-unlock-posts.js'
import { updatePlayerProfile } from './profiles.js'

export type {
  NewsItemRow,
  NewNewsItem,
  NewNewsStance,
  NewNewsUsage,
  NewsJobKind,
  NewsMention,
} from '../schema/index.js'

/** A failed job or Discord delivery is retried until it has been attempted this many times. */
export const NEWS_MAX_ATTEMPTS = DISCORD_MAX_ATTEMPTS

const MAX = sql.raw(String(NEWS_MAX_ATTEMPTS))

/**
 * The "night" a game belongs to: its America/Edmonton date, shifted back 6 h
 * so a game that ends after midnight stays with the evening it started.
 * `alias` is the matches alias in the surrounding query.
 */
function nightKeySql(alias: string): SQL {
  return sql.raw(
    `((${alias}.played_at at time zone 'America/Edmonton') - interval '6 hours')::date`,
  )
}

// ── Jobs ────────────────────────────────────────────────────────────────────

/**
 * Games the news desk may cover: active title, ended after `since`, not a DNF,
 * the Discord result post final (posted, skipped, or failed for good — a failed
 * post under the cap may still be retried by the result poster), and either no
 * job or a failed one under the cap. `pending`, `done` and `skipped` jobs are
 * never returned. job_key holds the match id as text.
 */
export function listGameJobCandidatesSql(args: { since: Date; limit: number }): SQL {
  return sql`
    select m.id
    from matches m
    join game_titles g on g.id = m.game_title_id and g.is_active
    join discord_posts dp on dp.match_id = m.id
    left join news_jobs j on j.kind = 'game' and j.job_key = m.id::text
    where m.played_at > ${args.since.toISOString()}::timestamptz
      and m.result <> 'DNF'
      and (dp.status in ('posted', 'skipped') or (dp.status = 'failed' and dp.attempts >= ${MAX}))
      and (j.job_key is null or (j.status = 'failed' and j.attempts < ${MAX}))
    order by m.played_at, m.id
    limit ${args.limit}`
}

export async function listGameJobCandidates(args: {
  since: Date
  limit: number
}): Promise<number[]> {
  const rows = await db.execute<{ id: string | number }>(listGameJobCandidatesSql(args))
  return rows.map((r) => Number(r.id))
}

/**
 * A night whose last game ended this long ago is written up even when some of
 * its games never got a settled job (e.g. the result poster was down, or a job
 * is stuck), so one stuck game never blocks the article for good.
 */
export const NIGHT_SETTLE_CEILING_MS = 3 * 60 * 60 * 1000

/**
 * Night keys ('YYYY-MM-DD', active title) that are over: the last game ended
 * before `now - endedForMs` and after `since`; no night job yet (or a failed one
 * under the cap); and every counted (non-DNF) game of the night already has a
 * settled game job: done, skipped, pending (the news service runs one pass at a
 * time and the game pass runs first, so a pending job seen here is dead), or
 * failed for good (attempts at the cap). A night whose last game ended more than
 * NIGHT_SETTLE_CEILING_MS ago is over whatever its game jobs say.
 */
export function listEndedNightsSql(args: { now: Date; endedForMs: number; since: Date }): SQL {
  const cutoff = new Date(args.now.getTime() - args.endedForMs)
  const ceiling = new Date(args.now.getTime() - NIGHT_SETTLE_CEILING_MS)
  return sql`
    select to_char(n.night, 'YYYY-MM-DD') as night
    from (
      select ${nightKeySql('m')} as night, max(m.played_at) as last_end
      from matches m
      join game_titles g on g.id = m.game_title_id and g.is_active
      group by 1
      having max(m.played_at) < ${cutoff.toISOString()}::timestamptz
        and max(m.played_at) > ${args.since.toISOString()}::timestamptz
    ) n
    left join news_jobs j on j.kind = 'night' and j.job_key = to_char(n.night, 'YYYY-MM-DD')
    where (j.job_key is null or (j.status = 'failed' and j.attempts < ${MAX}))
      and (
        n.last_end < ${ceiling.toISOString()}::timestamptz
        or not exists (
          select 1
          from matches m2
          join game_titles g2 on g2.id = m2.game_title_id and g2.is_active
          where ${nightKeySql('m2')} = n.night
            and m2.result <> 'DNF'
            and not exists (
              select 1 from news_jobs gj
              where gj.kind = 'game' and gj.job_key = m2.id::text
                and (gj.status in ('done', 'skipped', 'pending') or (gj.status = 'failed' and gj.attempts >= ${MAX}))
            )
        )
      )
    order by n.night`
}

export async function listEndedNights(args: {
  now: Date
  endedForMs: number
  since: Date
}): Promise<string[]> {
  const rows = await db.execute<{ night: string }>(listEndedNightsSql(args))
  return rows.map((r) => String(r.night))
}

/** Counted (non-DNF, active-title) games whose night key is in `nights`. */
export function countNightGamesSql(nights: string[]): SQL {
  return sql`
    select count(*) as n
    from matches m
    join game_titles g on g.id = m.game_title_id and g.is_active
    where m.result <> 'DNF'
      and to_char(${nightKeySql('m')}, 'YYYY-MM-DD') in (${sql.join(
        nights.map((n) => sql`${n}`),
        sql`, `,
      )})`
}

export async function countNightGames(nights: string[]): Promise<number> {
  if (nights.length === 0) return 0
  const rows = await db.execute<{ n: string | number }>(countNightGamesSql(nights))
  return Number(rows[0]?.n ?? 0)
}

/**
 * Take a job: insert it pending with attempts 1, or flip a failed row under the
 * cap back to pending (attempts + 1) when it was written in the same mode (a
 * failed test job is never re-claimed live, and the other way round). Any other
 * existing row claims nothing.
 */
export function claimNewsJobSql(kind: NewsJobKind, key: string, isTest: boolean): SQL {
  return sql`
    insert into news_jobs (kind, job_key, status, attempts, is_test)
    values (${kind}, ${key}, 'pending', 1, ${isTest})
    on conflict (kind, job_key) do update
      set status = 'pending', attempts = news_jobs.attempts + 1, updated_at = now()
      where news_jobs.status = 'failed' and news_jobs.attempts < ${MAX}
        and news_jobs.is_test = ${isTest}
    returning id`
}

/** The job id when this caller now owns the job; null when it is taken or done. */
export async function claimNewsJob(
  kind: NewsJobKind,
  key: string,
  isTest: boolean,
): Promise<number | null> {
  const rows = await db.execute<{ id: string | number }>(claimNewsJobSql(kind, key, isTest))
  const row = rows[0]
  return row ? Number(row.id) : null
}

export async function markNewsJob(
  jobId: number,
  status: 'done' | 'failed' | 'skipped',
  error: string | null,
): Promise<void> {
  await db
    .update(newsJobs)
    .set({ status, lastError: error === null ? null : error.slice(0, 500), updatedAt: sql`now()` })
    .where(eq(newsJobs.id, jobId))
}

export async function hasNewsJob(kind: NewsJobKind, key: string): Promise<boolean> {
  const rows = await db
    .select({ id: newsJobs.id })
    .from(newsJobs)
    .where(and(eq(newsJobs.kind, kind), eq(newsJobs.jobKey, key)))
    .limit(1)
  return rows.length > 0
}

// ── Items: writing and delivery ─────────────────────────────────────────────

export async function insertNewsItem(item: NewNewsItem): Promise<number> {
  const rows = await db.insert(newsItems).values(item).returning({ id: newsItems.id })
  const row = rows[0]
  if (!row) throw new Error('insertNewsItem: no row returned')
  return row.id
}

// ── Stances on threads (Part C2.8, spec §12.17-3) ───────────────────────────

export async function insertStance(stance: NewNewsStance): Promise<number> {
  const rows = await db.insert(newsStances).values(stance).returning({ id: newsStances.id })
  const row = rows[0]
  if (!row) throw new Error('insertStance: no row returned')
  return row.id
}

/** A stance as the fact sheet carries it. */
export interface NewsStance {
  threadKey: string
  reporter: NewsReporterId
  stance: string
  night: string | null
}

/**
 * The stances on these threads, oldest first. A stance of a deleted or test
 * item is left out (the sheet is the public record); one without an item stays.
 */
export function stancesForThreadsSql(keys: readonly string[]): SQL {
  return sql`
    select s.thread_key, s.reporter, s.stance, to_char(s.night, 'YYYY-MM-DD') as night
    from news_stances s
    left join news_items i on i.id = s.item_id
    where s.thread_key in (${sql.join(
      keys.map((k) => sql`${k}`),
      sql`, `,
    )})
      and (s.item_id is null or (i.deleted_at is null and i.is_test = false))
    order by s.night asc nulls last, s.id asc`
}

export async function stancesForThreads(keys: readonly string[]): Promise<NewsStance[]> {
  if (keys.length === 0) return []
  const rows = await db.execute<{
    thread_key: string
    reporter: NewsReporterId
    stance: string
    night: string | null
  }>(stancesForThreadsSql(keys))
  return rows.map((r) => ({
    threadKey: r.thread_key,
    reporter: r.reporter,
    stance: r.stance,
    night: r.night,
  }))
}

// ── Reporter takes (Part C3a, spec §12.19): GM-only lore ────────────────────

/** The active takes on these players, oldest first. Internal: never served publicly. */
export function activeTakesForPlayersQuery(playerIds: readonly number[]) {
  return db
    .select()
    .from(newsReporterTakes)
    .where(
      and(eq(newsReporterTakes.active, true), inArray(newsReporterTakes.playerId, [...playerIds])),
    )
    .orderBy(asc(newsReporterTakes.id))
}

export async function activeTakesForPlayers(
  playerIds: readonly number[],
): Promise<NewsReporterTakeRow[]> {
  if (playerIds.length === 0) return []
  return activeTakesForPlayersQuery(playerIds)
}

/**
 * When each take was last voiced (spec §12.19: at most about once a week per
 * player): the newest not-deleted item since `since` whose `takes_used` holds
 * it. Test items only when `includeTest` (a dry run sees its own uses).
 */
export function takesUsedSinceSql(since: Date, includeTest: boolean): SQL {
  return sql`
    select (e.value)::bigint as take_id, max(n.created_at) as last_used
    from news_items n
    cross join lateral jsonb_array_elements(n.takes_used) as e(value)
    where n.deleted_at is null
      and (n.is_test = false or ${includeTest})
      and n.created_at >= ${since.toISOString()}::timestamptz
    group by 1
    order by 1`
}

export async function takesUsedSince(
  since: Date,
  includeTest: boolean,
): Promise<{ takeId: number; lastUsed: Date }[]> {
  const rows = await db.execute<{ take_id: string | number; last_used: string | Date }>(
    takesUsedSinceSql(since, includeTest),
  )
  return rows.map((r) => ({ takeId: Number(r.take_id), lastUsed: toDate(r.last_used) }))
}

// ── Per-reporter switch (Part C3b, spec §12.18-6) ───────────────────────────

/** The reporters switched off, in id order. A reporter without a row is on. */
export function disabledReportersQuery() {
  return db
    .select({ reporter: newsReporterSwitch.reporter })
    .from(newsReporterSwitch)
    .where(eq(newsReporterSwitch.enabled, false))
    .orderBy(asc(newsReporterSwitch.reporter))
}

export async function listDisabledReporters(): Promise<NewsReporterId[]> {
  return (await disabledReportersQuery()).map((r) => r.reporter)
}

export async function setReporterEnabled(
  reporter: NewsReporterId,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(newsReporterSwitch)
    .values({ reporter, enabled })
    .onConflictDoUpdate({
      target: newsReporterSwitch.reporter,
      set: { enabled, updatedAt: sql`now()` },
    })
}

// ── Admin: GM takes and the quality dashboard (Part C3b, admin only) ────────

/** A reporter take with its player's name, for /admin/news only. Never served publicly. */
export interface AdminTake {
  id: number
  reporter: NewsReporterId
  playerId: number
  /** The profile name when set, else the gamertag (as the fact sheets name people). */
  playerName: string
  take: string
  spread: NewsReporterTakeRow['spread']
  critics: NewsReporterId[]
  defender: NewsReporterId | null
  dataAngle: string | null
  active: boolean
  intensity: number
  updatedAt: Date
}

export function adminTakesSql(): SQL {
  return sql`
    select t.id, t.reporter, t.player_id,
      coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as player_name,
      t.take, t.spread, t.critics, t.defender, t.data_angle, t.active, t.intensity, t.updated_at
    from news_reporter_takes t
    join players p on p.id = t.player_id
    left join player_profiles pp on pp.player_id = t.player_id
    order by lower(coalesce(nullif(btrim(pp.player_name), ''), p.gamertag)), t.id`
}

type RawAdminTake = {
  id: string | number
  reporter: NewsReporterId
  player_id: string | number
  player_name: string
  take: string
  spread: NewsReporterTakeRow['spread']
  critics: NewsReporterId[] | string
  defender: NewsReporterId | null
  data_angle: string | null
  active: boolean
  intensity: string | number
  updated_at: string | Date
}

export function rowToAdminTake(r: RawAdminTake): AdminTake {
  return {
    id: Number(r.id),
    reporter: r.reporter,
    playerId: Number(r.player_id),
    playerName: r.player_name,
    take: r.take,
    spread: r.spread,
    critics: jsonArray<NewsReporterId>(r.critics),
    defender: r.defender,
    dataAngle: r.data_angle,
    active: r.active,
    intensity: Number(r.intensity),
    updatedAt: toDate(r.updated_at),
  }
}

export async function listAdminTakes(): Promise<AdminTake[]> {
  return (await db.execute<RawAdminTake>(adminTakesSql())).map(rowToAdminTake)
}

/** The fields the admin may change on a take (already validated by the web app). */
export interface AdminTakeEdit {
  take: string
  spread: NewsReporterTakeRow['spread']
  critics: NewsReporterId[]
  defender: NewsReporterId | null
  dataAngle: string | null
  intensity: number
  active: boolean
}

export function updateAdminTakeQuery(id: number, edit: AdminTakeEdit) {
  return db
    .update(newsReporterTakes)
    .set({
      take: edit.take,
      spread: edit.spread,
      critics: edit.critics,
      defender: edit.defender,
      dataAngle: edit.dataAngle,
      intensity: edit.intensity,
      active: edit.active,
      updatedAt: sql`now()`,
    })
    .where(eq(newsReporterTakes.id, id))
    .returning({ id: newsReporterTakes.id })
}

/** True when the take existed. */
export async function updateAdminTake(id: number, edit: AdminTakeEdit): Promise<boolean> {
  return (await updateAdminTakeQuery(id, edit)).length > 0
}

/** The reporter who holds take `id`, or null when there is no such take. */
export async function getTakeHolder(id: number): Promise<NewsReporterId | null> {
  const rows = await db
    .select({ reporter: newsReporterTakes.reporter })
    .from(newsReporterTakes)
    .where(eq(newsReporterTakes.id, id))
    .limit(1)
  return rows[0]?.reporter ?? null
}

/** What the quality dashboard reads about one real item. */
export interface NewsQualityItem {
  reporter: NewsReporterId
  kind: NewsItemKind
  result: string | null
  body: string
  mentions: { name: string }[]
  zeroCalled: string[]
  takesUsed: number[]
}

/** Real, not deleted items since `since`; `result` = the game's result for a game post. */
export function qualityItemsSql(since: Date): SQL {
  return sql`
    select n.reporter, n.kind, n.body, n.mentions, n.zero_called, n.takes_used,
      case when n.kind = 'post' and n.match_id is not null
          and jsonb_typeof(n.facts->'games') = 'array'
        then (
          select g.value->>'result'
          from jsonb_array_elements(n.facts->'games') as g
          where (g.value->>'matchId')::bigint = n.match_id
          limit 1
        ) end as result
    from news_items n
    where n.deleted_at is null and n.is_test = false and n.is_correction = false
      and n.created_at >= ${since.toISOString()}::timestamptz
    order by n.id`
}

type RawQualityItem = {
  reporter: NewsReporterId
  kind: NewsItemKind
  body: string
  mentions: { name: string }[] | string
  zero_called: string[] | string
  takes_used: number[] | string
  result: string | null
}

export function rowToQualityItem(r: RawQualityItem): NewsQualityItem {
  return {
    reporter: r.reporter,
    kind: r.kind,
    result: r.result,
    body: r.body,
    mentions: jsonArray<{ name: string }>(r.mentions),
    zeroCalled: jsonArray<string>(r.zero_called),
    takesUsed: jsonArray<number>(r.takes_used),
  }
}

export async function listQualityItems(since: Date): Promise<NewsQualityItem[]> {
  return (await db.execute<RawQualityItem>(qualityItemsSql(since))).map(rowToQualityItem)
}

// ── Seeding the GM takes (apps/discord/src/news/seed-takes.ts) ──────────────

export interface SeedPlayer {
  id: number
  gamertag: string
  name: string | null
}

/** Every human player (AI goalies left out) with the profile name, to resolve names in the takes file. */
export function seedPlayersSql(): SQL {
  return sql`
    select p.id, p.gamertag, nullif(btrim(pp.player_name), '') as name
    from players p
    left join player_profiles pp on pp.player_id = p.id
    where p.ai_goalie_side is null
    order by p.id`
}

export async function listSeedPlayers(): Promise<SeedPlayer[]> {
  const rows = await db.execute<{ id: string | number; gamertag: string; name: string | null }>(
    seedPlayersSql(),
  )
  return rows.map((r) => ({ id: Number(r.id), gamertag: r.gamertag, name: r.name }))
}

export interface ReporterTakeSeed {
  reporter: NewsReporterId
  playerId: number
  take: string
  spread: NewsReporterTakeRow['spread']
  critics: NewsReporterId[]
  defender: NewsReporterId | null
  dataAngle: string | null
  active: boolean
  /** null = keep the stored intensity (a new take starts at 0). */
  intensity: number | null
}

/**
 * One take per (reporter, player): updates it when it exists, else inserts it. More than
 * one existing row for the pair is an error. Running the seed twice changes nothing.
 */
export async function upsertReporterTake(seed: ReporterTakeSeed): Promise<'inserted' | 'updated'> {
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: newsReporterTakes.id })
      .from(newsReporterTakes)
      .where(
        and(
          eq(newsReporterTakes.reporter, seed.reporter),
          eq(newsReporterTakes.playerId, seed.playerId),
        ),
      )
    if (found.length > 1) {
      throw new Error(`more than one take for ${seed.reporter} on player ${String(seed.playerId)}`)
    }
    const fields = {
      take: seed.take,
      spread: seed.spread,
      critics: seed.critics,
      defender: seed.defender,
      dataAngle: seed.dataAngle,
      active: seed.active,
    }
    const existing = found[0]
    if (existing !== undefined) {
      await tx
        .update(newsReporterTakes)
        .set({
          ...fields,
          ...(seed.intensity === null ? {} : { intensity: seed.intensity }),
          updatedAt: sql`now()`,
        })
        .where(eq(newsReporterTakes.id, existing.id))
      return 'updated'
    }
    await tx.insert(newsReporterTakes).values({
      reporter: seed.reporter,
      playerId: seed.playerId,
      ...fields,
      intensity: seed.intensity ?? 0,
    })
    return 'inserted'
  })
}

// ── Backfill lookups (apps/discord/src/news/backfill.ts) ────────────────────

/**
 * A post with this match, reporter and body, test and deleted rows included
 * (a deleted backfill item must not come back on a second import).
 */
export function findNewsPostQuery(args: { matchId: number; reporter: string; body: string }) {
  return db
    .select({ id: newsItems.id })
    .from(newsItems)
    .where(
      and(
        eq(newsItems.kind, 'post'),
        eq(newsItems.matchId, args.matchId),
        sql`${newsItems.reporter} = ${args.reporter}`,
        eq(newsItems.body, args.body),
      ),
    )
    .orderBy(asc(newsItems.id))
    .limit(1)
}

export async function findNewsPostId(args: {
  matchId: number
  reporter: string
  body: string
}): Promise<number | null> {
  return (await findNewsPostQuery(args))[0]?.id ?? null
}

/** An item with this slug, test and deleted rows included. */
export function findNewsArticleQuery(slug: string) {
  return db.select({ id: newsItems.id }).from(newsItems).where(eq(newsItems.slug, slug)).limit(1)
}

export async function findNewsArticleId(slug: string): Promise<number | null> {
  return (await findNewsArticleQuery(slug))[0]?.id ?? null
}

export async function markNewsItemPosted(id: number, messageId: string | null): Promise<void> {
  await db
    .update(newsItems)
    .set({ discordStatus: 'posted', discordMessageId: messageId, lastError: null })
    .where(eq(newsItems.id, id))
}

/** A failed delivery counts one attempt (retried while attempts < the cap). */
export function markNewsItemFailedQuery(id: number, error: string) {
  return db
    .update(newsItems)
    .set({
      discordStatus: 'failed',
      discordAttempts: sql`${newsItems.discordAttempts} + 1`,
      lastError: error.slice(0, 500),
    })
    .where(eq(newsItems.id, id))
}

export async function markNewsItemFailed(id: number, error: string): Promise<void> {
  await markNewsItemFailedQuery(id, error)
}

export async function markNewsItemSkipped(id: number, reason: string): Promise<void> {
  await db
    .update(newsItems)
    .set({ discordStatus: 'skipped', lastError: reason.slice(0, 500) })
    .where(eq(newsItems.id, id))
}

/** Items whose Discord send failed and may still be retried. Real items only. */
export function undeliveredNewsItemsQuery(limit: number) {
  return db
    .select()
    .from(newsItems)
    .where(
      and(
        eq(newsItems.discordStatus, 'failed'),
        lt(newsItems.discordAttempts, NEWS_MAX_ATTEMPTS),
        eq(newsItems.isTest, false),
        isNull(newsItems.deletedAt),
      ),
    )
    .orderBy(asc(newsItems.id))
    .limit(limit)
}

export async function listUndeliveredNewsItems(limit: number): Promise<NewsItemRow[]> {
  return undeliveredNewsItemsQuery(limit)
}

/**
 * Items waiting for their send time (C3b.4): pending, `send_after` reached,
 * real, not deleted. Oldest send time first, so a game's posts go out in order.
 */
export function dueNewsItemsQuery(now: Date, limit: number) {
  return db
    .select()
    .from(newsItems)
    .where(
      and(
        eq(newsItems.discordStatus, 'pending'),
        isNotNull(newsItems.sendAfter),
        lte(newsItems.sendAfter, now),
        eq(newsItems.isTest, false),
        isNull(newsItems.deletedAt),
        // A game's later posts wait while its own earlier post is a failed send that may still
        // be retried: they never overtake it. Qualified names: a bare column would bind to r.
        sql`not exists (
          select 1 from news_items r
          where r.job_id = "news_items"."job_id"
            and r.id < "news_items"."id"
            and r.deleted_at is null
            and r.send_after is null
            and r.discord_status = 'failed'
            and r.discord_attempts < ${MAX}
        )`,
      ),
    )
    .orderBy(asc(newsItems.sendAfter), asc(newsItems.id))
    .limit(limit)
}

export async function listDueNewsItems(now: Date, limit: number): Promise<NewsItemRow[]> {
  return dueNewsItemsQuery(now, limit)
}

/**
 * Take a waiting item for sending: clears `send_after`, so no later pass picks
 * it again (a send whose outcome is unknown must never be repeated). True when
 * this call took it.
 */
export function claimDueNewsItemQuery(id: number) {
  return db
    .update(newsItems)
    .set({ sendAfter: null })
    .where(
      and(
        eq(newsItems.id, id),
        eq(newsItems.discordStatus, 'pending'),
        isNotNull(newsItems.sendAfter),
        isNull(newsItems.deletedAt),
      ),
    )
    .returning({ id: newsItems.id })
}

export async function claimDueNewsItem(id: number): Promise<boolean> {
  return (await claimDueNewsItemQuery(id)).length > 0
}

/** Deleted items whose Discord message still exists. */
export function discordDeletionsQuery(limit: number) {
  return db
    .select({ id: newsItems.id, messageId: newsItems.discordMessageId })
    .from(newsItems)
    .where(
      and(
        isNotNull(newsItems.deletedAt),
        isNotNull(newsItems.discordMessageId),
        isNull(newsItems.discordDeletedAt),
      ),
    )
    .orderBy(asc(newsItems.id))
    .limit(limit)
}

export async function listDiscordDeletions(
  limit: number,
): Promise<{ id: number; messageId: string }[]> {
  const rows = await discordDeletionsQuery(limit)
  return rows.flatMap((r) => (r.messageId === null ? [] : [{ id: r.id, messageId: r.messageId }]))
}

export async function markDiscordDeleted(id: number): Promise<void> {
  await db
    .update(newsItems)
    .set({ discordDeletedAt: sql`now()` })
    .where(eq(newsItems.id, id))
}

/**
 * Remove the items a dry run wrote. Jobs are kept on purpose (ruling R8): a
 * game or night covered in test mode must not be covered again after the live
 * switch. AI usage rows stay too: the money was spent. Returns the number of
 * items removed.
 */
export async function deleteTestNewsItems(): Promise<number> {
  const rows = await deleteTestNewsItemsQuery().returning({ id: newsItems.id })
  return rows.length
}

export function deleteTestNewsItemsQuery() {
  return db.delete(newsItems).where(eq(newsItems.isTest, true))
}

// ── Cost, reporter history, switch ──────────────────────────────────────────

export async function recordNewsUsage(row: NewNewsUsage): Promise<void> {
  await db.insert(newsAiUsage).values({ ...row, costUsd: row.costUsd.toFixed(6) })
}

/** Money spent in the UTC calendar month that contains `now`. */
export async function monthNewsSpendUsd(now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const rows = await db.execute<{ total: string | number | null }>(sql`
    select coalesce(sum(u.cost_usd), 0) as total
    from news_ai_usage u
    where u.created_at >= ${start.toISOString()}::timestamptz
      and u.created_at < ${end.toISOString()}::timestamptz`)
  return Number(rows[0]?.total ?? 0)
}

/** What an item was, for the rotation queues (rev 2, spec §12.4). */
export const NEWS_ACTIVITY_KINDS = ['recap', 'reaction', 'night', 'game', 'feature'] as const
export type NewsActivityKind = (typeof NEWS_ACTIVITY_KINDS)[number]

export interface NewsActivity {
  reporter: string
  night: string | null
  createdAt: Date
  kind: NewsActivityKind
  /** A reply's target reporter (C3a.8, recent reply pairs weigh less); null otherwise. */
  replyTo: string | null
}

/**
 * Items per reporter since `since` (real, not deleted) — for the frequency
 * limits and the rotation queues. The kind: an article with a week is a
 * `feature`, an article with a match a big game's `game` article (C3a.8),
 * any other article a `night` recap; a post is the game's `recap`
 * when no earlier real post of the same match exists (deleted ones count, so a
 * reaction never turns into a recap), else a `reaction`. Raw SQL with aliases:
 * the correlated subquery must not bind to the inner table.
 */
export function reporterActivitySql(since: Date): SQL {
  return sql`
    select n.reporter, n.night, n.created_at, t.reporter as reply_to,
      case
        when n.kind = 'article' and n.week_start is not null then 'feature'
        when n.kind = 'article' and n.match_id is not null then 'game'
        when n.kind = 'article' then 'night'
        when n.reply_to is null and not exists (
          select 1 from news_items p
          where p.kind = 'post'
            and p.is_test = false
            and p.match_id = n.match_id
            and p.id < n.id
        ) then 'recap'
        else 'reaction'
      end as kind
    from news_items n
    left join news_items t on t.id = n.reply_to
    where n.is_test = false
      and n.is_correction = false
      and n.deleted_at is null
      and n.created_at >= ${since.toISOString()}::timestamptz
    order by n.id asc`
}

type RawActivity = {
  reporter: string
  night: string | Date | null
  created_at: string | Date
  kind: string
  reply_to?: string | null
}

/** One activity row, or null for a kind this code does not know. */
export function rowToActivity(r: RawActivity): NewsActivity | null {
  if (!(NEWS_ACTIVITY_KINDS as readonly string[]).includes(r.kind)) return null
  return {
    reporter: r.reporter,
    night: toDay(r.night),
    createdAt: toDate(r.created_at),
    kind: r.kind as NewsActivityKind,
    replyTo: r.reply_to ?? null,
  }
}

export async function reporterActivity(args: { since: Date }): Promise<NewsActivity[]> {
  const rows = await db.execute<RawActivity>(reporterActivitySql(args.since))
  return rows.flatMap((r) => {
    const a = rowToActivity(r)
    return a === null ? [] : [a]
  })
}

/**
 * The real, not deleted weekly feature of the latest week (rev 2, B5; a big
 * game's spotlight or column has a feature kind but no week, C3a.8): its
 * kind, prediction and week. Latest by `week_start` (Part C1.9, Q1: a
 * backfilled older week inserted later must not win), then by id.
 */
export function lastFeatureSql(): SQL {
  return sql`
    select n.feature_kind, n.prediction, n.week_start
    from news_items n
    where n.is_test = false
      and n.deleted_at is null
      and n.feature_kind is not null
      and n.week_start is not null
    order by n.week_start desc nulls last, n.id desc
    limit 1`
}

export async function lastFeature(): Promise<{
  kind: FeatureKind
  prediction: string | null
  weekStart: string | null
} | null> {
  const rows = await db.execute<{
    feature_kind: FeatureKind
    prediction: string | null
    week_start: string | Date | null
  }>(lastFeatureSql())
  const r = rows[0]
  return r
    ? { kind: r.feature_kind, prediction: r.prediction, weekStart: toDay(r.week_start) }
    : null
}

/** A reporter's judged predictions (spec §12.15-4). */
export interface NewsScorecard {
  reporter: NewsReporterId
  hits: number
  misses: number
}

/**
 * Each reporter's judged predictions: a feature with a receipt verdict
 * credits the author of the feature it judged (the latest real feature of an
 * earlier week, as `lastFeature` picks it when the receipt is written), when
 * that one had a prediction. Real, not deleted items only. `gameTitleId`:
 * only receipts of weeks with a game of that title; `beforeWeek`: only
 * receipts of features before that Monday (a week sheet must not see later
 * receipts during a backfill).
 */
export function predictionScorecardsSql(args: { gameTitleId?: number; beforeWeek?: string }): SQL {
  const title =
    args.gameTitleId === undefined
      ? sql``
      : sql`and exists (
          select 1 from matches m
          where m.game_title_id = ${args.gameTitleId}
            and date_trunc('week', ${nightKeySql('m')})::date = f.week_start
        )`
  const before =
    args.beforeWeek === undefined ? sql`` : sql`and f.week_start < ${args.beforeWeek}::date`
  return sql`
    select p.reporter,
      count(*) filter (where f.receipt_verdict = 'hit') as hits,
      count(*) filter (where f.receipt_verdict = 'miss') as misses
    from news_items f
    join lateral (
      select n.reporter, n.prediction
      from news_items n
      where n.is_test = false
        and n.deleted_at is null
        and n.feature_kind is not null
        and n.week_start < f.week_start
      order by n.week_start desc, n.id desc
      limit 1
    ) p on true
    where f.is_test = false
      and f.deleted_at is null
      and f.feature_kind is not null
      and f.receipt_verdict is not null
      and p.prediction is not null
      ${title}
      ${before}
    group by p.reporter
    order by p.reporter`
}

export async function predictionScorecards(
  args: { gameTitleId?: number; beforeWeek?: string } = {},
): Promise<NewsScorecard[]> {
  const rows = await db.execute<{ reporter: NewsReporterId; hits: Numeric; misses: Numeric }>(
    predictionScorecardsSql(args),
  )
  return rows.map((r) => ({
    reporter: r.reporter,
    hits: Number(r.hits),
    misses: Number(r.misses),
  }))
}

/**
 * The `criticized` lists of a night's items, oldest first (rev 2, B4 pile-on
 * limit). Deleted items do not count; test items only when `includeTest`.
 */
export function nightCriticizedSql(night: string, includeTest: boolean): SQL {
  return sql`
    select n.criticized
    from news_items n
    where n.night = ${night}::date
      and n.deleted_at is null
      and (n.is_test = false or ${includeTest})
    order by n.id asc`
}

/** Every name criticised harshly in the night's items so far, each once, in first-seen order. */
export async function nightCriticized(night: string, includeTest: boolean): Promise<string[]> {
  const rows = await db.execute<{ criticized: string[] | string | null }>(
    nightCriticizedSql(night, includeTest),
  )
  const out: string[] = []
  for (const r of rows) {
    const list =
      typeof r.criticized === 'string' ? (JSON.parse(r.criticized) as unknown) : r.criticized
    if (!Array.isArray(list)) continue
    for (const name of list) {
      if (typeof name === 'string' && !out.includes(name)) out.push(name)
    }
  }
  return out
}

/**
 * The `zero_called` lists of a night's items and of the previous night that
 * has items (C3a, spec §12.12-5: one zero call-out per night, never the same
 * player two nights in a row). Deleted items do not count; test items only
 * when `includeTest`.
 */
export function nightZeroCalledSql(night: string, includeTest: boolean): SQL {
  return sql`
    select to_char(n.night, 'YYYY-MM-DD') as night, n.zero_called
    from news_items n
    where n.deleted_at is null
      and (n.is_test = false or ${includeTest})
      and (
        n.night = ${night}::date
        or n.night = (
          select max(p.night) from news_items p
          where p.night < ${night}::date
            and p.deleted_at is null
            and (p.is_test = false or ${includeTest})
        )
      )
    order by n.id asc`
}

/** Names called out for a zero tonight and on the previous night, each once, first-seen order. */
export function rowsToNightZeroCalled(
  night: string,
  rows: readonly { night: string; zero_called: string[] | string | null }[],
): { tonight: string[]; previous: string[] } {
  const out = { tonight: [] as string[], previous: [] as string[] }
  for (const r of rows) {
    const list =
      typeof r.zero_called === 'string' ? (JSON.parse(r.zero_called) as unknown) : r.zero_called
    if (!Array.isArray(list)) continue
    const into = r.night === night ? out.tonight : out.previous
    for (const name of list) if (typeof name === 'string' && !into.includes(name)) into.push(name)
  }
  return out
}

export async function nightZeroCalled(
  night: string,
  includeTest: boolean,
): Promise<{ tonight: string[]; previous: string[] }> {
  const rows = await db.execute<{ night: string; zero_called: string[] | string | null }>(
    nightZeroCalledSql(night, includeTest),
  )
  return rowsToNightZeroCalled(night, rows)
}

/** One post of a night for the night article's prompt (Part C1.8, spec §12.12-7). */
export interface NewsNightPost {
  reporter: string
  text: string
}

/**
 * The night's posts, oldest first (created_at, then id): not deleted; test
 * items only when `includeTest` (a dry run sees its own test posts, like
 * `nightCriticizedSql`).
 */
export function nightPostsForPromptSql(night: string, includeTest: boolean): SQL {
  return sql`
    select n.reporter, n.body
    from news_items n
    where n.kind = 'post'
      and n.is_correction = false
      and n.night = ${night}::date
      and n.deleted_at is null
      and (n.is_test = false or ${includeTest})
    order by n.created_at asc, n.id asc`
}

export function rowToNightPost(r: { reporter: string; body: string }): NewsNightPost {
  return { reporter: r.reporter, text: r.body }
}

/** The night's stored posts for the night article's prompt (the live cycle; the backfill reads accepted answers). */
export async function nightPostsForPrompt(
  night: string,
  isTest: boolean,
): Promise<NewsNightPost[]> {
  const rows = await db.execute<{ reporter: string; body: string }>(
    nightPostsForPromptSql(night, isTest),
  )
  return rows.map(rowToNightPost)
}

/**
 * A reporter's latest headlines and summaries, newest first (the "don't repeat
 * yourself" context). Real, not deleted, and never an item that names a player
 * who is now at press level 'out': their name must not reach the writer again.
 */
export function recentReporterSummariesSql(reporter: string, limit: number): SQL {
  return sql`
    select n.headline, n.summary, n.night
    from news_items n
    where n.is_test = false
      and n.deleted_at is null
      and n.reporter = ${reporter}
      and n.headline is not null
      and n.summary is not null
      and not exists (
        select 1
        from jsonb_array_elements(n.mentions) as e(elem)
        join player_profiles pp on pp.player_id = (e.elem->>'playerId')::int
        where pp.press_level = 'out'
      )
    order by n.id desc
    limit ${limit}`
}

export async function recentReporterSummaries(
  reporter: string,
  limit: number,
): Promise<{ headline: string; summary: string; night: string | null }[]> {
  const rows = await db.execute<{
    headline: string | null
    summary: string | null
    night: string | Date | null
  }>(recentReporterSummariesSql(reporter, limit))
  return rows.flatMap((r) =>
    r.headline === null || r.summary === null
      ? []
      : [{ headline: r.headline, summary: r.summary, night: toDay(r.night) }],
  )
}

/** One of a reporter's own recent pieces (C3a.3: "do not repeat their phrasing"). */
export interface NewsOwnPiece {
  kind: NewsItemKind
  /** A post's text, or an article's headline and summary. */
  text: string
  night: string | null
}

/**
 * A reporter's last pieces, posts and articles, newest first: not deleted,
 * real (test items too when `includeTest`), never an item that names a player
 * now at press level 'out'.
 */
export function recentReporterPiecesSql(
  reporter: string,
  limit: number,
  includeTest: boolean,
): SQL {
  return sql`
    select n.kind, n.body, n.headline, n.summary, n.night
    from news_items n
    where (n.is_test = false or ${includeTest})
      and n.is_correction = false
      and n.deleted_at is null
      and n.reporter = ${reporter}
      and not exists (
        select 1
        from jsonb_array_elements(n.mentions) as e(elem)
        join player_profiles pp on pp.player_id = (e.elem->>'playerId')::int
        where pp.press_level = 'out'
      )
    order by n.id desc
    limit ${limit}`
}

export function rowToOwnPiece(r: {
  kind: NewsItemKind
  body: string
  headline: string | null
  summary: string | null
  night: string | Date | null
}): NewsOwnPiece {
  const text =
    r.kind === 'post'
      ? r.body
      : [r.headline, r.summary].filter((x): x is string => x !== null && x !== '').join(' — ')
  return { kind: r.kind, text, night: toDay(r.night) }
}

export async function recentReporterPieces(
  reporter: string,
  limit: number,
  includeTest: boolean,
): Promise<NewsOwnPiece[]> {
  const rows = await db.execute<{
    kind: NewsItemKind
    body: string
    headline: string | null
    summary: string | null
    night: string | Date | null
  }>(recentReporterPiecesSql(reporter, limit, includeTest))
  return rows.map(rowToOwnPiece)
}

/**
 * Failed big-game article jobs under the cap (C3a.8), so they are written
 * again: job_key `<matchId>:<kind>`, updated since `since`, oldest first.
 */
export function listGameArticleRetriesSql(args: { since: Date; limit: number }): SQL {
  return sql`
    select j.job_key
    from news_jobs j
    where j.kind = 'game_article'
      and j.status = 'failed'
      and j.attempts < ${MAX}
      and j.updated_at >= ${args.since.toISOString()}::timestamptz
    order by j.id asc
    limit ${args.limit}`
}

export async function listGameArticleRetries(args: {
  since: Date
  limit: number
}): Promise<string[]> {
  const rows = await db.execute<{ job_key: string }>(listGameArticleRetriesSql(args))
  return rows.map((r) => r.job_key)
}

export async function getNewsEnabled(): Promise<boolean> {
  const rows = await db
    .select({ enabled: newsSettings.enabled })
    .from(newsSettings)
    .where(eq(newsSettings.id, 1))
  return rows[0]?.enabled ?? false
}

export async function setNewsEnabled(on: boolean): Promise<void> {
  await db
    .insert(newsSettings)
    .values({ id: 1, enabled: on })
    .onConflictDoUpdate({ target: newsSettings.id, set: { enabled: on, updatedAt: sql`now()` } })
}

/** How far back a switch-on marks games and nights as skipped. */
export const NEWS_BACKLOG_MS = 3 * 86_400_000

/** Game jobs 'skipped' for every game that ended after `since` and has no job yet. */
export function skipBacklogGamesSql(since: Date): SQL {
  return sql`
    insert into news_jobs (kind, job_key, status, last_error)
    select 'game', m.id::text, 'skipped', 'desk was off'
    from matches m
    where m.played_at > ${since.toISOString()}::timestamptz
    on conflict (kind, job_key) do nothing`
}

/** Night jobs 'skipped' for every night with a game that ended after `since`. */
export function skipBacklogNightsSql(since: Date): SQL {
  return sql`
    insert into news_jobs (kind, job_key, status, last_error)
    select distinct 'night', to_char(${nightKeySql('m')}, 'YYYY-MM-DD'), 'skipped', 'desk was off'
    from matches m
    where m.played_at > ${since.toISOString()}::timestamptz
    on conflict (kind, job_key) do nothing`
}

/**
 * Week jobs 'skipped' for the current and the previous Monday-to-Sunday week
 * (America/Edmonton calendar, as the week pass computes it).
 */
export function skipBacklogWeeksSql(now: Date): SQL {
  return sql`
    insert into news_jobs (kind, job_key, status, last_error)
    select 'week', to_char(w.start, 'YYYY-MM-DD'), 'skipped', 'desk was off'
    from (
      select date_trunc('week', ${now.toISOString()}::timestamptz at time zone 'America/Edmonton')::date as start
      union all
      select date_trunc('week', ${now.toISOString()}::timestamptz at time zone 'America/Edmonton')::date - 7
    ) w
    on conflict (kind, job_key) do nothing`
}

/**
 * Run when the desk is switched on after being off: mark everything played in
 * the last 3 days, and the current and previous week, as skipped, so the desk
 * never writes about the time it was off. Existing jobs are left alone.
 */
/**
 * Posts of a big game still waiting for their send time when the desk was switched
 * off: they stay on the site but never reach Discord (they would be late).
 * Corrections are exempt: they are about a deletion, not about a game.
 */
export function skipHeldPostsSql(): SQL {
  return sql`
    update news_items
    set discord_status = 'skipped', send_after = null, last_error = 'held while the desk was off'
    where discord_status = 'pending'
      and send_after is not null
      and is_correction = false`
}

export async function skipNewsBacklog(now: Date): Promise<void> {
  const since = new Date(now.getTime() - NEWS_BACKLOG_MS)
  await db.transaction(async (tx) => {
    await tx.execute(skipHeldPostsSql())
    await tx.execute(skipBacklogGamesSql(since))
    await tx.execute(skipBacklogNightsSql(since))
    await tx.execute(skipBacklogWeeksSql(now))
  })
}

// ── Public (web) ────────────────────────────────────────────────────────────

/** Every public query uses this: no test items, nothing deleted. */
export function publicNewsItemWhere(): SQL {
  const where = and(eq(newsItems.isTest, false), isNull(newsItems.deletedAt))
  if (!where) throw new Error('publicNewsItemWhere: empty condition')
  return where
}

/** Raw feed row (snake_case; postgres.js hands timestamps back as text). */
type RawNewsItem = {
  id: string | number
  job_id: string | number | null
  kind: NewsItemKind
  reporter: NewsItemRow['reporter']
  match_id: string | number | null
  night: string | Date | null
  week_start: string | Date | null
  reply_to: string | number | null
  slug: string | null
  headline: string | null
  dek: string | null
  body: string
  summary: string | null
  mentions: NewsItemRow['mentions'] | string
  facts: unknown
  /** Rev 2 columns; absent on a row shape from before migration 0071 gained them. */
  criticized?: string[] | string
  prediction?: string | null
  feature_kind?: NewsItemRow['featureKind']
  /** Part C2 column; absent on an older row shape. */
  receipt_verdict?: NewsItemRow['receiptVerdict']
  /** Part C3a columns; absent on an older row shape. */
  zero_called?: string[] | string
  takes_used?: number[] | string
  /** Part C3b column; absent on an older row shape. */
  rules_version?: string | null
  send_after?: string | Date | null
  is_correction?: boolean
  is_test: boolean
  discord_status: NewsItemRow['discordStatus']
  discord_attempts: number
  discord_message_id: string | null
  last_error: string | null
  deleted_at: string | Date | null
  discord_deleted_at: string | Date | null
  created_at: string | Date
}

const num = (v: string | number | null): number | null => (v === null ? null : Number(v))
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))
const toDateOrNull = (v: string | Date | null): Date | null => (v === null ? null : toDate(v))
const toDay = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : v

/** A jsonb array column as postgres.js may hand it back (parsed, or as text); absent = []. */
function jsonArray<T>(v: T[] | string | undefined): T[] {
  if (v === undefined) return []
  return typeof v === 'string' ? (JSON.parse(v) as T[]) : v
}

export function rawToNewsItem(r: RawNewsItem): NewsItemRow {
  return {
    id: Number(r.id),
    jobId: num(r.job_id),
    kind: r.kind,
    reporter: r.reporter,
    matchId: num(r.match_id),
    night: toDay(r.night),
    weekStart: toDay(r.week_start),
    replyTo: num(r.reply_to),
    slug: r.slug,
    headline: r.headline,
    dek: r.dek,
    body: r.body,
    summary: r.summary,
    mentions: typeof r.mentions === 'string' ? JSON.parse(r.mentions) : r.mentions,
    facts: typeof r.facts === 'string' ? JSON.parse(r.facts) : r.facts,
    criticized:
      r.criticized === undefined
        ? []
        : typeof r.criticized === 'string'
          ? (JSON.parse(r.criticized) as string[])
          : r.criticized,
    prediction: r.prediction ?? null,
    featureKind: r.feature_kind ?? null,
    receiptVerdict: r.receipt_verdict ?? null,
    zeroCalled: jsonArray<string>(r.zero_called),
    takesUsed: jsonArray<number>(r.takes_used),
    rulesVersion: r.rules_version ?? null,
    sendAfter: r.send_after == null ? null : toDate(r.send_after),
    isCorrection: r.is_correction ?? false,
    isTest: r.is_test,
    discordStatus: r.discord_status,
    discordAttempts: r.discord_attempts,
    discordMessageId: r.discord_message_id,
    lastError: r.last_error,
    deletedAt: toDateOrNull(r.deleted_at),
    discordDeletedAt: toDateOrNull(r.discord_deleted_at),
    createdAt: toDate(r.created_at),
  }
}

/**
 * One page of the public feed, newest first. `beforeId` is the keyset cursor:
 * the smallest id of the page already shown.
 */
export function newsFeedSql(args: {
  kind: NewsItemKind
  beforeId: number | null
  limit: number
}): SQL {
  const before = args.beforeId === null ? sql`` : sql`and n.id < ${args.beforeId}`
  return sql`
    select n.*
    from news_items n
    where n.kind = ${args.kind}
      and n.is_test = false
      and n.deleted_at is null
      ${before}
    order by n.id desc
    limit ${args.limit}`
}

export async function listNewsFeed(args: {
  kind: NewsItemKind
  beforeId: number | null
  limit: number
}): Promise<NewsItemRow[]> {
  const rows = await db.execute<RawNewsItem>(newsFeedSql(args))
  return rows.map(rawToNewsItem)
}

export async function getNewsArticle(slug: string): Promise<NewsItemRow | null> {
  const rows = await db
    .select()
    .from(newsItems)
    .where(and(publicNewsItemWhere(), eq(newsItems.kind, 'article'), eq(newsItems.slug, slug)))
    .limit(1)
  return rows[0] ?? null
}

export async function listReporterArticles(reporter: string): Promise<NewsItemRow[]> {
  return db
    .select()
    .from(newsItems)
    .where(
      and(
        publicNewsItemWhere(),
        eq(newsItems.kind, 'article'),
        sql`${newsItems.reporter} = ${reporter}`,
      ),
    )
    .orderBy(desc(newsItems.id))
}

// ── Admin ───────────────────────────────────────────────────────────────────

/** Newest items first, including test and deleted ones. */
export async function listAdminNewsItems(limit: number): Promise<NewsItemRow[]> {
  return db.select().from(newsItems).orderBy(desc(newsItems.id)).limit(limit)
}

/** One item, test and deleted ones included (admin only). */
export async function getAdminNewsItem(id: number): Promise<NewsItemRow | null> {
  const rows = await db.select().from(newsItems).where(eq(newsItems.id, id)).limit(1)
  return rows[0] ?? null
}

/** The item and its replies: a reply makes no sense once the post it answers is gone. */
export function softDeleteNewsItemQuery(id: number) {
  return db
    .update(newsItems)
    .set({ deletedAt: sql`now()` })
    .where(and(or(eq(newsItems.id, id), eq(newsItems.replyTo, id)), isNull(newsItems.deletedAt)))
}

/**
 * Hide an item, and every reply to it, from every public page now; their
 * Discord messages are deleted on the next pass.
 */
export async function softDeleteNewsItem(id: number): Promise<void> {
  await softDeleteNewsItemQuery(id)
}

/**
 * Delete an item and post the reporter's one-line correction (C3b.5), in one
 * transaction. The correction is a pending post with `send_after` = now, so the
 * news service sends it to Discord on its next pass. Returns the correction's id,
 * or null when none was made (the item is missing, already deleted, or a test item).
 */
export async function softDeleteNewsItemWithCorrection(
  id: number,
  now: Date = new Date(),
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const found = await tx.select().from(newsItems).where(eq(newsItems.id, id)).limit(1)
    const original = found[0]
    await tx
      .update(newsItems)
      .set({ deletedAt: sql`now()` })
      .where(and(or(eq(newsItems.id, id), eq(newsItems.replyTo, id)), isNull(newsItems.deletedAt)))
    if (original === undefined || original.deletedAt !== null) return null
    const correction = correctionItem(original, now, NEWS_RULES_VERSION)
    if (correction === null) return null
    const rows = await tx.insert(newsItems).values(correction).returning({ id: newsItems.id })
    return rows[0]?.id ?? null
  })
}

// ── Press levels ────────────────────────────────────────────────────────────

export interface MemberPressLevel {
  playerId: number
  gamertag: string
  name: string | null
  pressLevel: PressLevel
  setBy: PressLevelSetBy | null
}

/** Every human club member with their press level (default 'full'). AI goalies are left out. */
export async function listMemberPressLevels(): Promise<MemberPressLevel[]> {
  const rows = await db.execute<{
    id: string | number
    gamertag: string
    name: string | null
    press_level: PressLevel
    set_by: PressLevelSetBy | null
  }>(sql`
    select p.id, p.gamertag, nullif(btrim(pp.player_name), '') as name,
      coalesce(pp.press_level, 'full') as press_level, pp.press_level_set_by as set_by
    from players p
    left join player_profiles pp on pp.player_id = p.id
    where ${MEMBER_CONDITION} and p.ai_goalie_side is null
    order by lower(p.gamertag), p.id`)
  return rows.map((r) => ({
    playerId: Number(r.id),
    gamertag: r.gamertag,
    name: r.name,
    pressLevel: r.press_level,
    setBy: r.set_by,
  }))
}

export async function setPressLevel(
  playerId: number,
  level: PressLevel,
  setBy: PressLevelSetBy,
): Promise<void> {
  await updatePlayerProfile(playerId, { pressLevel: level, pressLevelSetBy: setBy })
}

/**
 * Name and press level for each given player (member or not). Name is the
 * profile's player_name, null when missing or blank; a player without a profile
 * row gets press level 'full'.
 */
export async function listNewsProfiles(
  playerIds: number[],
): Promise<Map<number, { name: string | null; pressLevel: PressLevel }>> {
  const out = new Map<number, { name: string | null; pressLevel: PressLevel }>()
  if (playerIds.length === 0) return out
  for (const id of playerIds) out.set(id, { name: null, pressLevel: 'full' })
  const rows = await db
    .select({
      playerId: playerProfiles.playerId,
      name: playerProfiles.playerName,
      pressLevel: playerProfiles.pressLevel,
    })
    .from(playerProfiles)
    .where(inArray(playerProfiles.playerId, playerIds))
  for (const r of rows) {
    const name = r.name?.trim() ?? ''
    out.set(r.playerId, { name: name === '' ? null : name, pressLevel: r.pressLevel })
  }
  return out
}

// ── Fact sheets ─────────────────────────────────────────────────────────────

const idList = (ids: readonly number[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )

/** Options for the fact-sheet loaders. */
export interface NewsTitleOptions {
  /** Also games of titles that are not active (the backfill of old nights). Default false. */
  includeInactive?: boolean
}

/**
 * Counted (non-DNF, active-title) games whose night key is in `nights`,
 * oldest first. Quarantined or archived titles are never active, so they never
 * appear. `includeInactive` drops the active-title condition (old nights);
 * quarantined matches are not in `matches` at all.
 */
export function listNewsNightMatchesSql(
  nights: readonly string[],
  opts: NewsTitleOptions = {},
): SQL {
  const title =
    opts.includeInactive === true
      ? sql``
      : sql`join game_titles g on g.id = m.game_title_id and g.is_active`
  return sql`
    select m.id, m.game_title_id
    from matches m
    ${title}
    where m.result <> 'DNF'
      and to_char(${nightKeySql('m')}, 'YYYY-MM-DD') in (${sql.join(
        nights.map((n) => sql`${n}`),
        sql`, `,
      )})
    order by m.played_at, m.id`
}

export async function listNewsNightMatches(
  nights: readonly string[],
  opts: NewsTitleOptions = {},
): Promise<{ id: number; gameTitleId: number }[]> {
  if (nights.length === 0) return []
  const rows = await db.execute<{ id: string | number; game_title_id: number }>(
    listNewsNightMatchesSql(nights, opts),
  )
  return rows.map((r) => ({ id: Number(r.id), gameTitleId: Number(r.game_title_id) }))
}

/** Which of these players are the worker's AI goalies. */
export async function listAiGoalieIds(playerIds: readonly number[]): Promise<Set<number>> {
  if (playerIds.length === 0) return new Set()
  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(and(inArray(players.id, [...playerIds]), isNotNull(players.aiGoalieSide)))
  return new Set(rows.map((r) => r.id))
}

/**
 * The title's counted results (WIN, LOSS, OTL) up to and including `lastMatchId`
 * (compared on played_at inside the database, so no timestamp precision is lost),
 * newest first. Record and streak are computed from this.
 */
export function listTitleResultsSql(gameTitleId: number, lastMatchId: number): SQL {
  return sql`
    select m.result
    from matches m
    where m.game_title_id = ${gameTitleId}
      and m.result <> 'DNF'
      and m.played_at <= (select l.played_at from matches l where l.id = ${lastMatchId})
    order by m.played_at desc, m.id desc`
}

export async function listTitleResultsUpTo(
  gameTitleId: number,
  lastMatchId: number,
): Promise<string[]> {
  const rows = await db.execute<{ result: string }>(listTitleResultsSql(gameTitleId, lastMatchId))
  return rows.map((r) => r.result)
}

export interface NewsNightSummary {
  night: string
  wins: number
  losses: number
  otl: number
  goalsFor: number
  goalsAgainst: number
}

/** The `limit` nights before `before` (a night key) that had a counted game, newest first. */
export function listRecentNightSummariesSql(args: {
  gameTitleId: number
  before: string
  limit: number
}): SQL {
  return sql`
    select to_char(x.night, 'YYYY-MM-DD') as night,
      count(*) filter (where x.result = 'WIN') as wins,
      count(*) filter (where x.result = 'LOSS') as losses,
      count(*) filter (where x.result = 'OTL') as otl,
      coalesce(sum(x.score_for), 0) as goals_for,
      coalesce(sum(x.score_against), 0) as goals_against
    from (
      select m.result, m.score_for, m.score_against, ${nightKeySql('m')} as night
      from matches m
      where m.game_title_id = ${args.gameTitleId} and m.result <> 'DNF'
    ) x
    where x.night < ${args.before}::date
    group by x.night
    order by x.night desc
    limit ${args.limit}`
}

export async function listRecentNightSummaries(args: {
  gameTitleId: number
  before: string
  limit: number
}): Promise<NewsNightSummary[]> {
  const rows = await db.execute<{
    night: string
    wins: string | number
    losses: string | number
    otl: string | number
    goals_for: string | number
    goals_against: string | number
  }>(listRecentNightSummariesSql(args))
  return rows.map((r) => ({
    night: r.night,
    wins: Number(r.wins),
    losses: Number(r.losses),
    otl: Number(r.otl),
    goalsFor: Number(r.goals_for),
    goalsAgainst: Number(r.goals_against),
  }))
}

/** One counted game of a title for the week sheet's `history`, as stored (shots before the OCR override). */
export interface NewsHistoryGame {
  id: number
  night: string
  result: 'WIN' | 'LOSS' | 'OTL'
  scoreFor: number
  scoreAgainst: number
  shotsFor: number
  shotsAgainst: number
  ppGoals: number | null
  ppOpportunities: number | null
  /** For the ended-early rule (C1 fix 4): time on attack and the club rows' goals (each at least 0). */
  timeOnAttack: number | null
  creditedGoals: number
}

/**
 * Counted (non-DNF) games of one title whose night key is in [from, to),
 * oldest first. No active-title condition: the caller passes the title of a
 * sheet it already allowed.
 */
export function listNewsHistoryGamesSql(args: {
  gameTitleId: number
  from: string
  to: string
}): SQL {
  return sql`
    select m.id, to_char(x.night, 'YYYY-MM-DD') as night, m.result, m.score_for, m.score_against,
      m.shots_for, m.shots_against, m.pp_goals, m.pp_opportunities,
      m.time_on_attack, bgm.credited_goals
    from matches m
    cross join lateral (select ${nightKeySql('m')} as night) x
    left join lateral (
      select coalesce(sum(greatest(p.goals, 0)), 0) as credited_goals
      from player_match_stats p
      where p.match_id = m.id
    ) bgm on true
    where m.game_title_id = ${args.gameTitleId}
      and m.result <> 'DNF'
      and x.night >= ${args.from}::date and x.night < ${args.to}::date
    order by m.played_at, m.id`
}

export async function listNewsHistoryGames(args: {
  gameTitleId: number
  from: string
  to: string
}): Promise<NewsHistoryGame[]> {
  const rows = await db.execute<{
    id: string | number
    night: string
    result: string
    score_for: number
    score_against: number
    shots_for: number
    shots_against: number
    pp_goals: number | null
    pp_opportunities: number | null
    time_on_attack: number | null
    credited_goals: string | number
  }>(listNewsHistoryGamesSql(args))
  const out: NewsHistoryGame[] = []
  for (const r of rows) {
    if (r.result !== 'WIN' && r.result !== 'LOSS' && r.result !== 'OTL') continue
    out.push({
      id: Number(r.id),
      night: r.night,
      result: r.result,
      scoreFor: Number(r.score_for),
      scoreAgainst: Number(r.score_against),
      shotsFor: Number(r.shots_for),
      shotsAgainst: Number(r.shots_against),
      ppGoals: r.pp_goals === null ? null : Number(r.pp_goals),
      ppOpportunities: r.pp_opportunities === null ? null : Number(r.pp_opportunities),
      timeOnAttack: r.time_on_attack === null ? null : Number(r.time_on_attack),
      creditedGoals: Number(r.credited_goals),
    })
  }
  return out
}

/**
 * One counted game for the team norms (Part C1.2, spec §12.10): the numbers
 * the match page shows. Shots after the reviewed-OCR override; pass sums of
 * both sides' player rows (the page's Pass % row); `creditedGoals` = the club
 * rows' goals (each row at least 0), for the ended-early rule.
 */
export interface NewsNormGame {
  id: number
  /** Night key (C2: the night's running notes, head-to-head). */
  night: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL'
  scoreAgainst: number
  /** As stored (EA spacing); callers collapse whitespace. */
  opponentName: string
  scoreFor: number
  creditedGoals: number
  hitsFor: number
  hitsAgainst: number
  shotsFor: number
  shotsAgainst: number
  timeOnAttack: number | null
  timeOnAttackAgainst: number | null
  ppGoals: number | null
  ppOpportunities: number | null
  ppGoalsAgainst: number | null
  ppOpportunitiesAgainst: number | null
  passAttempts: number
  passCompletions: number
  passAttemptsAgainst: number
  passCompletionsAgainst: number
}

/**
 * The title's counted (non-DNF) games strictly before `beforeMatchId` (the
 * sheet's first game; played_at, then id), oldest first. Shots: the sum of
 * reviewed OCR period rows (not the -1 total row) over EA's count, exactly
 * as `aggregateOcrShots` (a side with a period missing its value uses EA's). Raw SQL with aliases: the lateral subqueries must
 * not bind to the inner tables. No active-title condition (the caller passes
 * the title of a sheet it already allowed).
 */
export function listNewsNormGamesSql(args: { gameTitleId: number; beforeMatchId: number }): SQL {
  return sql`
    select m.id, to_char(${nightKeySql('m')}, 'YYYY-MM-DD') as night, m.game_mode, m.result,
      m.score_for, m.score_against, m.opponent_name, bgm.credited_goals, m.hits_for, m.hits_against,
      coalesce(ocr.shots_for, m.shots_for) as shots_for,
      coalesce(ocr.shots_against, m.shots_against) as shots_against,
      m.time_on_attack, m.time_on_attack_against,
      m.pp_goals, m.pp_opportunities, m.pp_goals_against, m.pp_opportunities_against,
      bgm.pass_attempts, bgm.pass_completions,
      opp.pass_attempts as opp_pass_attempts, opp.pass_completions as opp_pass_completions
    from matches m
    join matches l on l.id = ${args.beforeMatchId}
    left join lateral (
      select case when count(*) = count(s.shots_for) then sum(s.shots_for) end as shots_for,
        case when count(*) = count(s.shots_against) then sum(s.shots_against) end as shots_against
      from match_period_summaries s
      where s.match_id = m.id
        and s.source = 'ocr'
        and s.shots_review_status = 'reviewed'
        and s.period_number <> -1
    ) ocr on true
    left join lateral (
      select coalesce(sum(p.pass_attempts), 0) as pass_attempts,
        coalesce(sum(p.pass_completions), 0) as pass_completions,
        coalesce(sum(greatest(p.goals, 0)), 0) as credited_goals
      from player_match_stats p
      where p.match_id = m.id
    ) bgm on true
    left join lateral (
      select coalesce(sum(o.pass_attempts), 0) as pass_attempts,
        coalesce(sum(o.pass_completions), 0) as pass_completions
      from opponent_player_match_stats o
      where o.match_id = m.id
    ) opp on true
    where m.game_title_id = ${args.gameTitleId}
      and m.result <> 'DNF'
      and (m.played_at, m.id) < (l.played_at, l.id)
    order by m.played_at, m.id`
}

type Numeric = string | number
type RawNormGame = {
  id: Numeric
  night: string
  game_mode: string | null
  result: string
  score_against: Numeric
  opponent_name: string
  score_for: Numeric
  credited_goals: Numeric
  hits_for: Numeric
  hits_against: Numeric
  shots_for: Numeric
  shots_against: Numeric
  time_on_attack: Numeric | null
  time_on_attack_against: Numeric | null
  pp_goals: Numeric | null
  pp_opportunities: Numeric | null
  pp_goals_against: Numeric | null
  pp_opportunities_against: Numeric | null
  pass_attempts: Numeric
  pass_completions: Numeric
  opp_pass_attempts: Numeric
  opp_pass_completions: Numeric
}

export function rowToNormGame(r: RawNormGame): NewsNormGame {
  return {
    id: Number(r.id),
    night: r.night,
    gameMode: r.game_mode === '3s' || r.game_mode === '6s' ? r.game_mode : null,
    // The query keeps only counted games (not DNF).
    result: r.result === 'WIN' ? 'WIN' : r.result === 'OTL' ? 'OTL' : 'LOSS',
    scoreAgainst: Number(r.score_against),
    opponentName: r.opponent_name,
    scoreFor: Number(r.score_for),
    creditedGoals: Number(r.credited_goals),
    hitsFor: Number(r.hits_for),
    hitsAgainst: Number(r.hits_against),
    shotsFor: Number(r.shots_for),
    shotsAgainst: Number(r.shots_against),
    timeOnAttack: num(r.time_on_attack),
    timeOnAttackAgainst: num(r.time_on_attack_against),
    ppGoals: num(r.pp_goals),
    ppOpportunities: num(r.pp_opportunities),
    ppGoalsAgainst: num(r.pp_goals_against),
    ppOpportunitiesAgainst: num(r.pp_opportunities_against),
    passAttempts: Number(r.pass_attempts),
    passCompletions: Number(r.pass_completions),
    passAttemptsAgainst: Number(r.opp_pass_attempts),
    passCompletionsAgainst: Number(r.opp_pass_completions),
  }
}

export async function listNewsNormGames(args: {
  gameTitleId: number
  beforeMatchId: number
}): Promise<NewsNormGame[]> {
  const rows = await db.execute<RawNormGame>(listNewsNormGamesSql(args))
  return rows.map(rowToNormGame)
}

/**
 * One game of a named player (C2.3/C2.5), any title, any result (DNF rows
 * count for the title totals like player_game_title_stats; callers leave them
 * out of runs and norms). `position` and `isGoalie` as stored (EA); the
 * ended-early inputs as on the sheet.
 */
export interface NewsPlayerGame {
  playerId: number
  matchId: number
  gameTitleId: number
  night: string
  /** ISO timestamp. */
  playedAt: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL' | 'DNF'
  goals: number
  assists: number
  shots: number
  hits: number
  position: string | null
  isGoalie: boolean
  scoreFor: number
  creditedGoals: number
  timeOnAttack: number | null
  shotsFor: number
  shotsAgainst: number
}

/**
 * The given players' game rows in every title, up to and including
 * `lastMatchId` (played_at, then id), oldest first per player. The match
 * numbers (page shots: reviewed OCR over EA; the club rows' credited goals)
 * are computed once per match. Raw SQL with aliases (the lateral subqueries
 * must not bind to the inner tables).
 */
export function listNewsPlayerGamesSql(args: {
  playerIds: readonly number[]
  lastMatchId: number
}): SQL {
  return sql`
    with g as (
      select distinct pms.match_id from player_match_stats pms
      where pms.player_id in (${idList(args.playerIds)})
    ),
    mg as (
      select m.id, m.game_title_id, to_char(${nightKeySql('m')}, 'YYYY-MM-DD') as night,
        m.played_at, m.game_mode, m.result, m.score_for, m.time_on_attack,
        coalesce(ocr.shots_for, m.shots_for) as shots_for,
        coalesce(ocr.shots_against, m.shots_against) as shots_against,
        bgm.credited_goals
      from g
      join matches m on m.id = g.match_id
      join matches l on l.id = ${args.lastMatchId}
      left join lateral (
        select case when count(*) = count(s.shots_for) then sum(s.shots_for) end as shots_for,
          case when count(*) = count(s.shots_against) then sum(s.shots_against) end as shots_against
        from match_period_summaries s
        where s.match_id = m.id
          and s.source = 'ocr'
          and s.shots_review_status = 'reviewed'
          and s.period_number <> -1
      ) ocr on true
      left join lateral (
        select coalesce(sum(greatest(p.goals, 0)), 0) as credited_goals
        from player_match_stats p
        where p.match_id = m.id
      ) bgm on true
      where (m.played_at, m.id) <= (l.played_at, l.id)
    )
    select pms.player_id, mg.id as match_id, mg.game_title_id, mg.night, mg.played_at,
      mg.game_mode, mg.result, pms.goals, pms.assists, pms.shots, pms.hits, pms.position,
      pms.is_goalie, mg.score_for, mg.credited_goals, mg.time_on_attack, mg.shots_for,
      mg.shots_against
    from player_match_stats pms
    join mg on mg.id = pms.match_id
    where pms.player_id in (${idList(args.playerIds)})
    order by pms.player_id, mg.played_at, mg.id`
}

type RawPlayerGame = {
  player_id: Numeric
  match_id: Numeric
  game_title_id: Numeric
  night: string
  played_at: string | Date
  game_mode: string | null
  result: string
  goals: Numeric
  assists: Numeric
  shots: Numeric
  hits: Numeric
  position: string | null
  is_goalie: boolean
  score_for: Numeric
  credited_goals: Numeric
  time_on_attack: Numeric | null
  shots_for: Numeric
  shots_against: Numeric
}

export function rowToPlayerGame(r: RawPlayerGame): NewsPlayerGame {
  const result = r.result === 'WIN' || r.result === 'LOSS' || r.result === 'OTL' ? r.result : 'DNF'
  return {
    playerId: Number(r.player_id),
    matchId: Number(r.match_id),
    gameTitleId: Number(r.game_title_id),
    night: r.night,
    playedAt: toDate(r.played_at).toISOString(),
    gameMode: r.game_mode === '3s' || r.game_mode === '6s' ? r.game_mode : null,
    result,
    goals: Number(r.goals),
    assists: Number(r.assists),
    shots: Number(r.shots),
    hits: Number(r.hits),
    position: r.position,
    isGoalie: r.is_goalie,
    scoreFor: Number(r.score_for),
    creditedGoals: Number(r.credited_goals),
    timeOnAttack: num(r.time_on_attack),
    shotsFor: Number(r.shots_for),
    shotsAgainst: Number(r.shots_against),
  }
}

export async function listNewsPlayerGames(args: {
  playerIds: readonly number[]
  lastMatchId: number
}): Promise<NewsPlayerGame[]> {
  if (args.playerIds.length === 0) return []
  const rows = await db.execute<RawPlayerGame>(listNewsPlayerGamesSql(args))
  return rows.map(rowToPlayerGame)
}

/**
 * Which of these players have a season row (archive or EA) in another title
 * that came before `gameTitleId` (or whose order is unknown): a first game
 * logged for the club is then not a club debut (C2.5).
 */
export function listNewsPlayersWithOtherSeasonsSql(args: {
  playerIds: readonly number[]
  gameTitleId: number
}): SQL {
  const earlier = (table: string) => sql`exists (
      select 1 from ${sql.raw(table)} x
      join game_titles t on t.id = x.game_title_id
      join game_titles cur on cur.id = ${args.gameTitleId}
      where x.player_id = p.id
        and x.game_title_id <> ${args.gameTitleId}
        and (t.release_order is null or cur.release_order is null or t.release_order < cur.release_order)
    )`
  return sql`
    select p.id from players p
    where p.id in (${idList(args.playerIds)})
      and (${earlier('historical_player_season_stats')}
        or ${earlier('historical_club_member_season_stats')}
        or ${earlier('ea_member_season_stats')})`
}

export async function listNewsPlayersWithOtherSeasons(args: {
  playerIds: readonly number[]
  gameTitleId: number
}): Promise<Set<number>> {
  if (args.playerIds.length === 0) return new Set()
  const rows = await db.execute<{ id: Numeric }>(listNewsPlayersWithOtherSeasonsSql(args))
  return new Set(rows.map((r) => Number(r.id)))
}

/** A player's totals in the sheet's title before its first game (C2.4 records). */
export interface NewsTitleSeasonTotal {
  playerId: number
  gamertag: string
  goals: number
  assists: number
  games: number
}

/**
 * Every human player's title totals from the games strictly before
 * `beforeMatchId` (played_at, then id): every row, DNF too, like the title
 * totals and player_game_title_stats. AI goalies left out (they cannot hold a
 * club record). The current title's part of the club records (C2.4); the
 * stored season tables would include later games during a backfill.
 */
export function listNewsTitleSeasonTotalsSql(args: {
  gameTitleId: number
  beforeMatchId: number
}): SQL {
  return sql`
    select pms.player_id, p.gamertag,
      coalesce(sum(pms.goals), 0) as goals,
      coalesce(sum(pms.assists), 0) as assists,
      count(*) as games
    from player_match_stats pms
    join players p on p.id = pms.player_id
    join matches m on m.id = pms.match_id
    join matches l on l.id = ${args.beforeMatchId}
    where m.game_title_id = ${args.gameTitleId}
      and p.ai_goalie_side is null
      and (m.played_at, m.id) < (l.played_at, l.id)
    group by pms.player_id, p.gamertag`
}

export async function listNewsTitleSeasonTotals(args: {
  gameTitleId: number
  beforeMatchId: number
}): Promise<NewsTitleSeasonTotal[]> {
  const rows = await db.execute<{
    player_id: Numeric
    gamertag: string
    goals: Numeric
    assists: Numeric
    games: Numeric
  }>(listNewsTitleSeasonTotalsSql(args))
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    gamertag: r.gamertag,
    goals: Number(r.goals),
    assists: Number(r.assists),
    games: Number(r.games),
  }))
}

/** One player's goals/assists/points in one title, Boogeymen games only (C2.4 records). */
export interface NewsClubRecordLine {
  playerId: number
  gameTitleId: number
  gameTitleName: string
  /** Chronology key (22 for NHL 22 …); null sorts last. */
  releaseOrder: number | null
  goals: number
  assists: number
  points: number
}

/**
 * The club-record season lines (operator decision 2026-10-25: "our games
 * only"): a title with stored games counts those games (every row, like
 * `listNewsTitleSeasonTotalsSql`); a title without stored games counts the
 * reviewed club-member archive the Stats page shows (skater rows, modes
 * summed). Never the player-card totals of other clubs or EA's member totals.
 * AI goalies left out (they cannot hold a club record).
 */
export function listNewsClubRecordLinesSql(): SQL {
  return sql`
    with stored as (
      select pms.player_id, m.game_title_id,
        coalesce(sum(pms.goals), 0) as goals,
        coalesce(sum(pms.assists), 0) as assists,
        coalesce(sum(pms.goals), 0) + coalesce(sum(pms.assists), 0) as points
      from player_match_stats pms
      join players p on p.id = pms.player_id
      join matches m on m.id = pms.match_id
      where p.ai_goalie_side is null
      group by pms.player_id, m.game_title_id
    ),
    archive as (
      select h.player_id, h.game_title_id,
        coalesce(sum(h.goals), 0) as goals,
        coalesce(sum(h.assists), 0) as assists,
        coalesce(sum(coalesce(h.points, coalesce(h.goals, 0) + coalesce(h.assists, 0))), 0) as points
      from historical_club_member_season_stats h
      join players p on p.id = h.player_id
      where h.review_status = 'reviewed'
        and h.role_group = 'skater'
        and p.ai_goalie_side is null
        and not exists (select 1 from matches sm where sm.game_title_id = h.game_title_id)
      group by h.player_id, h.game_title_id
    )
    select x.player_id, x.game_title_id, gt.name as game_title_name, gt.release_order,
      x.goals, x.assists, x.points
    from (select * from stored union all select * from archive) x
    join game_titles gt on gt.id = x.game_title_id`
}

export async function listNewsClubRecordLines(): Promise<NewsClubRecordLine[]> {
  const rows = await db.execute<{
    player_id: Numeric
    game_title_id: Numeric
    game_title_name: string
    release_order: Numeric | null
    goals: Numeric
    assists: Numeric
    points: Numeric
  }>(listNewsClubRecordLinesSql())
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    gameTitleId: Number(r.game_title_id),
    gameTitleName: r.game_title_name,
    releaseOrder: r.release_order === null ? null : Number(r.release_order),
    goals: Number(r.goals),
    assists: Number(r.assists),
    points: Number(r.points),
  }))
}

/**
 * Counted card events (same rule as the unlock poster) of the given players in
 * a title, from the first game's end to `afterMinutes` after the last game's
 * end. Both bounds come from the matches table so no precision is lost.
 */
export function listNewsCardEventsSql(args: {
  gameTitleId: number
  playerIds: readonly number[]
  firstMatchId: number
  lastMatchId: number
  afterMinutes: number
}): SQL {
  return sql`
    select ev.id, ev.player_id, ev.game_title_id, p.gamertag, p.ai_goalie_side, ev.kind,
      ev.family_id, ev.from_value, ev.to_value, cp.mythic_theme
    from player_card_events ev
    join players p on p.id = ev.player_id
    left join player_card_progress cp on cp.player_id = ev.player_id and cp.game_title_id = ev.game_title_id
    where ev.game_title_id = ${args.gameTitleId}
      and ev.player_id in (${idList(args.playerIds)})
      and p.ai_goalie_side is null
      and ev.occurred_at >= (select f.played_at from matches f where f.id = ${args.firstMatchId})
      and ev.occurred_at <= (select l.played_at from matches l where l.id = ${args.lastMatchId})
        + make_interval(mins => ${sql.raw(String(Math.trunc(args.afterMinutes)))})
      and ((ev.kind = 'badge_level_up' and ev.to_value > ev.from_value)
           or ev.kind in ('level_up', 'tier_up', 'mythic_awarded'))
    order by ev.occurred_at, ev.id`
}

export async function listNewsCardEvents(args: {
  gameTitleId: number
  playerIds: readonly number[]
  firstMatchId: number
  lastMatchId: number
  afterMinutes: number
}): Promise<UnlockEventRow[]> {
  if (args.playerIds.length === 0) return []
  const rows = await db.execute<{
    id: string | number
    player_id: number
    game_title_id: number
    gamertag: string
    ai_goalie_side: string | null
    kind: UnlockEventRow['kind']
    family_id: UnlockEventRow['familyId']
    from_value: number
    to_value: number
    mythic_theme: UnlockEventRow['mythicTheme']
  }>(listNewsCardEventsSql(args))
  return rows.map((r) => ({
    id: Number(r.id),
    playerId: Number(r.player_id),
    gameTitleId: Number(r.game_title_id),
    gamertag: r.gamertag,
    aiGoalie: r.ai_goalie_side !== null,
    kind: r.kind,
    familyId: r.family_id,
    fromValue: Number(r.from_value),
    toValue: Number(r.to_value),
    mythicTheme: r.mythic_theme,
  }))
}

export interface NewsPlayerTotals {
  goals: number
  assists: number
  points: number
  games: number
}

/**
 * Title totals (DNF games count, like player_game_title_stats) for the given players: `before` = games
 * ended before the first game of the sheet, `after` = through the last game.
 * Bounds come from the matches table so no precision is lost.
 */
export function listPlayerTitleTotalsSql(args: {
  gameTitleId: number
  playerIds: readonly number[]
  firstMatchId: number
  lastMatchId: number
}): SQL {
  const first = sql`(select f.played_at from matches f where f.id = ${args.firstMatchId})`
  const last = sql`(select l.played_at from matches l where l.id = ${args.lastMatchId})`
  return sql`
    select pms.player_id,
      coalesce(sum(pms.goals) filter (where m.played_at < ${first}), 0) as goals_before,
      coalesce(sum(pms.assists) filter (where m.played_at < ${first}), 0) as assists_before,
      count(*) filter (where m.played_at < ${first}) as games_before,
      coalesce(sum(pms.goals), 0) as goals_after,
      coalesce(sum(pms.assists), 0) as assists_after,
      count(*) as games_after
    from player_match_stats pms
    join matches m on m.id = pms.match_id
    where m.game_title_id = ${args.gameTitleId}
      and pms.player_id in (${idList(args.playerIds)})
      and m.played_at <= ${last}
    group by pms.player_id`
}

export async function listPlayerTitleTotals(args: {
  gameTitleId: number
  playerIds: readonly number[]
  firstMatchId: number
  lastMatchId: number
}): Promise<{ before: Map<number, NewsPlayerTotals>; after: Map<number, NewsPlayerTotals> }> {
  const before = new Map<number, NewsPlayerTotals>()
  const after = new Map<number, NewsPlayerTotals>()
  if (args.playerIds.length === 0) return { before, after }
  const rows = await db.execute<{
    player_id: number
    goals_before: string | number
    assists_before: string | number
    games_before: string | number
    goals_after: string | number
    assists_after: string | number
    games_after: string | number
  }>(listPlayerTitleTotalsSql(args))
  for (const r of rows) {
    const id = Number(r.player_id)
    const gb = Number(r.goals_before)
    const ab = Number(r.assists_before)
    const ga = Number(r.goals_after)
    const aa = Number(r.assists_after)
    before.set(id, { goals: gb, assists: ab, points: gb + ab, games: Number(r.games_before) })
    after.set(id, { goals: ga, assists: aa, points: ga + aa, games: Number(r.games_after) })
  }
  return { before, after }
}
