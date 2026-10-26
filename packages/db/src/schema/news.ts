import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { matches } from './matches.js'
import { players } from './players.js'
import type { DiscordPostStatus } from './discord-posts.js'
import type { FeatureKind } from '../news/features.js'

/** C3a.8: `game_article` = a big game's article, job_key `<matchId>:<game|spotlight|column>`. */
export const NEWS_JOB_KINDS = ['game', 'night', 'week', 'game_article'] as const
export type NewsJobKind = (typeof NEWS_JOB_KINDS)[number]

export const NEWS_JOB_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const
export type NewsJobStatus = (typeof NEWS_JOB_STATUSES)[number]

export const NEWS_ITEM_KINDS = ['post', 'article'] as const
export type NewsItemKind = (typeof NEWS_ITEM_KINDS)[number]

export const NEWS_REPORTER_IDS = [
  'barlow',
  'voss',
  'mercer',
  'halberd',
  'vale',
  'quill',
  'rink',
  'pettibone',
  'bergstrom',
] as const
export type NewsReporterId = (typeof NEWS_REPORTER_IDS)[number]

/** A receipt's verdict on the prediction it judges (spec §12.15-4). */
export const RECEIPT_VERDICTS = ['hit', 'miss'] as const
export type ReceiptVerdict = (typeof RECEIPT_VERDICTS)[number]

export const NEWS_AI_PURPOSES = ['write', 'review'] as const
export type NewsAiPurpose = (typeof NEWS_AI_PURPOSES)[number]

/** A player the item names: the display name as printed, and the player row. */
export interface NewsMention {
  name: string
  playerId: number
}

/**
 * One unit of news-desk work: a game (job_key = match id), a night (job_key =
 * 'YYYY-MM-DD' night key) or a week (job_key = week-start 'YYYY-MM-DD').
 * Migration 0071, hand-applied. `pending` = claimed and in flight; it is never
 * re-picked, so a crash can never produce a second item. `failed` rows are
 * retried while attempts < 3. History at launch is `skipped`.
 */
export const newsJobs = pgTable(
  'news_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').$type<NewsJobKind>().notNull(),
    jobKey: text('job_key').notNull(),
    status: text('status').$type<NewsJobStatus>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('news_jobs_kind_job_key_uniq').on(table.kind, table.jobKey),
    check('news_jobs_kind_check', sql`${table.kind} IN ('game', 'night', 'week', 'game_article')`),
    check(
      'news_jobs_status_check',
      sql`${table.status} IN ('pending', 'done', 'failed', 'skipped')`,
    ),
  ],
)

/**
 * A post (short Discord text) or article (site page) written by a reporter.
 * `body`: posts hold the text, articles hold paragraphs joined by a blank line.
 * `facts` is the fact sheet the item was written from. Revision 2:
 * `criticized` = the people the item criticises harshly (pile-on limit),
 * `featureKind` + `prediction` = a weekly feature's kind and its prediction
 * for the next week (null on everything else).
 */
export const newsItems = pgTable(
  'news_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: bigint('job_id', { mode: 'number' }).references(() => newsJobs.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<NewsItemKind>().notNull(),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id, {
      onDelete: 'set null',
    }),
    night: date('night', { mode: 'string' }),
    weekStart: date('week_start', { mode: 'string' }),
    replyTo: bigint('reply_to', { mode: 'number' }).references((): AnyPgColumn => newsItems.id, {
      onDelete: 'cascade',
    }),
    slug: text('slug').unique(),
    headline: text('headline'),
    dek: text('dek'),
    body: text('body').notNull(),
    summary: text('summary'),
    mentions: jsonb('mentions').$type<NewsMention[]>().notNull().default([]),
    facts: jsonb('facts').$type<unknown>(),
    criticized: jsonb('criticized').$type<string[]>().notNull().default([]),
    prediction: text('prediction'),
    featureKind: text('feature_kind').$type<FeatureKind>(),
    /** Part C2: a weekly feature's verdict on the previous prediction; null when none. */
    receiptVerdict: text('receipt_verdict').$type<ReceiptVerdict>(),
    /** Part C3a: players the item called out for a zero (spec §12.12-5). */
    zeroCalled: jsonb('zero_called').$type<string[]>().notNull().default([]),
    /** Part C3a: ids of the reporter takes the item voiced (spec §12.19). */
    takesUsed: jsonb('takes_used').$type<number[]>().notNull().default([]),
    /** Part C3b: the version of the writing rules that wrote the item; null on older rows. */
    rulesVersion: text('rules_version'),
    /**
     * Part C3b: do not send to Discord before this time (a big game's posts go out
     * a few minutes apart). Null = send now. Cleared when the delivery pass claims it.
     */
    sendAfter: timestamp('send_after', { withTimezone: true }),
    isTest: boolean('is_test').notNull().default(false),
    discordStatus: text('discord_status').$type<DiscordPostStatus>().notNull().default('pending'),
    discordAttempts: integer('discord_attempts').notNull().default(0),
    discordMessageId: text('discord_message_id'),
    lastError: text('last_error'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    discordDeletedAt: timestamp('discord_deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_items_send_after_idx')
      .on(table.sendAfter)
      .where(sql`${table.sendAfter} IS NOT NULL`),
    index('news_items_feed_idx').on(table.kind, table.isTest, table.deletedAt, table.id.desc()),
    check('news_items_kind_check', sql`${table.kind} IN ('post', 'article')`),
    check(
      'news_items_reporter_check',
      sql`${table.reporter} IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom')`,
    ),
    check(
      'news_items_feature_kind_check',
      sql`${table.featureKind} IS NULL OR ${table.featureKind} IN ('trend', 'spotlight', 'notes', 'bigpicture', 'rink')`,
    ),
    check(
      'news_items_prediction_feature_check',
      sql`${table.prediction} IS NULL OR ${table.featureKind} IS NOT NULL`,
    ),
    check('news_items_criticized_array_check', sql`jsonb_typeof(${table.criticized}) = 'array'`),
    check('news_items_zero_called_array_check', sql`jsonb_typeof(${table.zeroCalled}) = 'array'`),
    check('news_items_takes_used_array_check', sql`jsonb_typeof(${table.takesUsed}) = 'array'`),
    check(
      'news_items_receipt_verdict_check',
      sql`${table.receiptVerdict} IS NULL OR (${table.receiptVerdict} IN ('hit', 'miss') AND ${table.featureKind} IS NOT NULL)`,
    ),
    check(
      'news_items_discord_status_check',
      sql`${table.discordStatus} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)

/**
 * A reporter's stance on a derived thread (Part C2, spec §12.17-3). Threads
 * are not stored: `threadKey` is the key the fact sheet derives (stable for
 * one thread). Deleting the item deletes its stances. Migration 0071.
 */
export const newsStances = pgTable(
  'news_stances',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    threadKey: text('thread_key').notNull(),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    stance: text('stance').notNull(),
    night: date('night', { mode: 'string' }),
    itemId: bigint('item_id', { mode: 'number' }).references(() => newsItems.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_stances_thread_key_idx').on(table.threadKey),
    check(
      'news_stances_reporter_check',
      sql`${table.reporter} IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom')`,
    ),
  ],
)

