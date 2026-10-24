import { sql } from 'drizzle-orm'
import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { playerCardEvents } from './player-card-progression.js'
import type { DiscordPostStatus } from './discord-posts.js'

/**
 * One row per batch of card changes the discord service posted or skipped
 * (migration 0068, hand-applied). A batch = the player_card_events rows with
 * one (game_title_id, occurred_at); batch_event_id is its smallest event id.
 * Same states and no-double-post rule as discord_posts.
 */
export const discordCardPosts = pgTable(
  'discord_card_posts',
  {
    batchEventId: bigint('batch_event_id', { mode: 'number' })
      .primaryKey()
      .references(() => playerCardEvents.id, { onDelete: 'cascade' }),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
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
      'discord_card_posts_status_check',
      sql`${table.status} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)
