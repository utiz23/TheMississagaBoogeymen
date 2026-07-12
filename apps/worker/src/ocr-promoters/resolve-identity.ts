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

import {
  players,
  playerGamertagHistory,
  playerDisplayAliases,
  playerLoadoutSnapshots,
} from '@eanhl/db'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from './index.js'

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
// OCR noise: stray parenthesized / bracketed suffix that real gamertags
// almost never use, but RapidOCR commonly inserts (e.g. "Silky [", "S.
// Zubov (1l"). Strip from the FIRST `(` or `[` onward. The leading
// whitespace match swallows a typical " (junk" form so we don't leave
// dangling spaces; bracket form "Silky [" gives "Silky".
const TRAILING_PAREN_BRACKET_RE = /\s*[(\[].*$/

/** Trim, strip leading "-." / "." UI ornaments, strip trailing punctuation,
 *  strip OCR-noise paren/bracket suffix. */
export function normalizeSnapshot(s: string): string {
  return s
    .replace(ORNAMENT_PREFIX_RE, '')
    .replace(TRAILING_PAREN_BRACKET_RE, '')
    .replace(TRAILING_PUNCT_RE, '')
    .trim()
}

function lowercaseNormalized(s: string): string {
  return normalizeSnapshot(s).toLowerCase()
}

/** Levenshtein distance, capped at maxDistance + 1 for early exit. */
export function levenshtein(a: string, b: string, maxDistance: number): number {
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
  dbConn: DbOrTx,
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

export { lowercaseNormalized }

export type ResolvedActorVia =
  | ResolvedPlayer['via']
  | 'roster_mismatch'
  | 'empty_lineup_passthrough'

export interface ResolvedActor {
  playerId: number | null
  via: ResolvedActorVia
  /**
   * The id the global resolver returned, even when filtered out.
   * Lets the backfill CLI emit per-row diagnostic logs without re-resolving.
   */
  globalPlayerId: number | null
}

/**
 * Match-scoped actor resolver. Wraps `resolveGamertagToPlayer` and filters
 * the result against `player_loadout_snapshots` for the given match.
 *
 * Semantics:
 *   - Global resolver returns null → return that result unchanged.
 *   - Global resolver returns a player_id IN this match's lineup → return it.
 *   - Global resolver returns a player_id NOT in lineup → return null with
 *     via='roster_mismatch'. The global id is preserved on globalPlayerId
 *     for diagnostics.
 *   - Lineup is empty (zero rows OR all rows have player_id=null) → pass
 *     the global resolver's result through with via='empty_lineup_passthrough'.
 *     This is a safety net for ingest order races (action-tracker landing
 *     before loadout-v2). The backfill CLI cleans these up post-consolidate.
 *
 * Lineup query is intentionally ALL snapshots (not filtered to
 * review_status='reviewed'). The match-quality CLI's class-G check uses
 * the reviewed-only subset, but that runs downstream of consolidate;
 * this resolver runs at event-ingest time, upstream. Distinct gates,
 * distinct questions — see plan's "Risks" section.
 */
export async function resolveActorForMatch(
  rawSnapshot: string | null | undefined,
  matchId: number,
  gameTitleId: number,
  dbConn: DbOrTx,
): Promise<ResolvedActor> {
  const global = await resolveGamertagToPlayer(rawSnapshot, gameTitleId, dbConn)
  if (global.playerId === null) {
    return { playerId: null, via: global.via, globalPlayerId: null }
  }
  // Lineup gate. ALL snapshots, not just reviewed — see header comment.
  const lineupRows = await dbConn
    .selectDistinct({ playerId: playerLoadoutSnapshots.playerId })
    .from(playerLoadoutSnapshots)
    .where(
      and(eq(playerLoadoutSnapshots.matchId, matchId), isNotNull(playerLoadoutSnapshots.playerId)),
    )
  const lineupPlayerIds = new Set<number>(
    lineupRows.map((r) => r.playerId).filter((id): id is number => id !== null),
  )
  if (lineupPlayerIds.size === 0) {
    return {
      playerId: global.playerId,
      via: 'empty_lineup_passthrough',
      globalPlayerId: global.playerId,
    }
  }
  if (lineupPlayerIds.has(global.playerId)) {
    return {
      playerId: global.playerId,
      via: global.via,
      globalPlayerId: global.playerId,
    }
  }
  return { playerId: null, via: 'roster_mismatch', globalPlayerId: global.playerId }
}

/**
 * Infer team_side for an Action-Tracker event from its resolved actor/target
 * player ids. Actor on the BGM roster → 'for'; else target on the roster (the
 * opp acted on a BGM player) → 'against'; neither resolves → 'against' (the
 * arbitrary default the Events-screen promoter later overwrites from the
 * authoritative team_abbreviation chip).
 *
 * Single source of truth for BOTH the live AT promoter and WS4 identity
 * recovery — the value lands in the clock-independent dedup key, so the two
 * paths MUST derive it identically or recovered orphans would mis-partition.
 */
export function deriveTeamSide(
  actorPlayerId: number | null,
  targetPlayerId: number | null,
): 'for' | 'against' {
  return actorPlayerId !== null ? 'for' : targetPlayerId !== null ? 'against' : 'against'
}
