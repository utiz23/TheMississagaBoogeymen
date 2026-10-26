import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db } from '../client.js'
import {
  newsGmNotes,
  newsItems,
  newsPlayerAliases,
  newsPressMirrors,
  newsPressSettings,
  newsReactionTriggers,
  newsReactionVotes,
  newsScrumAnswers,
  newsScrumPeople,
  newsScrums,
  playerProfiles,
  players,
  type NewNewsGmNote,
  type NewsGmNoteRow,
  type NewNewsScrum,
  type NewNewsScrumAnswer,
  type NewNewsScrumPerson,
  type NewsItemRow,
  type NewsPressSettingsRow,
  type NewsReporterId,
  type NewsScrumPersonRow,
  type NewsScrumRow,
  type PressHeat,
  type PressHeatScope,
  type PressLevel,
} from '../schema/index.js'
import { MEMBER_CONDITION } from './club-members.js'
import { NEWS_MAX_ATTEMPTS, nightKeySql } from './news.js'

// Press queries (news desk bots, migration 0072): scrums, GM notes, nicknames,
// the trial mirror and fan reactions. Each query has a `…Sql` / `…Query`
// builder that a test pins, and an async wrapper.

/** A pinged person has this long to accept before the ping is `expired`. */
export const PRESS_ACCEPT_WINDOW_MS = 5 * 60_000
/** An asked person has this long to answer before the round is closed. */
export const PRESS_ANSWER_WINDOW_MS = 15 * 60_000

const MAX = sql.raw(String(NEWS_MAX_ATTEMPTS))
/** Player display name: the profile's name when set, else the gamertag. `p` = players, `pp` = player_profiles. */
const DISPLAY_NAME = sql.raw(`coalesce(nullif(btrim(pp.player_name), ''), p.gamertag)`)

const num = (v: string | number): number => Number(v)
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))

// ── Scrums ──────────────────────────────────────────────────────────────────

/** Insert a scrum; a recap item that already has one conflicts and inserts nothing. */
export function insertScrumQuery(values: NewNewsScrum) {
  return db
    .insert(newsScrums)
    .values(values)
    .onConflictDoNothing({ target: newsScrums.recapItemId })
    .returning({ id: newsScrums.id })
}

/** The new scrum id; null when the recap item already has a scrum. */
export async function insertScrum(values: NewNewsScrum): Promise<number | null> {
  const rows = await insertScrumQuery(values)
  return rows[0]?.id ?? null
}

export async function scrumByRecapItem(itemId: number): Promise<NewsScrumRow | null> {
  const rows = await db.select().from(newsScrums).where(eq(newsScrums.recapItemId, itemId)).limit(1)
  return rows[0] ?? null
}

/** Set the scrum's thread once (only while it has none). */
export function setScrumThreadQuery(scrumId: number, threadId: string) {
  return db
    .update(newsScrums)
    .set({ threadId })
    .where(and(eq(newsScrums.id, scrumId), isNull(newsScrums.threadId)))
    .returning({ id: newsScrums.id })
}

/** True when this call set the thread. */
export async function setScrumThread(scrumId: number, threadId: string): Promise<boolean> {
  return (await setScrumThreadQuery(scrumId, threadId)).length > 0
}

export function lastScrumReporterQuery() {
  return db
    .select({ reporter: newsScrums.reporter })
    .from(newsScrums)
    .orderBy(desc(newsScrums.id))
    .limit(1)
}

/** The reporter of the newest scrum; null before the first scrum. */
export async function lastScrumReporter(): Promise<NewsReporterId | null> {
  return (await lastScrumReporterQuery())[0]?.reporter ?? null
}

/** The newest active GM note on the match that asks a player to talk. Test notes only when `includeTest`. */
export function gmAskForMatchQuery(matchId: number, includeTest: boolean) {
  return db
    .select({ playerId: newsGmNotes.playerId })
    .from(newsGmNotes)
    .where(
      and(
        eq(newsGmNotes.matchId, matchId),
        eq(newsGmNotes.status, 'active'),
        eq(newsGmNotes.asksPlayer, true),
        isNotNull(newsGmNotes.playerId),
        sql`(${newsGmNotes.isTest} = false or ${includeTest})`,
      ),
    )
    .orderBy(desc(newsGmNotes.id))
    .limit(1)
}

/** The player the GM asked for on this match; null when no note asks. */
export async function gmAskForMatch(matchId: number, includeTest: boolean): Promise<number | null> {
  return (await gmAskForMatchQuery(matchId, includeTest))[0]?.playerId ?? null
}

/** The match's newest scrum: test scrums when `isTest` (the trial), real ones otherwise. */
export function scrumForMatchQuery(matchId: number, isTest: boolean) {
  return db
    .select()
    .from(newsScrums)
    .where(and(eq(newsScrums.matchId, matchId), eq(newsScrums.isTest, isTest)))
    .orderBy(desc(newsScrums.id))
    .limit(1)
}