/** How many of the reporters share a take (spec §12.19). */
export const TAKE_SPREADS = ['some', 'a few', 'most'] as const
export type TakeSpread = (typeof TAKE_SPREADS)[number]

/**
 * A reporter's running take on a player (Part C3a, spec §12.19): GM-only
 * lore, read by the news service and the admin only — never on a public
 * page, in a feed or in Discord as a list. Migration 0071.
 */
export const newsReporterTakes = pgTable(
  'news_reporter_takes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    take: text('take').notNull(),
    spread: text('spread').$type<TakeSpread>().notNull().default('some'),
    critics: jsonb('critics').$type<NewsReporterId[]>().notNull().default([]),
    defender: text('defender').$type<NewsReporterId>(),
    dataAngle: text('data_angle'),
    active: boolean('active').notNull().default(true),
    /** -2..+2: softens (negative) or hardens (positive) the take. */
    intensity: integer('intensity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('news_reporter_takes_player_idx').on(table.playerId),
    check(
      'news_reporter_takes_reporter_check',
      sql`${table.reporter} IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom')`,
    ),
    check(
      'news_reporter_takes_defender_check',
      sql`${table.defender} IS NULL OR ${table.defender} IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom')`,
    ),
    check('news_reporter_takes_spread_check', sql`${table.spread} IN ('some', 'a few', 'most')`),
    check('news_reporter_takes_intensity_check', sql`${table.intensity} BETWEEN -2 AND 2`),
    check('news_reporter_takes_critics_array_check', sql`jsonb_typeof(${table.critics}) = 'array'`),
  ],
)

export type NewsReporterTakeRow = typeof newsReporterTakes.$inferSelect

/** One row per Claude call; the sum over a calendar month drives the money limit. */
export const newsAiUsage = pgTable(
  'news_ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: bigint('job_id', { mode: 'number' }).references(() => newsJobs.id, {
      onDelete: 'set null',
    }),
    purpose: text('purpose').$type<NewsAiPurpose>().notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('news_ai_usage_purpose_check', sql`${table.purpose} IN ('write', 'review')`)],
)

/** One row (id = 1): the on/off switch for the news desk. */
export const newsSettings = pgTable(
  'news_settings',
  {
    id: integer('id').primaryKey().default(1),
    enabled: boolean('enabled').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('news_settings_single_row_check', sql`${table.id} = 1`)],
)

/**
 * The per-reporter on/off switch (Part C3b, spec §12.18-6). A reporter without
 * a row is on. A switched-off reporter writes nothing new; items already
 * written stay. Migration 0071.
 */
export const newsReporterSwitch = pgTable(
  'news_reporter_switch',
  {
    reporter: text('reporter').$type<NewsReporterId>().primaryKey(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'news_reporter_switch_reporter_check',
      sql`${table.reporter} IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom')`,
    ),
  ],
)

export type NewsItemRow = typeof newsItems.$inferSelect
export type NewNewsStance = typeof newsStances.$inferInsert
export type NewNewsItem = typeof newsItems.$inferInsert
export type NewNewsUsage = Omit<typeof newsAiUsage.$inferInsert, 'costUsd' | 'id' | 'createdAt'> & {
  costUsd: number
}
