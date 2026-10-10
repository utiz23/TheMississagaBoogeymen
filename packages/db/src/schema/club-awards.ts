import {
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { players } from './players.js'

/**
 * The trophy case's hand-entered awards (migration 0066, hand-applied): club
 * votes and archive-picked trophies (mvp/defense/rookie) and championship
 * banners. Edited on /admin/awards. The DB checks the shape: a trophy has a
 * source (a 'stats' one has a reason), a banner has a mode.
 */
export const clubAwards = pgTable('club_awards', {
  id: serial('id').primaryKey(),
  kind: text('kind').$type<'trophy' | 'banner'>().notNull(),
  trophy: text('trophy').$type<'mvp' | 'defense' | 'rookie'>(),
  mode: text('mode').$type<'3s' | '6s' | 'arcade'>(),
  gameTitleId: integer('game_title_id')
    .notNull()
    .references(() => gameTitles.id),
  source: text('source').$type<'vote' | 'stats'>(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Who an award went to, in display order. */
export const clubAwardPlayers = pgTable(
  'club_award_players',
  {
    awardId: integer('award_id')
      .notNull()
      .references(() => clubAwards.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    position: smallint('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.awardId, table.playerId] })],
)
