import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  newsAiUsage,
  newsItems,
  newsJobs,
  newsSettings,
  playerProfiles,
  type NewNewsItem,
  type NewNewsUsage,
  type NewsItemKind,
  type NewsItemRow,
  type NewsJobKind,
  type PressLevel,
  type PressLevelSetBy,
} from '../schema/index.js'
import { MEMBER_CONDITION } from './club-members.js'
import { DISCORD_MAX_ATTEMPTS } from './discord-posts.js'
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
 * the Discord result post already settled (not pending), and either no job or a
 * failed one under the cap. `pending`, `done` and `skipped` jobs are never
 * returned. job_key holds the match id as text.
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
      and dp.status <> 'pending'
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
 * Night keys ('YYYY-MM-DD', active title) that are over: the last game ended
 * before `now - endedForMs` and after `since`; no night job yet (or a failed one
 * under the cap); and every counted (non-DNF) game of the night already has a
 * game job that is done or skipped.
 */
export function listEndedNightsSql(args: { now: Date; endedForMs: number; since: Date }): SQL {
  const cutoff = new Date(args.now.getTime() - args.endedForMs)
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
      and not exists (
        select 1
        from matches m2
        join game_titles g2 on g2.id = m2.game_title_id and g2.is_active
        where ${nightKeySql('m2')} = n.night
          and m2.result <> 'DNF'
          and not exists (
            select 1 from news_jobs gj
            where gj.kind = 'game' and gj.job_key = m2.id::text and gj.status in ('done', 'skipped')
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
 * cap back to pending (attempts + 1). Any other existing row claims nothing.
 */
export function claimNewsJobSql(kind: NewsJobKind, key: string, isTest: boolean): SQL {
  return sql`
    insert into news_jobs (kind, job_key, status, attempts, is_test)
    values (${kind}, ${key}, 'pending', 1, ${isTest})
    on conflict (kind, job_key) do update
      set status = 'pending', attempts = news_jobs.attempts + 1, updated_at = now()
      where news_jobs.status = 'failed' and news_jobs.attempts < ${MAX}
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
 * Remove everything a dry run wrote: its items, then its jobs (a leftover test
 * job would keep a real game from being covered). AI usage rows stay: the money
 * was spent. Returns the number of items removed.
 */
export async function deleteTestNewsItems(): Promise<number> {
  const rows = await db.delete(newsItems).where(eq(newsItems.isTest, true)).returning({
    id: newsItems.id,
  })
  await db.delete(newsJobs).where(eq(newsJobs.isTest, true))
  return rows.length
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

/** Items per reporter since `since` (real, not deleted) — for the frequency limits. */
export async function reporterActivity(args: {
  since: Date
}): Promise<{ reporter: string; night: string | null; createdAt: Date }[]> {
  return db
    .select({
      reporter: newsItems.reporter,
      night: newsItems.night,
      createdAt: newsItems.createdAt,
    })
    .from(newsItems)
    .where(
      and(
        publicNewsItemWhere(),
        sql`${newsItems.createdAt} >= ${args.since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(newsItems.id))
}

/** A reporter's latest headlines and summaries, newest first (the "don't repeat yourself" context). */
export async function recentReporterSummaries(
  reporter: string,
  limit: number,
): Promise<{ headline: string; summary: string; night: string | null }[]> {
  const rows = await db
    .select({ headline: newsItems.headline, summary: newsItems.summary, night: newsItems.night })
    .from(newsItems)
    .where(
      and(
        publicNewsItemWhere(),
        sql`${newsItems.reporter} = ${reporter}`,
        isNotNull(newsItems.headline),
        isNotNull(newsItems.summary),
      ),
    )
    .orderBy(desc(newsItems.id))
    .limit(limit)
  return rows.flatMap((r) =>
    r.headline === null || r.summary === null
      ? []
      : [{ headline: r.headline, summary: r.summary, night: r.night }],
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

function rawToNewsItem(r: RawNewsItem): NewsItemRow {
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
    facts: r.facts,
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

/** Hide an item from every public page now; the Discord message is deleted on the next pass. */
export async function softDeleteNewsItem(id: number): Promise<void> {
  await db
    .update(newsItems)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(newsItems.id, id), isNull(newsItems.deletedAt)))
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
