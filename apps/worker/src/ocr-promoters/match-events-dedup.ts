/**
 * Cross-capture dedup helper for `match_events` row inserts.
 *
 * Both the action-tracker promoter and the events promoter need to ask
 * "does a row for this (match, period, type, clock, actor) already
 * exist?" before inserting. The naive answer — exact-string match on
 * `actor_gamertag_snapshot` — produces duplicate rows when OCR misreads
 * a player's name in just one or two characters (e.g. "SILKY" → "SIlKY",
 * "WILDE" → "WILOE", "TOEWS" → "fOEWS").
 *
 * This helper uses two strategies in sequence:
 *
 *   A. Resolved-player path. If `resolveGamertagToPlayer` succeeded
 *      (Levenshtein-1 + display alias + gamertag history cascade), both
 *      captures' typo'd actors land on the same `playerId`. Match on
 *      `actor_player_id`. This handles BGM-side typos cleanly because
 *      BGM players are in `players` / `player_display_aliases`.
 *
 *   B. Unresolved-actor fuzzy fallback. When `actor_player_id` is null
 *      (the actor is an opp the resolver can't reach — they aren't
 *      seeded into `players` because they're not BGM-rostered), load
 *      all existing same-bucket rows with null `actor_player_id` and
 *      do an in-TypeScript Levenshtein-1 case-insensitive compare on
 *      their `actor_gamertag_snapshot` strings. A match → treat as the
 *      existing row. This handles WILDE/WILOE and TOEWS/fOEWS-style
 *      opp typos by collapsing within-match-bucket near-duplicates.
 *
 * Strategy B falls through to exact case-folded match (same as the
 * prior dedup behavior) when no near-neighbor is found.
 */

import { matchEvents } from '@eanhl/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { PromoterDb } from './index.js'
import { levenshtein } from './resolve-identity.js'

export interface DedupKey {
  matchId: number
  periodNumber: number
  /** Excludes 'unknown' — callers should skip those rows entirely before
   *  reaching this helper (the match_events column constraint forbids them). */
  eventType: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  clock: string
  actorPlayerId: number | null
  actorSnapshot: string
}

/**
 * Returns the id of an existing match_events row that represents the
 * same event as the given key, or null if no match. Idempotent.
 */
export async function findExistingMatchEvent(
  db: PromoterDb,
  key: DedupKey,
): Promise<number | null> {
  // Strategy A — resolved-player path.
  if (key.actorPlayerId !== null) {
    const rows = await db
      .select({ id: matchEvents.id })
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.matchId, key.matchId),
          eq(matchEvents.periodNumber, key.periodNumber),
          eq(matchEvents.eventType, key.eventType),
          eq(matchEvents.source, 'ocr'),
          eq(matchEvents.clock, key.clock),
          eq(matchEvents.actorPlayerId, key.actorPlayerId),
        ),
      )
      .limit(1)
    return rows[0]?.id ?? null
  }

  // Strategy B — unresolved-actor fuzzy fallback.
  // Load candidates in the same bucket with null actor_player_id; Levenshtein-1.
  const candidates = await db
    .select({ id: matchEvents.id, snapshot: matchEvents.actorGamertagSnapshot })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.matchId, key.matchId),
        eq(matchEvents.periodNumber, key.periodNumber),
        eq(matchEvents.eventType, key.eventType),
        eq(matchEvents.source, 'ocr'),
        eq(matchEvents.clock, key.clock),
        isNull(matchEvents.actorPlayerId),
      ),
    )

  const target = key.actorSnapshot.toLowerCase()
  for (const c of candidates) {
    const snap = (c.snapshot ?? '').toLowerCase()
    if (snap === target) return c.id
    if (snap.length > 0 && levenshtein(snap, target, 1) <= 1) return c.id
  }
  return null
}
