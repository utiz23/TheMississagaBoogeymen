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
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { matches } from './matches.js'
import { players } from './players.js'
import { newsItems, type NewsReporterId } from './news.js'

/** How hard the reporters push in a scrum. */
export const PRESS_HEATS = ['cool', 'normal', 'hot'] as const
export type PressHeat = (typeof PRESS_HEATS)[number]

/** How long a heat setting lasts: for the next scrum only, or for tonight. */
export const PRESS_HEAT_SCOPES = ['next', 'night'] as const
export type PressHeatScope = (typeof PRESS_HEAT_SCOPES)[number]

export const SCRUM_PERSON_ROLES = ['picked', 'volunteer'] as const
export type ScrumPersonRole = (typeof SCRUM_PERSON_ROLES)[number]

/** Who asked for the person: the pick rule, the GM, a /scrum command, or the player. */
export const SCRUM_REQUESTED_BY = ['auto', 'gm', 'command', 'self'] as const
export type ScrumRequestedBy = (typeof SCRUM_REQUESTED_BY)[number]

export const SCRUM_PERSON_STATUSES = ['pinged', 'asking', 'done', 'expired'] as const
export type ScrumPersonStatus = (typeof SCRUM_PERSON_STATUSES)[number]

export const SCRUM_ANSWER_USABILITY = ['usable', 'joke', 'unusable'] as const
export type ScrumAnswerUsability = (typeof SCRUM_ANSWER_USABILITY)[number]

export const GM_NOTE_STATUSES = ['active', 'refused', 'cancelled'] as const
export type GmNoteStatus = (typeof GM_NOTE_STATUSES)[number]

const REPORTER_LIST = `'barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'`

/**
 * A question round after a game recap: one per recap item. The scrum message
 * sits in `channel_id`; each asked person gets a thread. Migration 0072.
 */
export const newsScrums = pgTable(
  'news_scrums',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id, {
      onDelete: 'set null',
    }),
    night: date('night', { mode: 'string' }).notNull(),
    recapItemId: bigint('recap_item_id', { mode: 'number' })
      .notNull()
      .references(() => newsItems.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    threadId: text('thread_id'),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    heat: text('heat').$type<PressHeat>().notNull(),
    buzzLevel: text('buzz_level').notNull(),
    openUntil: timestamp('open_until', { withTimezone: true }).notNull(),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('news_scrums_recap_item_id_key').on(table.recapItemId),
    index('news_scrums_night_idx').on(table.night),
    check('news_scrums_reporter_check', sql.raw(`"reporter" IN (${REPORTER_LIST})`)),
    check('news_scrums_heat_check', sql`${table.heat} IN ('cool', 'normal', 'hot')`),
  ],
)

/** A person in a scrum and where they are in the round. */
export const newsScrumPeople = pgTable(
  'news_scrum_people',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scrumId: bigint('scrum_id', { mode: 'number' })
      .notNull()
      .references(() => newsScrums.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    discordUserId: text('discord_user_id').notNull(),
    role: text('role').$type<ScrumPersonRole>().notNull(),
    requestedBy: text('requested_by').$type<ScrumRequestedBy>().notNull(),
    requestedByUserId: text('requested_by_user_id'),
    status: text('status').$type<ScrumPersonStatus>().notNull().default('pinged'),
    pingMessageId: text('ping_message_id'),
    /** Set once by `claimPing`, before the ping is sent: a crash never pings twice. */
    pingedAt: timestamp('pinged_at', { withTimezone: true }),
    questionsAsked: integer('questions_asked').notNull().default(0),
    followupsAsked: integer('followups_asked').notNull().default(0),
    /** The open item is a follow-up (true) or a question (false): one follow-up per question. */
    askingFollowup: boolean('asking_followup').notNull().default(false),
    currentQuestion: text('current_question'),
    lastAskedAt: timestamp('last_asked_at', { withTimezone: true }),
    /**
     * The reporters who ask this person, in order (migration 0073). Empty = an old
     * one-reporter round: the scrum's own reporter asks, with the old limits.
     */
    panel: text('panel')
      .array()
      .$type<NewsReporterId[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Questions plus follow-ups the round aims for (2-6); null = an old round. */
    targetTotal: integer('target_total'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('news_scrum_people_scrum_player_uniq').on(table.scrumId, table.playerId),
    index('news_scrum_people_status_idx').on(table.status),
    check('news_scrum_people_role_check', sql`${table.role} IN ('picked', 'volunteer')`),
    check('news_scrum_people_panel_check', sql.raw(`"panel" <@ ARRAY[${REPORTER_LIST}]::text[]`)),
    check(
      'news_scrum_people_target_total_check',
      sql`${table.targetTotal} IS NULL OR ${table.targetTotal} BETWEEN 2 AND 6`,
    ),
    check(
      'news_scrum_people_requested_by_check',
      sql`${table.requestedBy} IN ('auto', 'gm', 'command', 'self')`,
    ),
    check(
      'news_scrum_people_status_check',
      sql`${table.status} IN ('pinged', 'asking', 'done', 'expired')`,
    ),
  ],
)

/** One answer to one question. `usability` decides whether the night recap may quote it. */
export const newsScrumAnswers = pgTable(
  'news_scrum_answers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    personId: bigint('person_id', { mode: 'number' })
      .notNull()
      .references(() => newsScrumPeople.id, { onDelete: 'cascade' }),
    scrumId: bigint('scrum_id', { mode: 'number' })
      .notNull()
      .references(() => newsScrums.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    night: date('night', { mode: 'string' }).notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    usability: text('usability').$type<ScrumAnswerUsability>().notNull(),
    /** The reporter who asked (migration 0073); null = the scrum's own reporter. */
    reporter: text('reporter').$type<NewsReporterId>(),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_scrum_answers_night_idx').on(table.night),
    check(
      'news_scrum_answers_reporter_check',
      sql.raw(`"reporter" IS NULL OR "reporter" IN (${REPORTER_LIST})`),
    ),
    check(
      'news_scrum_answers_usability_check',
      sql`${table.usability} IN ('usable', 'joke', 'unusable')`,
    ),
  ],
)

/** A note from the GM (the operator) about a game or a player. */
export const newsGmNotes = pgTable(
  'news_gm_notes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id, {
      onDelete: 'set null',
    }),
    night: date('night', { mode: 'string' }).notNull(),
    playerId: integer('player_id').references(() => players.id, { onDelete: 'set null' }),
    nickname: text('nickname'),
    note: text('note').notNull(),
    asksPlayer: boolean('asks_player').notNull().default(false),
    critical: boolean('critical').notNull().default(false),
    theme: text('theme'),
    status: text('status').$type<GmNoteStatus>().notNull().default('active'),
    refusal: text('refusal'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_gm_notes_night_idx').on(table.night),
    check('news_gm_notes_status_check', sql`${table.status} IN ('active', 'refused', 'cancelled')`),
  ],
)

