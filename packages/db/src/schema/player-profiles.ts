import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { players } from './players.js'
import type { PlayerArchetype } from './player-archetype.js'

/** How much the news desk may write about a player. Default 'full' (migration 0071). */
export const PRESS_LEVELS = ['full', 'easy', 'out'] as const
export type PressLevel = (typeof PRESS_LEVELS)[number]
export type PressLevelSetBy = 'self' | 'admin'

/**
 * Manual/enriched metadata for a player. 1:1 with `players`.
 *
 * Ownership boundary:
 *   - `players` is ingestion-owned: gamertag, position, activity timestamps.
 *   - `player_profiles` is manually-owned: jersey number, nationality, bio,
 *     preferred position, club-role label.
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
   * Display name / real name / alias. Shown as secondary text under gamertag
   * on the player profile page. Not available from the EA API — manual only.
   * Store as a single clean displayable string (e.g. "Erb", "Igor Orlov").
   */
  playerName: text('player_name'),
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
   * Stylistic archetype tag (e.g. 'playmaker', 'sniper', 'enforcer-d').
   *
   * One of the 11 PLAYER_ARCHETYPES constants in
   * `packages/db/src/schema/player-archetype.ts`. Drives the archetype pill
   * shown on the profile hero, leader tiles, and player carousel cards.
   * Goalies have no archetype — leave NULL.
   *
   * Manual entry only; ingestion never touches this column.
   */
  archetype: text('archetype').$type<PlayerArchetype>(),
  /**
   * Free-text player bio for the detail page.
   * Not available from the EA API — requires manual entry.
   */
  bio: text('bio'),
  /**
   * Optional manual club-role badge (e.g. Captain, Assistant, Leader).
   * Editorial only — not provided by the EA API.
   */
  clubRoleLabel: text('club_role_label'),
  /**
   * How much the news desk may write about this player: 'full' (default),
   * 'easy' (no criticism) or 'out' (never named). CHECK constraints live in
   * migration 0071 (hand-applied), like the other hand-written checks.
   */
  pressLevel: text('press_level').$type<PressLevel>().notNull().default('full'),
  /** Who last set press_level: the player ('self'), an admin, or never set (null). */
  pressLevelSetBy: text('press_level_set_by').$type<PressLevelSetBy>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlayerProfile = typeof playerProfiles.$inferSelect
export type NewPlayerProfile = typeof playerProfiles.$inferInsert
