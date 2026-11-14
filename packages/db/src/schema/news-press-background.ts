import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { newsInterviewAnswers } from './news-interviews.js'
import { newsScrumAnswers } from './news-press.js'
import { players } from './players.js'

/**
 * Player background (Press Box dossier "Background", migration 0082, task background-b1).
 *
 * `news_background_questions`: the question bank, seeded once from the old worksheets in
 * `docs/specs/player-dossiers/` (questions only: no answers, no header facts). A generic question
 * (`player_id` null) is asked of everyone and uses `{name}` where the person's name goes; a
 * question with a `player_id` belongs to that member.
 *
 * `news_background_facts`: one fact about one person (a member, or a bench person or the coach),
 * which may name a second member (`subject_player_id`, a fact about a teammate). `status` is
 * proposed | confirmed | rejected: ONLY a confirmed fact is ever read by a writer; the admin
 * decides what is true about a teammate.
 */

export const BACKGROUND_PARTS = [
  'identity',
  'career',
  'hockey',
  'mentality',
  'room',
  'media',
  'pressure',
  'story',
  'flavor',
] as const
export type BackgroundPart = (typeof BACKGROUND_PARTS)[number]

/** The part names the page shows (the 9 parts of the old worksheets). */
export const BACKGROUND_PART_LABELS: Readonly<Record<BackgroundPart, string>> = {
  identity: 'Core identity',
  career: 'Career history and team timeline',
  hockey: 'Hockey identity',
  mentality: 'Mentality and personality',
  room: 'Room presence and team dynamics',
  media: 'Media and interview profile',
  pressure: 'Pressure, adversity and game state',
  story: 'Story hooks and article fuel',
  flavor: 'Flavor, habits and human detail',
}

export const BACKGROUND_FACT_STATUSES = ['proposed', 'confirmed', 'rejected'] as const
export type BackgroundFactStatus = (typeof BACKGROUND_FACT_STATUSES)[number]

export const BACKGROUND_FACT_SOURCES = ['admin', 'answer'] as const
export type BackgroundFactSource = (typeof BACKGROUND_FACT_SOURCES)[number]

const PART_LIST = BACKGROUND_PARTS.map((p) => `'${p}'`).join(', ')

export const newsBackgroundQuestions = pgTable(
  'news_background_questions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    part: text('part').$type<BackgroundPart>().notNull(),
    /** The question, with `{name}` where the person's name goes. */
    question: text('question').notNull(),
    /** Null = asked of everyone; set = this member's own question. */
    playerId: integer('player_id').references(() => players.id, { onDelete: 'cascade' }),
    /** The question asks about another player (relationships, who understands whose game, ...). */
    aboutTeammate: boolean('about_teammate').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('news_background_questions_generic_uniq')
      .on(table.question)
      .where(sql`player_id IS NULL`),
    uniqueIndex('news_background_questions_player_uniq')
      .on(table.playerId, table.question)
      .where(sql`player_id IS NOT NULL`),
    check('news_background_questions_part_check', sql.raw(`"part" IN (${PART_LIST})`)),
  ],
)
export type NewsBackgroundQuestionRow = typeof newsBackgroundQuestions.$inferSelect

export const newsBackgroundFacts = pgTable(
  'news_background_facts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** The person the fact is filed under: a member ... */
    playerId: integer('player_id').references(() => players.id, { onDelete: 'cascade' }),
    /** ... or a bench person or the coach (no players row). */
    discordUserId: text('discord_user_id'),
    displayName: text('display_name'),
    /** A fact about a teammate names that member here (it is listed under them as "what teammates said"). */
    subjectPlayerId: integer('subject_player_id').references(() => players.id, {
      onDelete: 'cascade',
    }),
    questionId: bigint('question_id', { mode: 'number' }).references(
      () => newsBackgroundQuestions.id,
      { onDelete: 'set null' },
    ),
    part: text('part').$type<BackgroundPart>().notNull(),
    text: text('text').notNull(),
    status: text('status').$type<BackgroundFactStatus>().notNull().default('proposed'),
    source: text('source').$type<BackgroundFactSource>().notNull(),
    sourceScrumAnswerId: bigint('source_scrum_answer_id', { mode: 'number' }).references(
      () => newsScrumAnswers.id,
      { onDelete: 'set null' },
    ),
    sourceInterviewAnswerId: bigint('source_interview_answer_id', { mode: 'number' }).references(
      () => newsInterviewAnswers.id,
      { onDelete: 'set null' },
    ),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    editedBy: text('edited_by'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => [
    index('news_background_facts_player_idx').on(table.playerId, table.status),
    index('news_background_facts_proposed_idx')
      .on(table.createdAt)
      .where(sql`status = 'proposed'`),
    check(
      'news_background_facts_person_check',
      sql`${table.playerId} IS NOT NULL OR (${table.discordUserId} IS NOT NULL AND ${table.displayName} IS NOT NULL)`,
    ),
    check('news_background_facts_part_check', sql.raw(`"part" IN (${PART_LIST})`)),
    check(
      'news_background_facts_status_check',
      sql`${table.status} IN ('proposed', 'confirmed', 'rejected')`,
    ),
    check(
      'news_background_facts_review_check',
      sql`${table.status} <> 'confirmed' OR (${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`,
    ),
  ],
)
export type NewsBackgroundFactRow = typeof newsBackgroundFacts.$inferSelect
