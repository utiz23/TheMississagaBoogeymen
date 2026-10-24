import { sql } from 'drizzle-orm'
import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { playerCardEvents } from './player-card-progression.js'
import type { DiscordPostStatus } from './discord-posts.js'

/**
 * One row per card event the discord service posted or skipped (migration
 * 0069, hand-applied) — one Discord message per unlock. Same states and
 * no-double-post rule as discord_posts.
 */
export const discordUnlockPosts = pgTable(
  'discord_unlock_posts',
  {
    eventId: bigint('event_id', { mode: 'number' })
      .primaryKey()
      .references(() => playerCardEvents.id, { onDelete: 'cascade' }),
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
      'discord_unlock_posts_status_check',
      sql`${table.status} IN ('pending', 'posted', 'failed', 'skipped')`,
    ),
  ],
)
