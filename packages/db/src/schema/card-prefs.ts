import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { players } from './players.js'
import { users } from './accounts.js'
import type { CardThemeKey } from '../cards/badge-catalog.js'

/**
 * The card theme a member equipped (migration 0065, hand-applied). One row per
 * player, applied to every game title's card; `theme` NULL = AUTO (follow tier).
 * A theme that isn't unlocked on a given title's card falls back to AUTO there.
 * Kept apart from `player_card_progress`, which the worker's recompute overwrites.
 */
export const playerCardPrefs = pgTable('player_card_prefs', {
  playerId: integer('player_id')
    .primaryKey()
    .references(() => players.id, { onDelete: 'cascade' }),
  theme: text('theme').$type<CardThemeKey>(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
