import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Game titles. Three operator controls are deliberately independent
 * (E1J policy, migration 0057):
 *
 *   - `isActive`     — ingestion eligibility. The worker polls EA only for
 *                      these titles. Nothing on the frontend reads it to pick a
 *                      default or an order.
 *   - `isDefault`    — the title a visitor with no `?title=` sees. At most one
 *                      row (partial unique index). The worker never reads it.
 *   - `releaseOrder` — chronology, higher = newer. Ordering never uses `id`.
 */
export const gameTitles = pgTable(
  'game_titles',
  {
    id: serial('id').primaryKey(),
    /** Short identifier used in URLs and config. e.g. 'nhl25', 'nhl26' */
    slug: text('slug').notNull().unique(),
    /** Display name. e.g. 'NHL 25' */
    name: text('name').notNull(),
    /** EA platform identifier. e.g. 'common-gen5' */
    eaPlatform: text('ea_platform').notNull(),
    /** Our club ID within this game title. e.g. '19224' */
    eaClubId: text('ea_club_id').notNull(),
    /** Base URL for this game title's EA API. May change between releases. */
    apiBaseUrl: text('api_base_url').notNull(),
    /** Ingestion eligibility only: the worker polls EA for titles where this is true. */
    isActive: boolean('is_active').notNull().default(false),
    /** Frontend default title. At most one row may be true (game_titles_single_default). */
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * Explicit chronology: higher = newer release. Unique among set values.
     * Nullable — an unset title sorts after every ordered title.
     */
    releaseOrder: integer('release_order'),
    launchedAt: date('launched_at'),
  },
  (table) => [
    uniqueIndex('game_titles_single_default')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
    uniqueIndex('game_titles_release_order_uniq').on(table.releaseOrder),
    check('game_titles_release_order_positive', sql`${table.releaseOrder} > 0`),
  ],
)

export type GameTitle = typeof gameTitles.$inferSelect
export type NewGameTitle = typeof gameTitles.$inferInsert
