import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db } from '../client.js'
import {
  newsInterviewAnswers,
  newsInterviews,
  playerProfiles,
  players,
  type InterviewArticleStatus,
  type InterviewStatus,
  type NewNewsInterview,
  type NewNewsInterviewAnswer,
  type NewsInterviewRow,
  type NewsReporterId,
} from '../schema/index.js'
import { nightKeySql } from './news.js'

// Press interview queries (migration 0074). Each query has a `…Sql` / `…Query`
// builder that a test pins (`__tests__/news-interviews.test.ts`), and an async
// wrapper. Every state change two callers could both make is a conditional
// update that says whether this call made it.

const num = (v: string | number): number => Number(v)

/** An interview with the player's display name (profile name, else gamertag). */
export type InterviewDetail = NewsInterviewRow & { name: string }

/** The patch `updateInterview` takes: never the ids or the player. */
export type InterviewUpdate = Partial<
  Omit<NewNewsInterview, 'id' | 'playerId' | 'trigger' | 'isTest' | 'createdAt'>
>

/** Insert an interview; a player with an open one (or a second auto offer for the night) inserts nothing. */
export function insertInterviewQuery(values: NewNewsInterview) {
  return db
    .insert(newsInterviews)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: newsInterviews.id })
}

/** The new interview id; null when the player already has an open interview. */
export async function insertInterview(values: NewNewsInterview): Promise<number | null> {
  const rows = await insertInterviewQuery(values)
  return rows[0]?.id ?? null
}

type DetailFilter =
  | { id: number }
  | { toOffer: true }
  | { expiredOffers: Date }
  | { expiredQuestions: Date }
  | { forArticle: true }

/**
 * Interviews with the player's name: one by id; the offers still to post
 * (`offered`, never claimed); offers claimed at or before a cutoff (no
 * Accept in time); active interviews whose last question or answer is at or
 * before a cutoff; finished interviews whose article step waits. Oldest first.
 */
export function interviewDetailQuery(by: DetailFilter) {
  let where: SQL | undefined
  if ('id' in by) where = eq(newsInterviews.id, by.id)
  else if ('toOffer' in by) {
    where = and(eq(newsInterviews.status, 'offered'), isNull(newsInterviews.offeredAt))
  } else if ('expiredOffers' in by) {
    where = and(
      eq(newsInterviews.status, 'offered'),
      isNotNull(newsInterviews.offeredAt),
      lte(newsInterviews.offeredAt, by.expiredOffers),
    )
  } else if ('expiredQuestions' in by) {
    where = and(
      eq(newsInterviews.status, 'active'),
      sql`coalesce(${newsInterviews.lastAskedAt}, ${newsInterviews.acceptedAt}, ${newsInterviews.createdAt}) <= ${by.expiredQuestions.toISOString()}::timestamptz`,
    )
  } else {
    where = and(
      inArray(newsInterviews.status, ['done', 'stopped']),
      eq(newsInterviews.articleStatus, 'waiting'),
    )
  }
  return db
    .select({
      interview: newsInterviews,
      name: sql<string>`coalesce(nullif(btrim(${playerProfiles.playerName}), ''), ${players.gamertag})`,
    })
    .from(newsInterviews)
    .innerJoin(players, eq(players.id, newsInterviews.playerId))
    .leftJoin(playerProfiles, eq(playerProfiles.playerId, newsInterviews.playerId))
    .where(where)
    .orderBy(asc(newsInterviews.id))
    .limit('id' in by ? 1 : 20)
}

async function details(by: DetailFilter): Promise<InterviewDetail[]> {
  const rows = await interviewDetailQuery(by)
  return rows.map((r) => ({ ...r.interview, name: r.name }))
}

export async function getInterview(id: number): Promise<InterviewDetail | null> {
  return (await details({ id }))[0] ?? null
}

export async function listInterviewsToOffer(): Promise<InterviewDetail[]> {
  return details({ toOffer: true })
}

export async function listExpiredInterviewOffers(cutoff: Date): Promise<InterviewDetail[]> {
  return details({ expiredOffers: cutoff })
}

export async function listExpiredInterviewQuestions(cutoff: Date): Promise<InterviewDetail[]> {
  return details({ expiredQuestions: cutoff })
}

