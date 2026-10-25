import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  newsAiUsage,
  newsItems,
  newsJobs,
  newsSettings,
  playerProfiles,
  players,
  type NewNewsItem,
  type NewNewsUsage,
  type NewsItemKind,
  type NewsItemRow,
  type NewsJobKind,
  type PressLevel,
  type PressLevelSetBy,
} from '../schema/index.js'
import type { FeatureKind } from '../news/features.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'
import type { UnlockEventRow } from './discord-unlock-posts.js'
import { updatePlayerProfile } from './profiles.js'

export type {
  NewsItemRow,
  NewNewsItem,
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
export const NEWS_ACTIVITY_KINDS = ['recap', 'reaction', 'night', 'feature'] as const
export type NewsActivityKind = (typeof NEWS_ACTIVITY_KINDS)[number]

export interface NewsActivity {
  reporter: string
  night: string | null
  createdAt: Date
  kind: NewsActivityKind
}

/**
 * Items per reporter since `since` (real, not deleted) — for the frequency
 * limits and the rotation queues. The kind: an article with a week is a
 * `feature`, any other article a `night` recap; a post is the game's `recap`
 * when no earlier real post of the same match exists (deleted ones count, so a
 * reaction never turns into a recap), else a `reaction`. Raw SQL with aliases:
 * the correlated subquery must not bind to the inner table.
 */
export function reporterActivitySql(since: Date): SQL {
  return sql`
    select n.reporter, n.night, n.created_at,
      case
        when n.kind = 'article' and n.week_start is not null then 'feature'
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
    where n.is_test = false
      and n.deleted_at is null
      and n.created_at >= ${since.toISOString()}::timestamptz
    order by n.id asc`
}

type RawActivity = {
  reporter: string
  night: string | Date | null
  created_at: string | Date
  kind: string
}

/** One activity row, or null for a kind this code does not know. */
export function rowToActivity(r: RawActivity): NewsActivity | null {
  if (!(NEWS_ACTIVITY_KINDS as readonly string[]).includes(r.kind)) return null
  return {
    reporter: r.reporter,
    night: toDay(r.night),
    createdAt: toDate(r.created_at),
    kind: r.kind as NewsActivityKind,
  }
}

export async function reporterActivity(args: { since: Date }): Promise<NewsActivity[]> {
  const rows = await db.execute<RawActivity>(reporterActivitySql(args.since))
  return rows.flatMap((r) => {
    const a = rowToActivity(r)
    return a === null ? [] : [a]
  })
}

/** The newest real, not deleted weekly feature (rev 2, B5): its kind, prediction and week. */
export function lastFeatureSql(): SQL {
  return sql`
    select n.feature_kind, n.prediction, n.week_start
    from news_items n
    where n.is_test = false
      and n.deleted_at is null
      and n.feature_kind is not null
    order by n.id desc
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
export async function skipNewsBacklog(now: Date): Promise<void> {
  const since = new Date(now.getTime() - NEWS_BACKLOG_MS)
  await db.transaction(async (tx) => {
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
      m.shots_for, m.shots_against, m.pp_goals, m.pp_opportunities
    from matches m
    cross join lateral (select ${nightKeySql('m')} as night) x
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
 * as `aggregateOcrShots`. Raw SQL with aliases: the lateral subqueries must
 * not bind to the inner tables. No active-title condition (the caller passes
 * the title of a sheet it already allowed).
 */
export function listNewsNormGamesSql(args: { gameTitleId: number; beforeMatchId: number }): SQL {
  return sql`
    select m.id, m.score_for, bgm.credited_goals, m.hits_for, m.hits_against,
      coalesce(ocr.shots_for, m.shots_for) as shots_for,
      coalesce(ocr.shots_against, m.shots_against) as shots_against,
      m.time_on_attack, m.time_on_attack_against,
      m.pp_goals, m.pp_opportunities, m.pp_goals_against, m.pp_opportunities_against,
      bgm.pass_attempts, bgm.pass_completions,
      opp.pass_attempts as opp_pass_attempts, opp.pass_completions as opp_pass_completions
    from matches m
    join matches l on l.id = ${args.beforeMatchId}
    left join lateral (
      select sum(s.shots_for) as shots_for, sum(s.shots_against) as shots_against
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
