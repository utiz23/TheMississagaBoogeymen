import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  /**
   * EA blazeId — the stable cross-session player identifier.
   *
   * DEFERRED: Nullable until fixtures confirm blazeId is always present in
   * EA API responses. If absent, the worker falls back to gamertag matching
   * and logs a warning. See ARCHITECTURE.md §3.3 for the full identity strategy.
   */
  eaId: text('ea_id').unique(),
  /** Current display gamertag. Updated on each ingestion if it changes. */
  gamertag: text('gamertag').notNull(),
  /** Most recent position played. Populated from match data. */
  position: text('position'),
  isActive: boolean('is_active').notNull().default(true),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Tracks gamertag changes over time.
 * A partial unique index ensures at most one open-ended row per player,
 * preventing overlapping history entries.
 */
export const playerGamertagHistory = pgTable(
  'player_gamertag_history',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    gamertag: text('gamertag').notNull(),
    seenFrom: timestamp('seen_from', { withTimezone: true }).notNull().defaultNow(),
    /** Null means this is the current active gamertag. */
    seenUntil: timestamp('seen_until', { withTimezone: true }),
  },
  (table) => [
    // Prevents more than one open-ended (current) row per player.
    // Worker must close the previous row before inserting a new one.
    uniqueIndex('player_gamertag_history_open_ended_uniq')
      .on(table.playerId)
      .where(sql`${table.seenUntil} IS NULL`),
  ],
)

export type Player = typeof players.$inferSelect
export type NewPlayer = typeof players.$inferInsert
export type PlayerGamertagHistory = typeof playerGamertagHistory.$inferSelect
export type NewPlayerGamertagHistory = typeof playerGamertagHistory.$inferInsert