export async function listInterviewsForArticle(): Promise<InterviewDetail[]> {
  return details({ forArticle: true })
}

/** Never with an empty patch (drizzle throws on an empty set). */
export async function updateInterview(id: number, patch: InterviewUpdate): Promise<void> {
  await db.update(newsInterviews).set(patch).where(eq(newsInterviews.id, id))
}

/** Take the offer for posting: sets `offered_at` only while it is null, so only one caller sends it. */
export function claimInterviewOfferQuery(id: number, at: Date) {
  return db
    .update(newsInterviews)
    .set({ offeredAt: at })
    .where(
      and(
        eq(newsInterviews.id, id),
        eq(newsInterviews.status, 'offered'),
        isNull(newsInterviews.offeredAt),
      ),
    )
    .returning({ id: newsInterviews.id })
}

export async function claimInterviewOffer(id: number, at: Date): Promise<boolean> {
  return (await claimInterviewOfferQuery(id, at)).length > 0
}

/** Accept: `offered` → `active` only while the offer is newer than `cutoff`. */
export function acceptInterviewQuery(id: number, cutoff: Date, at: Date) {
  return db
    .update(newsInterviews)
    .set({ status: 'active', acceptedAt: at, lastAskedAt: at })
    .where(
      and(
        eq(newsInterviews.id, id),
        eq(newsInterviews.status, 'offered'),
        gte(newsInterviews.offeredAt, cutoff),
      ),
    )
    .returning({ id: newsInterviews.id })
}

export async function acceptInterview(id: number, cutoff: Date, at: Date): Promise<boolean> {
  return (await acceptInterviewQuery(id, cutoff, at)).length > 0
}

/**
 * Take the next planned question: only on the counters the caller read and
 * while no item is open. Counts it and opens it.
 */
export function claimInterviewQuestionQuery(args: {
  id: number
  questionsAsked: number
  followupsAsked: number
  question: string
  at: Date
}) {
  return db
    .update(newsInterviews)
    .set({
      questionsAsked: args.questionsAsked + 1,
      askingFollowup: false,
      currentQuestion: args.question,
      lastAskedAt: args.at,
    })
    .where(
      and(
        eq(newsInterviews.id, args.id),
        eq(newsInterviews.status, 'active'),
        eq(newsInterviews.questionsAsked, args.questionsAsked),
        eq(newsInterviews.followupsAsked, args.followupsAsked),
        isNull(newsInterviews.currentQuestion),
      ),
    )
    .returning({ id: newsInterviews.id })
}

export async function claimInterviewQuestion(args: {
  id: number
  questionsAsked: number
  followupsAsked: number
  question: string
  at: Date
}): Promise<boolean> {
  return (await claimInterviewQuestionQuery(args)).length > 0
}

/** Take a follow-up: like a question, but it counts as the follow-up. */
export function claimInterviewFollowupQuery(args: {
  id: number
  questionsAsked: number
  followupsAsked: number
  question: string
  at: Date
}) {
  return db
    .update(newsInterviews)
    .set({
      followupsAsked: args.followupsAsked + 1,
      askingFollowup: true,
      currentQuestion: args.question,
      lastAskedAt: args.at,
    })
    .where(
      and(
        eq(newsInterviews.id, args.id),
        eq(newsInterviews.status, 'active'),
        eq(newsInterviews.questionsAsked, args.questionsAsked),
        eq(newsInterviews.followupsAsked, args.followupsAsked),
        isNull(newsInterviews.currentQuestion),
      ),
    )
    .returning({ id: newsInterviews.id })
}

export async function claimInterviewFollowup(args: {
  id: number
  questionsAsked: number
  followupsAsked: number
  question: string
  at: Date
}): Promise<boolean> {
  return (await claimInterviewFollowupQuery(args)).length > 0
}

/**
 * Take the answer to the open item: only on the counters the answer was
 * given for. Closes the item and restarts the clock (the next line must go
 * out within the answer window, or the expiry pass ends the interview).
 */
export function claimInterviewAnswerQuery(args: {
  id: number
  questionsAsked: number
  followupsAsked: number
  at: Date
}) {
  return db
    .update(newsInterviews)
    .set({ currentQuestion: null, lastAskedAt: args.at })
    .where(
      and(
        eq(newsInterviews.id, args.id),
        eq(newsInterviews.status, 'active'),
        eq(newsInterviews.questionsAsked, args.questionsAsked),
        eq(newsInterviews.followupsAsked, args.followupsAsked),
        isNotNull(newsInterviews.currentQuestion),
      ),
    )
    .returning({ id: newsInterviews.id })
}

