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
  unique,
} from 'drizzle-orm/pg-core'
import { players } from './players.js'
import { newsItems, type NewsReporterId } from './news.js'

/**
 * A reporter's answer to a team member's Discord reply on a wire post (T4,
 * migration 0075). The row is claimed before the AI call, so a person gets at
 * most one answer per post even after a crash. The member's reply text is
 * NEVER stored: only its message id. The reporter's answer is stored.
 */

/** `claimed` = being written; `answered` = posted; `failed` = no answer went out. */
export const WIRE_REPLY_STATUSES = ['claimed', 'answered', 'failed'] as const
export type WireReplyStatus = (typeof WIRE_REPLY_STATUSES)[number]

const REPORTER_LIST = `'barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'`

export const newsWireReplies = pgTable(
  'news_wire_replies',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemId: bigint('item_id', { mode: 'number' })
      .notNull()
      .references(() => newsItems.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    /** The reporter who answers: the post's own reporter. */
    reporter: text('reporter').$type<NewsReporterId>().notNull(),
    /** The post's night: the nightly limit counts by it. */
    night: date('night', { mode: 'string' }).notNull(),
    /** The member's reply message (its id only, never its text). */
    replyMessageId: text('reply_message_id').notNull(),
    /** The reporter's answer message, once posted. */
    answerMessageId: text('answer_message_id'),
    /** The reporter's answer, once written. */
    answer: text('answer'),
    status: text('status').$type<WireReplyStatus>().notNull().default('claimed'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('news_wire_replies_item_user_uniq').on(table.itemId, table.discordUserId),
    index('news_wire_replies_night_idx').on(table.night),
    check('news_wire_replies_reporter_check', sql.raw(`"reporter" IN (${REPORTER_LIST})`)),
    check(
      'news_wire_replies_status_check',
      sql`${table.status} IN ('claimed', 'answered', 'failed')`,
    ),
  ],
)

export type NewsWireReplyRow = typeof newsWireReplies.$inferSelect
export type NewNewsWireReply = typeof newsWireReplies.$inferInsert