export async function scrumForMatch(
  matchId: number,
  isTest: boolean,
): Promise<NewsScrumRow | null> {
  return (await scrumForMatchQuery(matchId, isTest))[0] ?? null
}

export type PressMode = 'trial' | 'live'

export interface RecapItemWithoutScrum {
  itemId: number
  matchId: number | null
  night: string | null
  reporter: NewsReporterId
  createdAt: Date
  isTest: boolean
  /** Where the scrum hangs: the bot message (live) or its trial mirror (trial). */
  channelId: string
  messageId: string
}

/**
 * Game recap items that have no scrum yet, newer than `since`, oldest first.
 * Live: real recaps the bot posted. Trial: recaps with a live mirror row, test
 * items included (the scrum hangs on the mirror message).
 */
export function listRecapItemsWithoutScrumSql(args: {
  since: Date
  mode: PressMode
  limit: number
}): SQL {
  const live = args.mode === 'live'
  const where = live
    ? sql`n.discord_via = 'bot' and n.discord_status = 'posted' and n.is_test = false
      and n.discord_message_id is not null and n.discord_channel_id is not null`
    : sql`mi.deleted_at is null`
  return sql`
    select n.id, n.match_id, coalesce(to_char(n.night, 'YYYY-MM-DD'), to_char(${nightKeySql('m')}, 'YYYY-MM-DD')) as night,
      n.reporter, n.created_at, n.is_test,
      ${live ? sql`n.discord_channel_id` : sql`mi.channel_id`} as channel_id,
      ${live ? sql`n.discord_message_id` : sql`mi.message_id`} as message_id
    from news_items n
    ${live ? sql`` : sql`join news_press_mirrors mi on mi.item_id = n.id`}
    left join matches m on m.id = n.match_id
    where n.is_game_recap and n.deleted_at is null
      and ${where}
      and n.created_at > ${args.since.toISOString()}::timestamptz
      and not exists (select 1 from news_scrums s where s.recap_item_id = n.id)
    order by n.id asc
    limit ${args.limit}`
}

export async function listRecapItemsWithoutScrum(args: {
  since: Date
  mode: PressMode
  limit: number
}): Promise<RecapItemWithoutScrum[]> {
  const rows = await db.execute<{
    id: string | number
    match_id: string | number | null
    night: string | null
    reporter: NewsReporterId
    created_at: string | Date
    is_test: boolean
    channel_id: string
    message_id: string
  }>(listRecapItemsWithoutScrumSql(args))
  return rows.map((r) => ({
    itemId: num(r.id),
    matchId: r.match_id === null ? null : num(r.match_id),
    night: r.night,
    reporter: r.reporter,
    createdAt: toDate(r.created_at),
    isTest: r.is_test,
    channelId: r.channel_id,
    messageId: r.message_id,
  }))
}

// ── Scrum people ────────────────────────────────────────────────────────────

export function insertScrumPersonQuery(values: NewNewsScrumPerson) {
  return db
    .insert(newsScrumPeople)
    .values(values)
    .onConflictDoNothing({ target: [newsScrumPeople.scrumId, newsScrumPeople.playerId] })
    .returning({ id: newsScrumPeople.id })
}

/** The new person id; null when this player is already in the scrum. */
export async function insertScrumPerson(values: NewNewsScrumPerson): Promise<number | null> {
  const rows = await insertScrumPersonQuery(values)
  return rows[0]?.id ?? null
}

/** Take the ping: sets `pinged_at` only while it is null, so only one caller sends it. */
export function claimPingQuery(personId: number) {
  return db
    .update(newsScrumPeople)
    .set({ pingedAt: sql`now()` })
    .where(and(eq(newsScrumPeople.id, personId), isNull(newsScrumPeople.pingedAt)))
    .returning({ id: newsScrumPeople.id })
}

/** True when this call took the ping. */
export async function claimPing(personId: number): Promise<boolean> {
  return (await claimPingQuery(personId)).length > 0
}

/** A scrum person with the scrum fields the timer pass needs. */
export interface ScrumPersonWithScrum {
  id: number
  scrumId: number
  playerId: number
  discordUserId: string
  pingMessageId: string | null
  currentQuestion: string | null
  channelId: string
  threadId: string | null
  scrumMessageId: string
  reporter: NewsReporterId
  /** A trial scrum: its thread lines mention the GM. */
  isTest: boolean
}

type RawPersonWithScrum = {
  id: string | number
  scrum_id: string | number
  player_id: string | number
  discord_user_id: string
  ping_message_id: string | null
  current_question: string | null
  channel_id: string
  thread_id: string | null
  scrum_message_id: string
  reporter: NewsReporterId
  is_test: boolean
}

const PERSON_WITH_SCRUM_COLUMNS = sql`
  p.id, p.scrum_id, p.player_id, p.discord_user_id, p.ping_message_id, p.current_question,
  s.channel_id, s.thread_id, s.message_id as scrum_message_id, s.reporter, s.is_test`

