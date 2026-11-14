import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { players } from './players.js'
import { newsItems, type NewsReporterId } from './news.js'

/**
 * In-depth interviews (migration 0074): one reporter asks one player about 7
 * questions in a Discord thread, then writes a Q&A article. Separate from the
 * scrum tables on purpose (T2 changes those at the same time).
 */

/** Who started the interview: the GM (`/gm interview`), the player (`/interview`), or the night's story. */
export const INTERVIEW_TRIGGERS = ['gm', 'player', 'auto'] as const
export type InterviewTrigger = (typeof INTERVIEW_TRIGGERS)[number]

/**
 * `offered` = the offer waits for Accept (30 minutes); `active` = questions
 * run; `done` = all questions asked; `stopped` = ended early (the player
 * stopped answering or said it is over, or the press stopped); `expired` =
 * no Accept in time. No `declined`: the offer has no decline button
 * (ignoring it is the no).
 */
export const INTERVIEW_STATUSES = ['offered', 'active', 'done', 'stopped', 'expired'] as const
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number]

/**
 * The article step of a finished interview: `waiting` → `writing` (claimed)
 * → `written` | `skipped` (fewer than 3 usable or joke answers, or the extras
 * budget is spent) | `failed` (the writer gave up; not retried).
 */
export const INTERVIEW_ARTICLE_STATUSES = [
  'waiting',
  'writing',
  'written',
  'skipped',
  'failed',
] as const
export type InterviewArticleStatus = (typeof INTERVIEW_ARTICLE_STATUSES)[number]

export const INTERVIEW_ANSWER_USABILITY = ['usable', 'joke', 'unusable'] as const
export type InterviewAnswerUsability = (typeof INTERVIEW_ANSWER_USABILITY)[number]

const REPORTER_LIST = `'barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'`

export const newsInterviews = pgTable(
  'news_interviews',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    trigger: text('trigger').$type<InterviewTrigger>().notNull(),
    /** The Discord user who asked for it (the GM or the player); null for an automatic offer. */
    requestedByUserId: text('requested_by_user_id'),
    status: text('status').$type<InterviewStatus>().notNull().default('offered'),
    /** The night whose fact sheet the questions use (the player's latest night). */
    night: date('night', { mode: 'string' }).notNull(),
    /** The GM's topic (`/gm interview topic:`); null when none. */
    topic: text('topic'),
    channelId: text('channel_id').notNull(),
    /** The offer (or, for `/interview`, the opening) message; the thread hangs on it. */
    offerMessageId: text('offer_message_id'),
    /** Set once by the claim before the offer is sent: a crash never posts it twice. */
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    threadId: text('thread_id'),
    questionsAsked: integer('questions_asked').notNull().default(0),
    followupsAsked: integer('followups_asked').notNull().default(0),
    /** The open item is a follow-up (true) or a planned question (false). */
    askingFollowup: boolean('asking_followup').notNull().default(false),
    currentQuestion: text('current_question'),
    lastAskedAt: timestamp('last_asked_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    articleStatus: text('article_status')
      .$type<InterviewArticleStatus>()
      .notNull()
      .default('waiting'),
    articleItemId: bigint('article_item_id', { mode: 'number' }).references(() => newsItems.id, {
      onDelete: 'set null',
    }),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One open interview per player: a second start conflicts and inserts nothing.
    uniqueIndex('news_interviews_open_player_uniq')
      .on(table.playerId)
      .where(sql`status IN ('offered', 'active')`),
    // One automatic offer per night and mode: a second pass inserts nothing.
    uniqueIndex('news_interviews_auto_night_uniq')
      .on(table.night, table.isTest)
      .where(sql`"trigger" = 'auto'`),
    index('news_interviews_status_idx').on(table.status),
    index('news_interviews_created_at_idx').on(table.createdAt),
    check('news_interviews_reporter_check', sql.raw(`"reporter" IN (${REPORTER_LIST})`)),
    check('news_interviews_trigger_check', sql`${table.trigger} IN ('gm', 'player', 'auto')`),
    check(
      'news_interviews_status_check',
      sql`${table.status} IN ('offered', 'active', 'done', 'stopped', 'expired')`,
    ),
    check(
      'news_interviews_article_status_check',
      sql`${table.articleStatus} IN ('waiting', 'writing', 'written', 'skipped', 'failed')`,
    ),
  ],
)

/** One answer to one interview question. `usability` decides whether the article may print it. */
export const newsInterviewAnswers = pgTable(
  'news_interview_answers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    interviewId: bigint('interview_id', { mode: 'number' })
      .notNull()
      .references(() => newsInterviews.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    /** The reporter who asked (always the interview's reporter; kept per answer like T2's scrum answers). */
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    /** 1-based position in the interview (questions and follow-ups together). */
    position: integer('position').notNull(),
    isFollowup: boolean('is_followup').notNull().default(false),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    usability: text('usability').$type<InterviewAnswerUsability>().notNull(),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_interview_answers_interview_idx').on(table.interviewId),
    check('news_interview_answers_reporter_check', sql.raw(`"reporter" IN (${REPORTER_LIST})`)),
    check(
      'news_interview_answers_usability_check',
      sql`${table.usability} IN ('usable', 'joke', 'unusable')`,
    ),
  ],
)

export type NewsInterviewRow = typeof newsInterviews.$inferSelect
export type NewNewsInterview = typeof newsInterviews.$inferInsert
export type NewsInterviewAnswerRow = typeof newsInterviewAnswers.$inferSelect
export type NewNewsInterviewAnswer = typeof newsInterviewAnswers.$inferInsert
