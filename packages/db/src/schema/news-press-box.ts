import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { NewsReporterId } from './news.js'
import { players } from './players.js'

/**
 * Press Box (the admin page /admin/press-box; migration 0080).
 *
 * `news_press_box_audit`: one row per change made on the page (who, when, what). Shown as the
 * change log. The summary is a short before/after line; it never holds a message text.
 *
 * `news_press_box_requests`: the page cannot post to Discord (the bot tokens live in the press
 * service), so a button writes one request and the press service does it on its next pass.
 *
 * Release L2 (migration 0081): `news_player_profiles` (the stored AI profile of one person) and
 * two more request kinds, `profile` and `interview`, that name their person.
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
  'press_level',
  'nickname_add',
  'nickname_remove',
  'gm_note',
  'profile_request',
  'interview_request',
  'background_add',
  'background_confirm',
  'background_edit',
  'background_reject',
  'background_delete',
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

export const PRESS_BOX_REQUEST_KINDS = ['testscrum', 'profile', 'interview'] as const
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
    /** Who a `profile` or `interview` request is for (migration 0081): a member, or a Discord user. */
    targetPlayerId: integer('target_player_id').references(() => players.id, {
      onDelete: 'cascade',
    }),
    targetDiscordUserId: text('target_discord_user_id'),
    /** An `interview` request: the reporter the GM chose (null = the press service chooses). */
    reporter: text('reporter').$type<NewsReporterId>(),
    /** An `interview` request: the GM's topic (null = none). */
    topic: text('topic'),
  },
  (table) => [
    index('news_press_box_requests_status_idx').on(table.status, table.id),
    check(
      'news_press_box_requests_kind_check',
      sql`${table.kind} IN ('testscrum', 'profile', 'interview')`,
    ),
    check(
      'news_press_box_requests_target_check',
      sql`${table.kind} = 'testscrum' OR ${table.targetPlayerId} IS NOT NULL OR ${table.targetDiscordUserId} IS NOT NULL`,
    ),
    check(
      'news_press_box_requests_status_check',
      sql`${table.status} IN ('pending', 'running', 'done', 'failed')`,
    ),
  ],
)
export type NewsPressBoxRequestRow = typeof newsPressBoxRequests.$inferSelect

/**
 * The stored AI profile of one person (migration 0081): "how the press sees him". One row per
 * person, replaced on each Refresh. A member has `player_id`; a bench person or the coach has
 * `discord_user_id` and `display_name`. Shown only on the admin page; never written for a
 * "Leave me out" player.
 */
export const newsPlayerProfiles = pgTable(
  'news_player_profiles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id').references(() => players.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id'),
    displayName: text('display_name'),
    profile: text('profile').notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull().defaultNow(),
    /** The writing-rules version the text followed (`NEWS_RULES_VERSION`). */
    rulesVersion: text('rules_version').notNull(),
    model: text('model').notNull(),
    /** What the model calls for this profile cost, in USD (also counted in `news_ai_usage`). */
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  },
  (table) => [
    uniqueIndex('news_player_profiles_player_uniq')
      .on(table.playerId)
      .where(sql`player_id IS NOT NULL`),
    uniqueIndex('news_player_profiles_user_uniq')
      .on(table.discordUserId)
      .where(sql`player_id IS NULL`),
    check(
      'news_player_profiles_person_check',
      sql`${table.playerId} IS NOT NULL OR (${table.discordUserId} IS NOT NULL AND ${table.displayName} IS NOT NULL)`,
    ),
  ],
)
export type NewsPlayerProfileRow = typeof newsPlayerProfiles.$inferSelect