function rowToPersonWithScrum(r: RawPersonWithScrum): ScrumPersonWithScrum {
  return {
    id: num(r.id),
    scrumId: num(r.scrum_id),
    playerId: num(r.player_id),
    discordUserId: r.discord_user_id,
    pingMessageId: r.ping_message_id,
    currentQuestion: r.current_question,
    channelId: r.channel_id,
    threadId: r.thread_id,
    scrumMessageId: r.scrum_message_id,
    reporter: r.reporter,
    isTest: r.is_test,
  }
}

/** Pinged people who did not accept within the accept window. */
export function listExpiredPingsSql(now: Date): SQL {
  const cutoff = new Date(now.getTime() - PRESS_ACCEPT_WINDOW_MS).toISOString()
  return sql`
    select ${PERSON_WITH_SCRUM_COLUMNS}
    from news_scrum_people p
    join news_scrums s on s.id = p.scrum_id
    where p.status = 'pinged' and p.pinged_at is not null and p.pinged_at < ${cutoff}::timestamptz
    order by p.id asc`
}

export async function listExpiredPings(now: Date): Promise<ScrumPersonWithScrum[]> {
  const rows = await db.execute<RawPersonWithScrum>(listExpiredPingsSql(now))
  return rows.map(rowToPersonWithScrum)
}

/** Asked people who did not answer within the answer window. */
export function listExpiredQuestionsSql(now: Date): SQL {
  const cutoff = new Date(now.getTime() - PRESS_ANSWER_WINDOW_MS).toISOString()
  return sql`
    select ${PERSON_WITH_SCRUM_COLUMNS}
    from news_scrum_people p
    join news_scrums s on s.id = p.scrum_id
    where p.status = 'asking' and p.last_asked_at < ${cutoff}::timestamptz
    order by p.id asc`
}

export async function listExpiredQuestions(now: Date): Promise<ScrumPersonWithScrum[]> {
  const rows = await db.execute<RawPersonWithScrum>(listExpiredQuestionsSql(now))
  return rows.map(rowToPersonWithScrum)
}

export type ScrumPersonUpdate = Partial<Omit<NewNewsScrumPerson, 'id' | 'scrumId' | 'playerId'>>

export async function updateScrumPerson(id: number, patch: ScrumPersonUpdate): Promise<void> {
  await db.update(newsScrumPeople).set(patch).where(eq(newsScrumPeople.id, id))
}

export async function insertScrumAnswer(values: NewNewsScrumAnswer): Promise<number> {
  const rows = await db
    .insert(newsScrumAnswers)
    .values(values)
    .returning({ id: newsScrumAnswers.id })
  const row = rows[0]
  if (!row) throw new Error('insertScrumAnswer: no row returned')
  return row.id
}

/** A scrum person with their display name and their scrum. */
export type ScrumPersonDetail = NewsScrumPersonRow & { name: string; scrum: NewsScrumRow }

/** One person by id, or every person still to ping (`pinged`, `pinged_at` null), oldest first. */
export function scrumPersonDetailQuery(by: { id: number } | { toPing: true }) {
  return db
    .select({
      person: newsScrumPeople,
      scrum: newsScrums,
      name: sql<string>`coalesce(nullif(btrim(${playerProfiles.playerName}), ''), ${players.gamertag})`,
    })
    .from(newsScrumPeople)
    .innerJoin(newsScrums, eq(newsScrums.id, newsScrumPeople.scrumId))
    .innerJoin(players, eq(players.id, newsScrumPeople.playerId))
    .leftJoin(playerProfiles, eq(playerProfiles.playerId, newsScrumPeople.playerId))
    .where(
      'id' in by
        ? eq(newsScrumPeople.id, by.id)
        : and(eq(newsScrumPeople.status, 'pinged'), isNull(newsScrumPeople.pingedAt)),
    )
    .orderBy(asc(newsScrumPeople.id))
    .limit('id' in by ? 1 : 20)
}

export async function getScrumPerson(id: number): Promise<ScrumPersonDetail | null> {
  const row = (await scrumPersonDetailQuery({ id }))[0]
  return row === undefined ? null : { ...row.person, name: row.name, scrum: row.scrum }
}

export async function listPeopleToPing(): Promise<ScrumPersonDetail[]> {
  const rows = await scrumPersonDetailQuery({ toPing: true })
  return rows.map((r) => ({ ...r.person, name: r.name, scrum: r.scrum }))
}

export function listScrumAnswersQuery(personId: number) {
  return db
    .select({
      question: newsScrumAnswers.question,
      answer: newsScrumAnswers.answer,
      usability: newsScrumAnswers.usability,
    })
    .from(newsScrumAnswers)
    .where(eq(newsScrumAnswers.personId, personId))
    .orderBy(asc(newsScrumAnswers.id))
}

