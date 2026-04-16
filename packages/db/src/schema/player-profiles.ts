import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { players } from './players.js'

/**
 * Manual/enriched metadata for a player. 1:1 with `players`.
 *
 * Ownership boundary:
 *   - `players` is ingestion-owned: gamertag, position, activity timestamps.
 *   - `player_profiles` is manually-owned: jersey number, nationality, bio,
 *     preferred position.
 *
 * Ingestion creates an empty row (all fields NULL) for every player via
 * ON CONFLICT DO NOTHING. Fields are written only by manual edits or a
 * future admin UI. Ingestion never updates existing profile rows.
 */
export const playerProfiles = pgTable('player_profiles', {
  /** PK equals players.id — enforces the 1:1 relationship without a surrogate key. */
  playerId: integer('player_id')
    .primaryKey()
    .references(() => players.id),
  /**
   * Jersey number worn in-game.
   * Not available from the EA API — requires manual entry.
   */
  jerseyNumber: integer('jersey_number'),
  /**
   * ISO 3166-1 alpha-2 nationality code (e.g. 'CA', 'US', 'FI').
   * Not available from the EA API — requires manual entry.
   */
  nationality: text('nationality'),
  /**
   * Editorial override of the auto-detected primary position.
   * When set, takes precedence over players.position in display.
   */
  preferredPosition: text('preferred_position'),
  /**
   * Free-text player bio for the detail page.
   * Not available from the EA API — requires manual entry.
   */
  bio: text('bio'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlayerProfile = typeof playerProfiles.$inferSelect
export type NewPlayerProfile = typeof playerProfiles.$inferInsert