/**
 * The GM's `/gm ask` (migration 0073): this player is asked this question (word
 * for word when `exact`, else as a topic in the reporter's voice) as their first
 * question, by `reporter` (null = the first reporter of their panel). Not a
 * `news_gm_notes` row: a note reaches the writers as a true event of the night,
 * and a question is not an event.
 */
export const newsGmAsks = pgTable(
  'news_gm_asks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id, {
      onDelete: 'set null',
    }),
    night: date('night', { mode: 'string' }).notNull(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    question: text('question').notNull(),
    exact: boolean('exact').notNull().default(true),
    reporter: text('reporter').$type<NewsReporterId>(),
    status: text('status').$type<GmNoteStatus>().notNull().default('active'),
    refusal: text('refusal'),
    requestedByUserId: text('requested_by_user_id'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_gm_asks_match_player_idx').on(table.matchId, table.playerId),
    index('news_gm_asks_night_idx').on(table.night),
    check('news_gm_asks_status_check', sql`${table.status} IN ('active', 'refused', 'cancelled')`),
    check(
      'news_gm_asks_reporter_check',
      sql.raw(`"reporter" IS NULL OR "reporter" IN (${REPORTER_LIST})`),
    ),
  ],
)

/** A nickname for a player. `alias` is stored lowercase. */
export const newsPlayerAliases = pgTable(
  'news_player_aliases',
  {
    alias: text('alias').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('news_player_aliases_lowercase_check', sql`${table.alias} = lower(${table.alias})`),
  ],
)

/** One row (id = 1): the heat, how long it lasts, and where the trial mirror starts. */
export const newsPressSettings = pgTable(
  'news_press_settings',
  {
    id: integer('id').primaryKey().default(1),
    heat: text('heat').$type<PressHeat>().notNull().default('normal'),
    heatScope: text('heat_scope').$type<PressHeatScope>().notNull().default('night'),
    heatNight: date('heat_night', { mode: 'string' }),
    /** Trial mirror: only items with a larger id are copied (history is never mirrored). */
    mirrorFromItemId: bigint('mirror_from_item_id', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('news_press_settings_single_row_check', sql`${table.id} = 1`),
    check('news_press_settings_heat_check', sql`${table.heat} IN ('cool', 'normal', 'hot')`),
    check('news_press_settings_heat_scope_check', sql`${table.heatScope} IN ('next', 'night')`),
  ],
)

/** The trial copy of a news item in the bot test channel. */
export const newsPressMirrors = pgTable('news_press_mirrors', {
  itemId: bigint('item_id', { mode: 'number' })
    .primaryKey()
    .references(() => newsItems.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

/** One reaction vote per person per item (a Discord user id). */
export const newsReactionVotes = pgTable(
  'news_reaction_votes',
  {
    itemId: bigint('item_id', { mode: 'number' })
      .notNull()
      .references(() => newsItems.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.userId] })],
)

/** An item whose fans reacted enough to earn a follow-up. */
export const newsReactionTriggers = pgTable(
  'news_reaction_triggers',
  {
    itemId: bigint('item_id', { mode: 'number' })
      .primaryKey()
      .references(() => newsItems.id, { onDelete: 'cascade' }),
    night: date('night', { mode: 'string' }).notNull(),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('news_reaction_triggers_night_idx').on(table.night)],
)

export type NewsScrumRow = typeof newsScrums.$inferSelect
export type NewNewsScrum = typeof newsScrums.$inferInsert
export type NewsScrumPersonRow = typeof newsScrumPeople.$inferSelect
export type NewNewsScrumPerson = typeof newsScrumPeople.$inferInsert
export type NewNewsScrumAnswer = typeof newsScrumAnswers.$inferInsert
export type NewsGmNoteRow = typeof newsGmNotes.$inferSelect
export type NewNewsGmNote = typeof newsGmNotes.$inferInsert
export type NewsGmAskRow = typeof newsGmAsks.$inferSelect
export type NewNewsGmAsk = typeof newsGmAsks.$inferInsert
export type NewsPressSettingsRow = typeof newsPressSettings.$inferSelect