/** One person's earlier questions and answers, oldest first. */
export async function listScrumAnswers(
  personId: number,
): Promise<{ question: string; answer: string; usability: 'usable' | 'joke' | 'unusable' }[]> {
  return listScrumAnswersQuery(personId)
}

/**
 * End a person's round: `pinged` → `expired` (no accept), `asking` → `done`
 * (no answer). Only while the row is still in that state and, with a
 * `cutoff`, older than it, so an accept or an answer that came in first wins.
 * A null cutoff ends the round now (the person left the fact sheet).
 */
export function expireScrumPersonQuery(id: number, from: 'pinged' | 'asking', cutoff: Date | null) {
  const pinged = from === 'pinged'
  return db
    .update(newsScrumPeople)
    .set(pinged ? { status: 'expired' } : { status: 'done', currentQuestion: null })
    .where(
      and(
        eq(newsScrumPeople.id, id),
        eq(newsScrumPeople.status, from),
        cutoff === null
          ? undefined
          : pinged
            ? lt(newsScrumPeople.pingedAt, cutoff)
            : lt(newsScrumPeople.lastAskedAt, cutoff),
      ),
    )
    .returning({ id: newsScrumPeople.id })
}

/** True when this call ended the round. */
export async function expireScrumPerson(
  id: number,
  from: 'pinged' | 'asking',
  cutoff: Date | null,
): Promise<boolean> {
  return (await expireScrumPersonQuery(id, from, cutoff)).length > 0
}

/**
 * Take the next question: only from the expected question count and while the
 * person is pinged or asking, so two callers never post the same question.
 */
export function claimScrumQuestionQuery(args: {
  personId: number
  questionsAsked: number
  question: string
  at: Date
}) {
  return db
    .update(newsScrumPeople)
    .set({
      status: 'asking',
      questionsAsked: sql`${newsScrumPeople.questionsAsked} + 1`,
      askingFollowup: false,
      currentQuestion: args.question,
      lastAskedAt: args.at,
    })
    .where(
      and(
        eq(newsScrumPeople.id, args.personId),
        eq(newsScrumPeople.questionsAsked, args.questionsAsked),
        inArray(newsScrumPeople.status, ['pinged', 'asking']),
      ),
    )
    .returning({ id: newsScrumPeople.id })
}

/** True when this call took the question. */
export async function claimScrumQuestion(args: {
  personId: number
  questionsAsked: number
  question: string
  at: Date
}): Promise<boolean> {
  return (await claimScrumQuestionQuery(args)).length > 0
}

/**
 * Accept a ping: `pinged` → `asking`, only while the ping is inside the accept
 * window (`pinged_at` ≥ `cutoff`), so a late accept and the expiry pass never
 * both win. `last_asked_at` starts the answer window: if the first question
 * never goes out, the expiry pass still closes the round.
 */
export function acceptScrumPersonQuery(personId: number, cutoff: Date, at: Date) {
  return db
    .update(newsScrumPeople)
    .set({ status: 'asking', lastAskedAt: at })
    .where(
      and(
        eq(newsScrumPeople.id, personId),
        eq(newsScrumPeople.status, 'pinged'),
        gte(newsScrumPeople.pingedAt, cutoff),
      ),
    )
    .returning({ id: newsScrumPeople.id })
}

/** True when this call took the accept. */
export async function acceptScrumPerson(
  personId: number,
  cutoff: Date,
  at: Date,
): Promise<boolean> {
  return (await acceptScrumPersonQuery(personId, cutoff, at)).length > 0
}

/**
 * Take the answer to the current question: only from the expected counts and
 * while a question is open. Clears the question (a second submit finds none)
 * and renews `last_asked_at` (the expiry pass does not close the round while
 * the answer is judged).
 */
export function claimScrumAnswerQuery(args: {
  personId: number
  questionsAsked: number
  followupsAsked: number
  at: Date
}) {
  return db
    .update(newsScrumPeople)
    .set({ currentQuestion: null, lastAskedAt: args.at })
    .where(
      and(
        eq(newsScrumPeople.id, args.personId),
        eq(newsScrumPeople.status, 'asking'),
        eq(newsScrumPeople.questionsAsked, args.questionsAsked),
        eq(newsScrumPeople.followupsAsked, args.followupsAsked),
        isNotNull(newsScrumPeople.currentQuestion),
      ),
    )
    .returning({ id: newsScrumPeople.id })
}

/** True when this call took the answer. */
export async function claimScrumAnswer(args: {
  personId: number
  questionsAsked: number
  followupsAsked: number
  at: Date
}): Promise<boolean> {
  return (await claimScrumAnswerQuery(args)).length > 0
}

/**
 * The recap item of the newest scrum whose recap is newer than `since`; with
 * a `playerId`, only a game that player played. Test scrums only when `isTest`
 * (the trial), real ones only otherwise.
 */
