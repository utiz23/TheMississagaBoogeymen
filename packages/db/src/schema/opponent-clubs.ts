import { pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Metadata for opponent clubs encountered in match history.
 *
 * Fetched from EA clubs/info after new opponents are ingested. One row per
 * unique opponent club ID, upserted on each new discovery. Never stores
 * our own club (Boogeymen) — that branding stays local/manual.
 */
export const opponentClubs = pgTable(
  'opponent_clubs',
  {
    id: serial('id').primaryKey(),
    /** EA club ID string — matches matches.opponent_club_id. */
    eaClubId: text('ea_club_id').notNull(),
    /** Display name from EA clubs/info response. */
    name: text('name').notNull(),
    /**
     * EA custom crest asset ID from customKit.crestAssetId.
     * Null if clubs/info returned no customKit.
     */
    crestAssetId: text('crest_asset_id'),
    /**
     * EA customKit.useBaseAsset flag.
     * "1" means the crest should use the base-asset CDN path:
     *   https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/crests/t{id}.png
     * "0" means the crest should use the custom-asset CDN path:
     *   https://media.contentapi.ea.com/content/dam/eacom/nhl/pro-clubs/custom-crests/{id}.png
     */
    useBaseAsset: text('use_base_asset'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('opponent_clubs_ea_club_id_uniq').on(table.eaClubId)],
)

export type OpponentClub = typeof opponentClubs.$inferSelect
export type NewOpponentClub = typeof opponentClubs.$inferInsert