export async function claimInterviewAnswer(args: {
  id: number
  questionsAsked: number
  followupsAsked: number
  at: Date
}): Promise<boolean> {
  return (await claimInterviewAnswerQuery(args)).length > 0
}

/**
 * End an interview: `from` → `to`, closing any open item. With a cutoff
 * (the expiry pass) only when the offer or the last line is at or before it.
 * True when this call ended it.
 */
export function endInterviewQuery(args: {
  id: number
  from: 'offered' | 'active'
  to: Extract<InterviewStatus, 'done' | 'stopped' | 'expired'>
  cutoff: Date | null
  at: Date
}) {
  const late =
    args.cutoff === null
      ? undefined
      : args.from === 'offered'
        ? lte(newsInterviews.offeredAt, args.cutoff)
        : sql`coalesce(${newsInterviews.lastAskedAt}, ${newsInterviews.acceptedAt}, ${newsInterviews.createdAt}) <= ${args.cutoff.toISOString()}::timestamptz`
  return db
    .update(newsInterviews)
    .set({ status: args.to, endedAt: args.at, currentQuestion: null })
    .where(and(eq(newsInterviews.id, args.id), eq(newsInterviews.status, args.from), late))
    .returning({ id: newsInterviews.id })
}

export async function endInterview(args: {
  id: number
  from: 'offered' | 'active'
  to: Extract<InterviewStatus, 'done' | 'stopped' | 'expired'>
  cutoff: Date | null
  at: Date
}): Promise<boolean> {
  return (await endInterviewQuery(args)).length > 0
}

export async function insertInterviewAnswer(values: NewNewsInterviewAnswer): Promise<number> {
  const rows = await db
    .insert(newsInterviewAnswers)
    .values(values)
    .returning({ id: newsInterviewAnswers.id })
  const row = rows[0]
  if (!row) throw new Error('insertInterviewAnswer: no row returned')
  return row.id
}

export interface InterviewAnswer {
  position: number
  isFollowup: boolean
  question: string
  answer: string
  usability: 'usable' | 'joke' | 'unusable'
}

export function listInterviewAnswersQuery(interviewId: number) {
  return db
    .select({
      position: newsInterviewAnswers.position,
      isFollowup: newsInterviewAnswers.isFollowup,
      question: newsInterviewAnswers.question,
      answer: newsInterviewAnswers.answer,
      usability: newsInterviewAnswers.usability,
    })
    .from(newsInterviewAnswers)
    .where(eq(newsInterviewAnswers.interviewId, interviewId))
    .orderBy(asc(newsInterviewAnswers.position), asc(newsInterviewAnswers.id))
}

export async function listInterviewAnswers(interviewId: number): Promise<InterviewAnswer[]> {
  return listInterviewAnswersQuery(interviewId)
}

/**
 * The interview with a question open for this Discord user in this thread (a
 * typed answer), or none. The window and the counters are checked by the handler.
 */
export function openInterviewInThreadSql(threadId: string, userId: string): SQL {
  return sql`
    select i.id
    from news_interviews i
    where i.thread_id = ${threadId}
      and i.discord_user_id = ${userId}
      and i.status = 'active'
      and i.current_question is not null
    order by i.id desc
    limit 1`
}

export async function findOpenInterviewInThread(
  threadId: string,
  userId: string,
): Promise<number | null> {
  const rows = await db.execute<{ id: string | number }>(openInterviewInThreadSql(threadId, userId))
  const id = rows[0]?.id
  return id === undefined ? null : num(id)
}

/** Take the article step: `waiting` → `writing`. True when this call took it. */
export function claimInterviewArticleQuery(id: number) {
  return db
    .update(newsInterviews)
    .set({ articleStatus: 'writing' })
    .where(and(eq(newsInterviews.id, id), eq(newsInterviews.articleStatus, 'waiting')))
    .returning({ id: newsInterviews.id })
}

export async function claimInterviewArticle(id: number): Promise<boolean> {
  return (await claimInterviewArticleQuery(id)).length > 0
}

