import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Press Box storylines (the admin page /admin/press-box/storylines; migration 0085, release L3).
 *
 * One row per storyline the admin acts on. A storyline is typed on the page (`thread_key` null;
 * its stances use the key `storyline:<id>`) or is a reporter-system thread the admin pinned or
 * closed (`thread_key` = the derived key). `pinned` = the suggested angle the writers get for the
 * next recap and scrums; at most ONE row is pinned (unique partial index) and a pinned row is
 * never closed. A closed row is read by no writer. `angle` may be empty.
 */
export const newsStorylines = pgTable(
  'news_storylines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    threadKey: text('thread_key'),
    title: text('title').notNull(),
    angle: text('angle').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('news_storylines_thread_key_uniq')
      .on(table.threadKey)
      .where(sql`${table.threadKey} IS NOT NULL`),
    uniqueIndex('news_storylines_one_pinned_uniq')
      .on(table.pinned)
      .where(sql`${table.pinned}`),
    check('news_storylines_title_check', sql`char_length(${table.title}) BETWEEN 1 AND 80`),
    check('news_storylines_angle_check', sql`char_length(${table.angle}) <= 300`),
    check(
      'news_storylines_pin_state_check',
      sql`NOT ${table.pinned} OR (${table.closedAt} IS NULL AND ${table.pinnedAt} IS NOT NULL)`,
    ),
  ],
)
export type NewsStorylineRow = typeof newsStorylines.$inferSelect
