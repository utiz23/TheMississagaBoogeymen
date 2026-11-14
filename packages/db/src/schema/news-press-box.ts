import { sql } from 'drizzle-orm'
import { bigserial, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { players } from './players.js'

/**
 * Press Box (the admin page /admin/press-box; migration 0080).
 *
 * `news_press_box_audit`: one row per change made on the page (who, when, what). Shown as the
 * change log. The summary is a short before/after line; it never holds a message text.
 *
 * `news_press_box_requests`: the page cannot post to Discord (the bot tokens live in the press
 * service), so a button writes one request and the press service does it on its next pass.
 */

export const PRESS_BOX_AUDIT_KINDS = [
  'heat',
  'testscrum',
  'relationship_cooldown',
  'relationship_reset',
  'relationship_freeze',
  'relationship_unfreeze',
  'relationship_level',
  'relationship_level_clear',
] as const
export type PressBoxAuditKind = (typeof PRESS_BOX_AUDIT_KINDS)[number]

export const newsPressBoxAudit = pgTable(
  'news_press_box_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorPlayerId: integer('actor_player_id').references(() => players.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name').notNull(),
    kind: text('kind').$type<PressBoxAuditKind>().notNull(),
    target: text('target').notNull(),
    summary: text('summary').notNull(),
  },
  (table) => [index('news_press_box_audit_at_idx').on(table.at.desc())],
)
export type NewsPressBoxAuditRow = typeof newsPressBoxAudit.$inferSelect
export type NewNewsPressBoxAudit = typeof newsPressBoxAudit.$inferInsert

export const PRESS_BOX_REQUEST_KINDS = ['testscrum'] as const
export type PressBoxRequestKind = (typeof PRESS_BOX_REQUEST_KINDS)[number]
export const PRESS_BOX_REQUEST_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export type PressBoxRequestStatus = (typeof PRESS_BOX_REQUEST_STATUSES)[number]

export const newsPressBoxRequests = pgTable(
  'news_press_box_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').$type<PressBoxRequestKind>().notNull(),
    status: text('status').$type<PressBoxRequestStatus>().notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    requestedBy: text('requested_by').notNull(),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    result: text('result'),
  },
  (table) => [
    index('news_press_box_requests_status_idx').on(table.status, table.id),
    check('news_press_box_requests_kind_check', sql`${table.kind} IN ('testscrum')`),
    check(
      'news_press_box_requests_status_check',
      sql`${table.status} IN ('pending', 'running', 'done', 'failed')`,
    ),
  ],
)
export type NewsPressBoxRequestRow = typeof newsPressBoxRequests.$inferSelect
