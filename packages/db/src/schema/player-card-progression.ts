import {
  bigserial,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { players } from './players.js'
import type { BadgeFamilyId, CardTier, MythicThemeKey, TierPool } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

/**
 * Player-card progression (migration 0060, hand-applied). Derived by the worker's
 * `card-recompute`; spec docs/superpowers/specs/2026-10-07-player-cards-badges-design.md.
 * CHECK constraints live in the SQL migration, not here.
 */
export const playerBadgeLevels = pgTable(
  'player_badge_levels',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    familyId: text('family_id').notNull().$type<BadgeFamilyId>(),
    value: integer('value').notNull(),
    level: smallint('level').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'player_badge_levels_pk', columns: [table.playerId, table.familyId] }),
  ],
)

export const playerCardProgress = pgTable('player_card_progress', {
  playerId: integer('player_id')
    .primaryKey()
    .references(() => players.id, { onDelete: 'cascade' }),
  tier: smallint('tier').notNull().$type<CardTier>(),
  level: smallint('level').notNull(),
  tierPool: text('tier_pool').notNull().$type<TierPool | 'manual'>(),
  mythicTheme: text('mythic_theme').$type<MythicThemeKey>(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const playerCardEvents = pgTable(
  'player_card_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<CardEventKind>(),
    familyId: text('family_id').$type<BadgeFamilyId>(),
    fromValue: smallint('from_value').notNull(),
    toValue: smallint('to_value').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('player_card_events_player_idx').on(table.playerId, table.occurredAt.desc())],
)
