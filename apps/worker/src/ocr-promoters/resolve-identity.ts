/**
 * Gamertag-snapshot → players.id resolver.
 *
 * Phase 1 stub: lowercase exact match against players.gamertag only. Returns
 * { playerId: null } on miss. Never inserts new players from OCR data — the
 * EA API ingest path is the only authority for creating players rows.
 *
 * Phase 3 will add normalization (strip leading "-." ornament, trailing punctuation),
 * historical alias matching against player_gamertag_history, and Levenshtein-1
 * soft matching with single-candidate disambiguation.
 */

import { players } from '@eanhl/db'
import { eq, sql } from 'drizzle-orm'
import type { PromoterDb } from './index.js'

export interface ResolvedPlayer {
  playerId: number | null
}

export async function resolveGamertagToPlayer(
  gamertagSnapshot: string | null | undefined,
  _gameTitleId: number,
  dbConn: PromoterDb,
): Promise<ResolvedPlayer> {
  if (!gamertagSnapshot) return { playerId: null }
  const trimmed = gamertagSnapshot.trim()
  if (!trimmed) return { playerId: null }

  const [row] = await dbConn
    .select({ id: players.id })
    .from(players)
    .where(eq(sql`lower(${players.gamertag})`, trimmed.toLowerCase()))
    .limit(1)

  return { playerId: row?.id ?? null }
}
