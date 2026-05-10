/**
 * Gamertag/display-name → players.id resolver.
 *
 * The OCR-captured "actor" string varies by screen:
 *   - Pre-Game Lobby state 2 captures the actual gamertag.
 *   - Player Loadout View shows both gamertag and player display name.
 *   - Action Tracker / Events screens show ONLY the player's display name
 *     ("Silky", "M. Rantanen", "E. Wanhg") — never the gamertag.
 *
 * Resolution order (each step is single-candidate or returns null):
 *   1. Normalize: trim, strip leading "-." / "." ornament, strip trailing punctuation.
 *   2. Exact case-insensitive match on `players.gamertag`.
 *   3. Exact case-insensitive match on `player_gamertag_history.gamertag`
 *      where `seen_until IS NULL` (currently active aliases).
 *   4. Exact case-insensitive match on `player_display_aliases.normalized_alias`
 *      (operator-curated display-name aliases — see CLI in
 *      apps/worker/src/ingest-ocr-resolve-cli.ts).
 *   5. Substring match on active gamertags (snapshot is contained in OR contains
 *      the gamertag) — single candidate only.
 *   6. Levenshtein distance ≤ 1 against active gamertags — single candidate only.
 *
 * Never inserts new `players` rows. EA API ingest is the only path for that.
 */

import { players, playerGamertagHistory, playerDisplayAliases } from '@eanhl/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { PromoterDb } from './index.js'

export interface ResolvedPlayer {
  playerId: number | null
  /** Tags the resolution path so callers / debuggers know how it landed. */
  via:
    | 'gamertag_exact'
    | 'gamertag_history_exact'
    | 'display_alias_exact'
    | 'gamertag_substring'
    | 'gamertag_levenshtein'
    | 'unresolved'
}

const ORNAMENT_PREFIX_RE = /^\s*(?:-\s*[.]?\s*|[.]\s*)+/
const TRAILING_PUNCT_RE = /[\s.,;:!?]+$/

/** Trim, strip leading "-." / "." UI ornaments, strip trailing punctuation. */
function normalizeSnapshot(s: string): string {
  return s.replace(ORNAMENT_PREFIX_RE, '').replace(TRAILING_PUNCT_RE, '').trim()
}

function lowercaseNormalized(s: string): string {
  return normalizeSnapshot(s).toLowerCase()
}

/** Levenshtein distance, capped at maxDistance + 1 for early exit. */
function levenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Int32Array(n + 1)
  let curr = new Int32Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    let minRow = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const ins = curr[j - 1]! + 1
      const del = prev[j]! + 1
      const sub = prev[j - 1]! + cost
      const v = ins < del ? (ins < sub ? ins : sub) : del < sub ? del : sub
      curr[j] = v
      if (v < minRow) minRow = v
    }
    if (minRow > maxDistance) return maxDistance + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]!
}

export async function resolveGamertagToPlayer(
  rawSnapshot: string | null | undefined,
  _gameTitleId: number,
  dbConn: PromoterDb,
): Promise<ResolvedPlayer> {
  if (!rawSnapshot) return { playerId: null, via: 'unresolved' }
  const norm = normalizeSnapshot(rawSnapshot)
  if (!norm) return { playerId: null, via: 'unresolved' }
  const lc = norm.toLowerCase()

  // 1. Exact gamertag match (case-insensitive).
  {
    const [row] = await dbConn
      .select({ id: players.id })
      .from(players)
      .where(eq(sql`lower(${players.gamertag})`, lc))
      .limit(1)
    if (row) return { playerId: row.id, via: 'gamertag_exact' }
  }

  // 2. Exact match against active gamertag-history aliases.
  {
    const [row] = await dbConn
      .select({ playerId: playerGamertagHistory.playerId })
      .from(playerGamertagHistory)
      .where(
        and(
          eq(sql`lower(${playerGamertagHistory.gamertag})`, lc),
          isNull(playerGamertagHistory.seenUntil),
        ),
      )
      .limit(1)
    if (row) return { playerId: row.playerId, via: 'gamertag_history_exact' }
  }

  // 3. Exact match against operator-curated display-name aliases.
  {
    const [row] = await dbConn
      .select({ playerId: playerDisplayAliases.playerId })
      .from(playerDisplayAliases)
      .where(eq(playerDisplayAliases.normalizedAlias, lc))
      .limit(1)
    if (row) return { playerId: row.playerId, via: 'display_alias_exact' }
  }

  // Pull all active gamertags + history aliases for fuzzy steps. Roster is
  // small (~25 players) so a single SELECT is fine.
  const candidates = await dbConn
    .select({ id: players.id, gamertag: players.gamertag })
    .from(players)
    .where(eq(players.isActive, true))

  // 4. Substring match (snapshot contained in OR contains the gamertag).
  {
    const matches = candidates.filter((c) => {
      const gt = c.gamertag.toLowerCase()
      return gt.includes(lc) || lc.includes(gt)
    })
    if (matches.length === 1 && matches[0]) {
      return { playerId: matches[0].id, via: 'gamertag_substring' }
    }
  }

  // 5. Levenshtein-1 against active gamertags.
  {
    const matches = candidates
      .map((c) => ({ id: c.id, distance: levenshtein(lc, c.gamertag.toLowerCase(), 1) }))
      .filter((c) => c.distance <= 1)
    if (matches.length === 1 && matches[0]) {
      return { playerId: matches[0].id, via: 'gamertag_levenshtein' }
    }
  }

  return { playerId: null, via: 'unresolved' }
}

export { normalizeSnapshot, lowercaseNormalized }