export function latestScrumItemSql(args: {
  playerId: number | null
  since: Date
  isTest: boolean
}): SQL {
  const played =
    args.playerId === null
      ? sql``
      : sql`and exists (select 1 from player_match_stats pms
          where pms.match_id = s.match_id and pms.player_id = ${args.playerId})`
  return sql`
    select s.recap_item_id
    from news_scrums s
    join news_items n on n.id = s.recap_item_id
    where s.is_test = ${args.isTest} and n.deleted_at is null
      and n.created_at > ${args.since.toISOString()}::timestamptz
      ${played}
    order by n.created_at desc, s.id desc
    limit 1`
}

export async function latestScrumItem(args: {
  playerId: number | null
  since: Date
  isTest: boolean
}): Promise<number | null> {
  const rows = await db.execute<{ recap_item_id: string | number }>(latestScrumItemSql(args))
  const id = rows[0]?.recap_item_id
  return id === undefined ? null : num(id)
}

/** Automatic pings this player got tonight (every scrum of the night, test or real). */
export function countAutoPingsTonightSql(playerId: number, night: string): SQL {
  return sql`
    select count(*)::int as n
    from news_scrum_people p
    join news_scrums s on s.id = p.scrum_id
    where p.requested_by = 'auto' and p.player_id = ${playerId} and s.night = ${night}::date`
}

export async function countAutoPingsTonight(playerId: number, night: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(countAutoPingsTonightSql(playerId, night))
  return Number(rows[0]?.n ?? 0)
}

/** Times this Discord user asked for a scrum person with a command tonight. */
export function countCommandUsesTonightSql(userId: string, night: string): SQL {
  return sql`
    select count(*)::int as n
    from news_scrum_people p
    join news_scrums s on s.id = p.scrum_id
    where p.requested_by = 'command' and p.requested_by_user_id = ${userId} and s.night = ${night}::date`
}

export async function countCommandUsesTonight(userId: string, night: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(countCommandUsesTonightSql(userId, night))
  return Number(rows[0]?.n ?? 0)
}

/**
 * Is a scrum live that night: a person is being asked, or was pinged within the
 * accept window (5 minutes, database clock)? The night recap waits while it is.
 * Test scrums count only when `includeTest`.
 */
export function nightHasActiveScrumSql(night: string, includeTest: boolean): SQL {
  return sql`
    select exists (
      select 1
      from news_scrum_people p
      join news_scrums s on s.id = p.scrum_id
      where s.night = ${night}::date
        and (s.is_test = false or ${includeTest})
        and (p.status = 'asking'
          or (p.status = 'pinged' and p.pinged_at > now() - interval '5 minutes'))
    ) as active`
}

export async function nightHasActiveScrum(night: string, includeTest: boolean): Promise<boolean> {
  const rows = await db.execute<{ active: boolean }>(nightHasActiveScrumSql(night, includeTest))
  return rows[0]?.active === true
}

// ── Press material for the night recap ──────────────────────────────────────

export interface PressQuote {
  answerId: number
  playerId: number
  name: string
  question: string
  answer: string
  usability: 'usable' | 'joke'
}

export interface PressNote {
  id: number
  playerName: string | null
  note: string
  matchId: number | null
  /** A critical note is never used for a "Go easy" player. */
  critical: boolean
}

/** Usable or joke answers of the night, oldest first, never from players whose press level is `out`. */
export function nightPressMaterialSql(night: string, includeTest: boolean): SQL {
  return sql`
    select a.id as answer_id, a.player_id, ${DISPLAY_NAME} as name, a.question, a.answer, a.usability
    from news_scrum_answers a
    join players p on p.id = a.player_id
    left join player_profiles pp on pp.player_id = a.player_id
    where a.night = ${night}::date
      and a.usability in ('usable', 'joke')
      and coalesce(pp.press_level, 'full') <> 'out'
      and (a.is_test = false or ${includeTest})
    order by a.id asc`
}

/** The night's active GM notes, oldest first. */
export function nightPressNotesSql(night: string, includeTest: boolean): SQL {
  return sql`
    select g.id, ${DISPLAY_NAME} as player_name, g.note, g.match_id, g.critical
    from news_gm_notes g
    left join players p on p.id = g.player_id
    left join player_profiles pp on pp.player_id = g.player_id
    where g.night = ${night}::date
      and g.status = 'active'
      and (g.is_test = false or ${includeTest})
    order by g.id asc`
}

export async function nightPressMaterial(
  night: string,
  includeTest: boolean,
): Promise<{ quotes: PressQuote[]; gmNotes: PressNote[] }> {
  const quotes = await db.execute<{
    answer_id: string | number
    player_id: string | number
    name: string
    question: string
    answer: string
    usability: 'usable' | 'joke'
  }>(nightPressMaterialSql(night, includeTest))
  const notes = await db.execute<{
    id: string | number
    player_name: string | null
    note: string
    match_id: string | number | null
    critical: boolean
  }>(nightPressNotesSql(night, includeTest))
  return {
    quotes: quotes.map((r) => ({
      answerId: num(r.answer_id),
      playerId: num(r.player_id),
      name: r.name,
      question: r.question,
      answer: r.answer,
      usability: r.usability,
    })),
    gmNotes: notes.map((r) => ({
      id: num(r.id),
      playerName: r.player_name,
      note: r.note,
      matchId: r.match_id === null ? null : num(r.match_id),
      critical: r.critical === true,
    })),
  }
}