/** End the article step from `writing`: written (with the item), skipped or failed. */
export async function finishInterviewArticle(
  id: number,
  status: Exclude<InterviewArticleStatus, 'waiting' | 'writing'>,
  itemId: number | null,
): Promise<void> {
  await db
    .update(newsInterviews)
    .set({ articleStatus: status, articleItemId: itemId })
    .where(and(eq(newsInterviews.id, id), eq(newsInterviews.articleStatus, 'writing')))
}

/**
 * `/interview` uses by this player since `since`, in one mode (test or real).
 * An `expired` one never started (its opening message failed) and does not count.
 */
export function countPlayerInterviewsSinceSql(playerId: number, since: Date, isTest: boolean): SQL {
  return sql`
    select count(*)::int as n
    from news_interviews
    where player_id = ${playerId} and "trigger" = 'player' and is_test = ${isTest}
      and status <> 'expired'
      and created_at > ${since.toISOString()}::timestamptz`
}

export async function countPlayerInterviewsSince(
  playerId: number,
  since: Date,
  isTest: boolean,
): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    countPlayerInterviewsSinceSql(playerId, since, isTest),
  )
  return Number(rows[0]?.n ?? 0)
}

/** Automatic offers for the club since `since` (any status), in one mode. */
export function countAutoInterviewsSinceSql(since: Date, isTest: boolean): SQL {
  return sql`
    select count(*)::int as n
    from news_interviews
    where "trigger" = 'auto' and is_test = ${isTest}
      and created_at > ${since.toISOString()}::timestamptz`
}

export async function countAutoInterviewsSince(since: Date, isTest: boolean): Promise<number> {
  const rows = await db.execute<{ n: number }>(countAutoInterviewsSinceSql(since, isTest))
  return Number(rows[0]?.n ?? 0)
}

export function lastInterviewReporterQuery() {
  return db
    .select({ reporter: newsInterviews.reporter })
    .from(newsInterviews)
    .orderBy(desc(newsInterviews.id))
    .limit(1)
}

export async function lastInterviewReporter(): Promise<NewsReporterId | null> {
  return (await lastInterviewReporterQuery())[0]?.reporter ?? null
}

/** The latest night (`YYYY-MM-DD`) this player played in an active title since `since`; DNF games do not count. */
export function latestPlayerNightSql(playerId: number, since: Date): SQL {
  return sql`
    select to_char(${nightKeySql('m')}, 'YYYY-MM-DD') as night
    from matches m
    join game_titles g on g.id = m.game_title_id and g.is_active
    join player_match_stats pms on pms.match_id = m.id and pms.player_id = ${playerId}
    where m.played_at > ${since.toISOString()}::timestamptz and m.result <> 'DNF'
    order by m.played_at desc, m.id desc
    limit 1`
}

export async function latestPlayerNight(playerId: number, since: Date): Promise<string | null> {
  const rows = await db.execute<{ night: string }>(latestPlayerNightSql(playerId, since))
  return rows[0]?.night ?? null
}

/**
 * The newest night recap (the night article of a `night` job) since `since`
 * whose night has no automatic interview in this mode yet. Live (`isTest`
 * false): real items only. Trial: test items too.
 */
export function nightForAutoInterviewSql(since: Date, isTest: boolean): SQL {
  return sql`
    select to_char(n.night, 'YYYY-MM-DD') as night
    from news_items n
    join news_jobs j on j.id = n.job_id and j.kind = 'night'
    where n.kind = 'article' and n.night is not null and n.deleted_at is null
      and n.created_at > ${since.toISOString()}::timestamptz
      ${isTest ? sql`` : sql`and n.is_test = false`}
      and not exists (select 1 from news_interviews i
        where i."trigger" = 'auto' and i.night = n.night and i.is_test = ${isTest})
    order by n.created_at desc, n.id desc
    limit 1`
}

export async function nightForAutoInterview(since: Date, isTest: boolean): Promise<string | null> {
  const rows = await db.execute<{ night: string }>(nightForAutoInterviewSql(since, isTest))
  return rows[0]?.night ?? null
}

export type {
  InterviewArticleStatus,
  InterviewStatus,
  InterviewTrigger,
  NewNewsInterview,
  NewNewsInterviewAnswer,
  NewsInterviewRow,
} from '../schema/index.js'
