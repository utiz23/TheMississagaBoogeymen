import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { players } from './players.js'

/**
 * Display-name aliases for OCR identity resolution.
 *
 * The OCR-captured "actor" string on Action Tracker / Events / Loadout screens
 * is a *display name* (e.g. "Silky", "M. Rantanen", "E. Wanhg") set by each
 * player in their loadout — not their EA gamertag (which is the canonical
 * `players.gamertag`). Display names rarely match the gamertag exactly, so we
 * store an explicit alias table that the resolver consults after gamertag and
 * gamertag-history lookups.
 *
 * Aliases are populated by the `ingest-ocr-resolve` CLI when an operator
 * confirms a snapshot → player mapping. Future ingests then auto-resolve
 * without manual intervention.
 *
 * source: 'manual' (operator-confirmed via CLI) | 'auto' (resolver inferred via
 *   substring or Levenshtein and may be revisited).
 */
export const playerDisplayAliases = pgTable(
  'player_display_aliases',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    /** Verbatim display name as captured by OCR (case preserved). */
    alias: text('alias').notNull(),
    /** Lowercased + trimmed copy of `alias` for fast case-insensitive lookup. */
    normalizedAlias: text('normalized_alias').notNull(),
    /** 'manual' = operator-confirmed; 'auto' = resolver-inferred. */
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_display_aliases_player_alias_uniq').on(
      table.playerId,
      table.normalizedAlias,
    ),
    index('player_display_aliases_normalized_idx').on(table.normalizedAlias),
  ],
)

export type PlayerDisplayAlias = typeof playerDisplayAliases.$inferSelect
export type NewPlayerDisplayAlias = typeof playerDisplayAliases.$inferInsert