// ── GM notes, roster and nicknames ──────────────────────────────────────────

export async function insertGmNote(values: NewNewsGmNote): Promise<number> {
  const rows = await db.insert(newsGmNotes).values(values).returning({ id: newsGmNotes.id })
  const row = rows[0]
  if (!row) throw new Error('insertGmNote: no row returned')
  return row.id
}

export function getGmNoteQuery(id: number) {
  return db.select().from(newsGmNotes).where(eq(newsGmNotes.id, id)).limit(1)
}

export async function getGmNote(id: number): Promise<NewsGmNoteRow | null> {
  return (await getGmNoteQuery(id))[0] ?? null
}

export type GmNoteUpdate = Partial<Pick<NewNewsGmNote, 'playerId' | 'status' | 'refusal'>>

/** Update a note while it is not cancelled (a cancel is final). */
export function updateGmNoteQuery(id: number, patch: GmNoteUpdate) {
  return db
    .update(newsGmNotes)
    .set(patch)
    .where(and(eq(newsGmNotes.id, id), sql`${newsGmNotes.status} <> ${'cancelled'}`))
    .returning({ id: newsGmNotes.id })
}

/** True when the note was updated; false when it is gone or cancelled. Never with an empty patch. */
export async function updateGmNote(id: number, patch: GmNoteUpdate): Promise<boolean> {
  return (await updateGmNoteQuery(id, patch)).length > 0
}

/**
 * The player's GM-requested scrum people that night (each one a GM ping, sent
 * or due). A person expired before its ping (the GM corrected or cancelled the
 * note) does not count. Test scrums only when `includeTest`.
 */
export function countGmPingsTonightSql(playerId: number, night: string, includeTest: boolean): SQL {
  return sql`
    select count(*)::int as n
    from news_scrum_people p
    join news_scrums s on s.id = p.scrum_id
    where p.requested_by = 'gm' and p.player_id = ${playerId} and s.night = ${night}::date
      and (s.is_test = false or ${includeTest})
      and not (p.status = 'expired' and p.pinged_at is null)`
}

export async function countGmPingsTonight(
  playerId: number,
  night: string,
  includeTest: boolean,
): Promise<number> {
  const rows = await db.execute<{ n: number }>(countGmPingsTonightSql(playerId, night, includeTest))
  return Number(rows[0]?.n ?? 0)
}

/** Expire the GM-requested person of this player in the scrum while the ping is not sent yet. */
export function expireUnpingedGmPersonQuery(scrumId: number, playerId: number) {
  return db
    .update(newsScrumPeople)
    .set({ status: 'expired' })
    .where(
      and(
        eq(newsScrumPeople.scrumId, scrumId),
        eq(newsScrumPeople.playerId, playerId),
        eq(newsScrumPeople.requestedBy, 'gm'),
        eq(newsScrumPeople.status, 'pinged'),
        isNull(newsScrumPeople.pingedAt),
      ),
    )
    .returning({ id: newsScrumPeople.id })
}

/** True when a waiting GM person was expired; false when none (or already pinged). */
export async function expireUnpingedGmPerson(scrumId: number, playerId: number): Promise<boolean> {
  return (await expireUnpingedGmPersonQuery(scrumId, playerId)).length > 0
}

/**
 * The night (`YYYY-MM-DD`) of the newest counted (not DNF) game of an active
 * title that ended after `since`; none = no game to attach a GM note to.
 */
export function latestPressNightSql(since: Date): SQL {
  return sql`
    select to_char(${nightKeySql('m')}, 'YYYY-MM-DD') as night
    from matches m
    join game_titles g on g.id = m.game_title_id and g.is_active
    where m.played_at > ${since.toISOString()}::timestamptz and m.result <> 'DNF'
    order by m.played_at desc, m.id desc
    limit 1`
}

export async function latestPressNight(since: Date): Promise<string | null> {
  const rows = await db.execute<{ night: string }>(latestPressNightSql(since))
  return rows[0]?.night ?? null
}

export interface PressRosterEntry {
  playerId: number
  name: string
  gamertag: string
  pressLevel: PressLevel
  aliases: string[]
}

