import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { players } from './players.js'

/**
 * Persona-name aliases for OCR cleanup of in-game NHL player names.
 *
 * Distinct from `player_display_aliases`, which maps an OCR snapshot to a
 * `player_id` for identity resolution (gamertag-side). This table cleans up
 * the SHORT IN-GAME PERSONA NAME captured from the pre-game lobby state-2
 * card (e.g., `#11- Evgeni Wanhg` → `E. WAHNG`). The same NHL player can
 * appear under multiple OCR garbled forms (`E.Wanhg`, `E.Wanlg`, `E. WAHNG`),
 * all of which should canonicalize to one clean string.
 *
 * Lookup is by `normalized_alias` (one canonical per garbled value globally).
 * The consolidator calls `resolvePersona()` after the dominant-vote step;
 * the resolved canonical replaces `player_loadout_snapshots.player_name_persona`,
 * and the original vote is preserved in `player_name_persona_raw` for audit.
 *
 * `player_id` is informational (NULL allowed) — persona names are per-match
 * skin choices, not strictly per-player. Operator can use it to sanity-check
 * which player each alias belongs to.
 *
 * source: 'manual' (operator-inserted via SQL) | 'auto' (future CLI-confirmed).
 */
export const playerPersonaAliases = pgTable(
  'player_persona_aliases',
  {
    id: serial('id').primaryKey(),
    /** Verbatim OCR-captured persona snapshot (case preserved). */
    alias: text('alias').notNull(),
    /** Lowercased + ornament-stripped + trimmed copy for fast lookup. */
    normalizedAlias: text('normalized_alias').notNull(),
    /** Clean persona string to write back to `player_name_persona`. */
    canonicalPersona: text('canonical_persona').notNull(),
    /** Informational FK; NULL allowed since persona is per-match. */
    playerId: integer('player_id').references(() => players.id),
    /** 'manual' = operator-inserted; 'auto' = future CLI-confirmed. */
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('player_persona_aliases_normalized_uniq').on(table.normalizedAlias),
    index('player_persona_aliases_canonical_idx').on(table.canonicalPersona),
  ],
)

export type PlayerPersonaAlias = typeof playerPersonaAliases.$inferSelect
export type NewPlayerPersonaAlias = typeof playerPersonaAliases.$inferInsert
