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
import type { DiscordPostStatus } from './discord-posts.js'

export const NEWS_JOB_KINDS = ['game', 'night', 'week'] as const
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
] as const
export type NewsReporterId = (typeof NEWS_REPORTER_IDS)[number]

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
    check('news_jobs_kind_check', sql`${table.kind} IN ('game', 'night', 'week')`),
    check(
      'news_jobs_status_check',
      sql`${table.status} IN ('pending', 'done', 'failed', 'skipped')`,
    ),
  ],
)

/**
 * A post (short Discord text) or article (site page) written by a reporter.
 * `body`: posts hold the text, articles hold paragraphs joined by a blank line.
 * `facts` is the fact sheet the item was written from.
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
    index('news_items_feed_idx').on(table.kind, table.isTest, table.deletedAt, table.id.desc()),
    check('news_items_kind_check', sql`${table.kind} IN ('post', 'article')`),
    check(
      'news_items_reporter_check',
      sql`${table.reporter} IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink')`,
    ),
    check(
      'news_items_discord_status_check',
      sql`${table.discordStatus} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)

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

export type NewsItemRow = typeof newsItems.$inferSelect
export type NewNewsItem = typeof newsItems.$inferInsert
export type NewNewsUsage = Omit<typeof newsAiUsage.$inferInsert, 'costUsd' | 'id' | 'createdAt'> & {
  costUsd: number
}
