import { boolean, date, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const gameTitles = pgTable('game_titles', {
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
  isActive: boolean('is_active').notNull().default(false),
  launchedAt: date('launched_at'),
})

export type GameTitle = typeof gameTitles.$inferSelect
export type NewGameTitle = typeof gameTitles.$inferInsert