/** Human club members (no AI goalies) with press level and nicknames. */
export function listPressRosterSql(): SQL {
  return sql`
    select p.id, ${DISPLAY_NAME} as name, p.gamertag,
      coalesce(pp.press_level, 'full') as press_level,
      coalesce((select array_agg(a.alias order by a.alias)
        from news_player_aliases a where a.player_id = p.id), '{}'::text[]) as aliases
    from players p
    left join player_profiles pp on pp.player_id = p.id
    where ${MEMBER_CONDITION} and p.ai_goalie_side is null
    order by lower(p.gamertag), p.id`
}

export async function listPressRoster(): Promise<PressRosterEntry[]> {
  const rows = await db.execute<{
    id: string | number
    name: string
    gamertag: string
    press_level: PressLevel
    aliases: string[] | null
  }>(listPressRosterSql())
  return rows.map((r) => ({
    playerId: num(r.id),
    name: r.name,
    gamertag: r.gamertag,
    pressLevel: r.press_level,
    aliases: r.aliases ?? [],
  }))
}

/** Save a nickname (stored lowercase); an existing nickname moves to the new player. */
export async function upsertAlias(alias: string, playerId: number): Promise<void> {
  const key = alias.trim().toLowerCase()
  await db
    .insert(newsPlayerAliases)
    .values({ alias: key, playerId })
    .onConflictDoUpdate({ target: newsPlayerAliases.alias, set: { playerId } })
}

/** True when the nickname existed. */
export async function deleteAlias(alias: string): Promise<boolean> {
  const rows = await db
    .delete(newsPlayerAliases)
    .where(eq(newsPlayerAliases.alias, alias.trim().toLowerCase()))
    .returning({ alias: newsPlayerAliases.alias })
  return rows.length > 0
}

export interface PlayerAlias {
  alias: string
  playerId: number
  name: string
}

export function listAliasesSql(): SQL {
  return sql`
    select a.alias, a.player_id, ${DISPLAY_NAME} as name
    from news_player_aliases a
    join players p on p.id = a.player_id
    left join player_profiles pp on pp.player_id = a.player_id
    order by a.alias`
}

export async function listAliases(): Promise<PlayerAlias[]> {
  const rows = await db.execute<{ alias: string; player_id: string | number; name: string }>(
    listAliasesSql(),
  )
  return rows.map((r) => ({ alias: r.alias, playerId: num(r.player_id), name: r.name }))
}

// ── Press settings: heat and the trial mirror mark ──────────────────────────

const DEFAULT_PRESS_SETTINGS: NewsPressSettingsRow = {
  id: 1,
  heat: 'normal',
  heatScope: 'night',
  heatNight: null,
  mirrorFromItemId: null,
  updatedAt: new Date(0),
}

/** The settings row; defaults when the migration's seed row is missing. */
export async function getPressSettings(): Promise<NewsPressSettingsRow> {
  const rows = await db.select().from(newsPressSettings).where(eq(newsPressSettings.id, 1))
  return rows[0] ?? DEFAULT_PRESS_SETTINGS
}

/** Set the heat. Scope `night` ties it to `night`; scope `next` ignores the night. */
export async function setHeat(
  heat: PressHeat,
  scope: PressHeatScope,
  night: string | null,
): Promise<void> {
  const heatNight = scope === 'night' ? night : null
  await db
    .insert(newsPressSettings)
    .values({ id: 1, heat, heatScope: scope, heatNight })
    .onConflictDoUpdate({
      target: newsPressSettings.id,
      set: { heat, heatScope: scope, heatNight, updatedAt: sql`now()` },
    })
}

/**
 * Read a `next`-scope heat and reset the setting to normal in one statement, so
 * two passes never both use it. Returns nothing when the scope is not `next`.
 */
export function consumeNextHeatSql(): SQL {
  return sql`
    with old as (
      select heat from news_press_settings where id = 1 and heat_scope = 'next' for update
    )
    update news_press_settings s
    set heat = 'normal', heat_scope = 'night', heat_night = null, updated_at = now()
    from old
    where s.id = 1
    returning old.heat`
}

export async function consumeNextHeat(): Promise<PressHeat | null> {
  const rows = await db.execute<{ heat: PressHeat }>(consumeNextHeatSql())
  return rows[0]?.heat ?? null
}

/** Set the trial mirror mark once (only while it is null). True when this call set it. */
export async function setMirrorFrom(itemId: number): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(sql`
    insert into news_press_settings (id, mirror_from_item_id) values (1, ${itemId})
    on conflict (id) do update
      set mirror_from_item_id = excluded.mirror_from_item_id, updated_at = now()
      where news_press_settings.mirror_from_item_id is null
    returning id`)
  return rows.length > 0
}

// ── Trial mirror ────────────────────────────────────────────────────────────

/** Items newer than the mark that are not deleted and have no mirror row, oldest first. */
export function listItemsToMirrorQuery(afterId: number, limit: number) {
  return db
    .select()
    .from(newsItems)
    .where(
      and(
        gt(newsItems.id, afterId),
        isNull(newsItems.deletedAt),
        // Qualified name: a bare column would bind to mi.
        sql`not exists (select 1 from news_press_mirrors mi where mi.item_id = "news_items"."id")`,
      ),
    )
    .orderBy(asc(newsItems.id))
    .limit(limit)
}

