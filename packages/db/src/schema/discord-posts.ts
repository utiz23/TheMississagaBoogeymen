import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { matches } from './matches.js'

export const DISCORD_POST_STATUS = ['pending', 'posted', 'failed', 'skipped'] as const
export type DiscordPostStatus = (typeof DISCORD_POST_STATUS)[number]

/**
 * One row per game the discord service posted or skipped (migration 0067,
 * hand-applied). `pending` = claimed and in flight; it is never re-picked, so
 * a crash mid-post can never produce a second post. `failed` rows are retried
 * while attempts < DISCORD_MAX_ATTEMPTS. History at launch is `skipped`.
 */
export const discordPosts = pgTable(
  'discord_posts',
  {
    matchId: bigint('match_id', { mode: 'number' })
      .primaryKey()
      .references(() => matches.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('game_result'),
    status: text('status').$type<DiscordPostStatus>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    discordMessageId: text('discord_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'discord_posts_status_check',
      sql`${table.status} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)