export async function listItemsToMirror(afterId: number, limit: number): Promise<NewsItemRow[]> {
  return listItemsToMirrorQuery(afterId, limit)
}

export async function insertMirror(args: {
  itemId: number
  channelId: string
  messageId: string
}): Promise<void> {
  await db.insert(newsPressMirrors).values(args).onConflictDoNothing()
}

export interface MirrorDeletion {
  itemId: number
  channelId: string
  messageId: string
}

/** Mirrors whose item is now deleted and whose Discord message still exists. */
export function listMirrorDeletionsSql(limit: number): SQL {
  return sql`
    select mi.item_id, mi.channel_id, mi.message_id
    from news_press_mirrors mi
    join news_items n on n.id = mi.item_id
    where mi.deleted_at is null and n.deleted_at is not null
    order by mi.item_id asc
    limit ${limit}`
}

export async function listMirrorDeletions(limit: number): Promise<MirrorDeletion[]> {
  const rows = await db.execute<{
    item_id: string | number
    channel_id: string
    message_id: string
  }>(listMirrorDeletionsSql(limit))
  return rows.map((r) => ({
    itemId: num(r.item_id),
    channelId: r.channel_id,
    messageId: r.message_id,
  }))
}

export async function markMirrorDeleted(itemId: number): Promise<void> {
  await db
    .update(newsPressMirrors)
    .set({ deletedAt: sql`now()` })
    .where(eq(newsPressMirrors.itemId, itemId))
}

// ── Fan reactions ───────────────────────────────────────────────────────────

export function insertReactionVoteQuery(itemId: number, userId: string) {
  return db
    .insert(newsReactionVotes)
    .values({ itemId, userId })
    .onConflictDoNothing()
    .returning({ itemId: newsReactionVotes.itemId })
}

/** True when this person had not voted for the item before. */
export async function insertReactionVote(itemId: number, userId: string): Promise<boolean> {
  return (await insertReactionVoteQuery(itemId, userId)).length > 0
}

export async function countReactionPeople(itemId: number): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from news_reaction_votes where item_id = ${itemId}`,
  )
  return Number(rows[0]?.n ?? 0)
}

export function insertReactionTriggerQuery(args: {
  itemId: number
  night: string
  isTest: boolean
}) {
  return db
    .insert(newsReactionTriggers)
    .values(args)
    .onConflictDoNothing({ target: newsReactionTriggers.itemId })
    .returning({ itemId: newsReactionTriggers.itemId })
}

/** The item id; null when the item already has a trigger. */
export async function insertReactionTrigger(args: {
  itemId: number
  night: string
  isTest: boolean
}): Promise<number | null> {
  const rows = await insertReactionTriggerQuery(args)
  return rows[0]?.itemId ?? null
}

export async function countReactionTriggersTonight(night: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from news_reaction_triggers where night = ${night}::date`,
  )
  return Number(rows[0]?.n ?? 0)
}

export interface ReactionTriggerToRun {
  itemId: number
  night: string
  isTest: boolean
  matchId: number | null
  reporter: NewsReporterId
}

/**
 * Triggers whose item is not deleted and that have no reaction job, or one
 * failed under the attempt cap. Test triggers only when `includeTest`.
 */
export function listReactionTriggersWithoutJobSql(includeTest: boolean, limit: number): SQL {
  return sql`
    select t.item_id, to_char(t.night, 'YYYY-MM-DD') as night, t.is_test, n.match_id, n.reporter
    from news_reaction_triggers t
    join news_items n on n.id = t.item_id
    left join news_jobs j on j.kind = 'reaction' and j.job_key = t.item_id::text
    where (t.is_test = false or ${includeTest})
      and n.deleted_at is null
      and (j.job_key is null or (j.status = 'failed' and j.attempts < ${MAX}))
    order by t.item_id asc
    limit ${limit}`
}

export async function listReactionTriggersWithoutJob(
  includeTest: boolean,
  limit: number,
): Promise<ReactionTriggerToRun[]> {
  const rows = await db.execute<{
    item_id: string | number
    night: string
    is_test: boolean
    match_id: string | number | null
    reporter: NewsReporterId
  }>(listReactionTriggersWithoutJobSql(includeTest, limit))
  return rows.map((r) => ({
    itemId: num(r.item_id),
    night: r.night,
    isTest: r.is_test,
    matchId: r.match_id === null ? null : num(r.match_id),
    reporter: r.reporter,
  }))
}

export type {
  NewsScrumRow,
  NewsScrumPersonRow,
  NewNewsScrum,
  NewNewsScrumPerson,
  NewNewsScrumAnswer,
  NewNewsGmNote,
  NewsGmNoteRow,
  NewsPressSettingsRow,
} from '../schema/index.js'
